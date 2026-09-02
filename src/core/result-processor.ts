import { AgentBehaviorManager } from "./agent-behavior-manager.js";
import { validateAgentResult } from "./agent-result-validator.js";
import { ArtifactManager } from "./artifact-manager.js";
import { MemoryManager } from "./memory-manager.js";
import { PlanManager } from "./plan-manager.js";
import { ProjectManager } from "./project-manager.js";
import { SessionManager } from "./session-manager.js";
import { TaskManager } from "./task-manager.js";
import type { AgentName } from "../domain/agent.js";
import type {
  AgentResult,
  AgentResultFor,
  ExaminerMemoryIntent,
  RequestedAgentCall,
} from "../domain/agent-result.js";
import type {
  ArtifactPayload,
  ArtifactRecord,
  ArtifactScope,
  TaskArtifactScope,
} from "../domain/artifact.js";
import {
  InvalidAgentResultError,
  NoProjectBoundError,
  NoTaskBoundError,
  TaskArchivedError,
  TaskCompletedError,
} from "../domain/errors.js";
import type { MemoryScope } from "../domain/memory.js";
import type {
  AgentStateEffect,
  PersistedArtifactReference,
  ProcessedAgentResult,
  ProcessedAgentResultFor,
} from "../domain/processed-agent-result.js";
import type { Project } from "../domain/project.js";
import type { SessionId } from "../domain/session.js";
import type { Task } from "../domain/task.js";
import { StateStore } from "../infrastructure/state-store.js";

export interface ResultProcessorOptions {
  readonly synaphexRoot?: string;
  readonly homeDirectory?: string;
}

export interface ProcessAgentResultRequest<TAgent extends AgentName> {
  readonly sessionId: SessionId;
  readonly expectedAgent: TAgent;
  readonly result: unknown;
}

interface ProcessingScope {
  readonly project: Project;
  readonly task: Task | null;
}

export class ResultProcessor {
  private readonly sessions: SessionManager;
  private readonly projects: ProjectManager;
  private readonly tasks: TaskManager;
  private readonly artifacts: ArtifactManager;
  private readonly memory: MemoryManager;
  private readonly plans: PlanManager;
  private readonly behavior: AgentBehaviorManager;

  constructor(options: ResultProcessorOptions = {}) {
    const store = new StateStore(options.synaphexRoot);
    this.projects = new ProjectManager(store, {
      ...(options.homeDirectory === undefined
        ? {}
        : { homeDirectory: options.homeDirectory }),
    });
    this.sessions = new SessionManager(store);
    this.tasks = new TaskManager(store, this.projects);
    this.artifacts = new ArtifactManager(store, this.projects, this.tasks);
    this.memory = new MemoryManager(store, this.projects, this.tasks);
    this.plans = new PlanManager(store, this.tasks);
    this.behavior = new AgentBehaviorManager(store);
  }

  async process<TAgent extends AgentName>(
    request: ProcessAgentResultRequest<TAgent>,
  ): Promise<ProcessedAgentResultFor<TAgent>> {
    // The complete untrusted value is validated before any manager mutation.
    const result = validateAgentResult(
      request.expectedAgent,
      request.result,
    ) as AgentResultFor<TAgent> & AgentResult;
    const scope = await this.resolveScope(request.sessionId, result.agent);
    await this.validateBeforeMutation(result, scope);

    return (await this.applyValidatedResult(
      result,
      scope,
    )) as ProcessedAgentResultFor<TAgent>;
  }

  private async resolveScope(
    sessionId: SessionId,
    agent: AgentName,
  ): Promise<ProcessingScope> {
    const binding = await this.sessions.getCurrentBinding(sessionId);
    if (binding.projectId === null) {
      throw new NoProjectBoundError(sessionId);
    }
    const project = await this.projects.get(binding.projectId);
    const task =
      binding.taskId === null
        ? null
        : await this.tasks.get(binding.projectId, binding.taskId);
    this.assertLifecycle(sessionId, agent, task);
    return { project, task };
  }

  private assertLifecycle(
    sessionId: SessionId,
    agent: AgentName,
    task: Task | null,
  ): void {
    const activeTaskRequired =
      agent === "questioner" ||
      agent === "planner" ||
      agent === "coder" ||
      agent === "reviewer";
    if (activeTaskRequired && task === null) {
      throw new NoTaskBoundError(sessionId);
    }
    if (task === null) {
      return;
    }
    if (task.status === "archived") {
      throw new TaskArchivedError(task.id);
    }
    if (activeTaskRequired && task.status === "completed") {
      throw new TaskCompletedError(task.id);
    }
  }

  private async validateBeforeMutation(
    result: AgentResult,
    scope: ProcessingScope,
  ): Promise<void> {
    switch (result.agent) {
      case "researcher":
        await this.assertConfiguredOutputFields(
          result.agent,
          result.researchArtifact,
        );
        break;
      case "coder":
        await this.assertConfiguredOutputFields(result.agent, result.workRecord);
        break;
      case "reviewer":
        await this.assertConfiguredOutputFields(result.agent, result.report);
        break;
      case "examiner":
        this.assertExaminerIntentScope(result.memoryIntent, scope);
        break;
      case "questioner":
      case "planner":
        break;
    }
  }

  private async assertConfiguredOutputFields(
    agent: "researcher" | "coder" | "reviewer",
    payload: ArtifactPayload,
  ): Promise<void> {
    const configured = new Set(
      (await this.behavior.peekBehavior(agent)).outputFields,
    );
    const unexpected = Object.keys(payload).filter(
      (field) => !configured.has(field),
    );
    if (unexpected.length > 0) {
      throw new InvalidAgentResultError(
        agent,
        `payload contains unconfigured output fields: ${unexpected.join(", ")}`,
      );
    }
  }

  private assertExaminerIntentScope(
    intent: ExaminerMemoryIntent,
    scope: ProcessingScope,
  ): void {
    if (intent.kind === "none") {
      return;
    }
    if (
      intent.kind === "replace_project" ||
      intent.kind === "clear_project"
    ) {
      if (intent.projectId !== scope.project.id) {
        throw new InvalidAgentResultError(
          "examiner",
          "canonical project-memory intent must target the current project",
        );
      }
      return;
    }
    if (
      scope.task === null ||
      intent.projectId !== scope.project.id ||
      intent.taskId !== scope.task.id
    ) {
      throw new InvalidAgentResultError(
        "examiner",
        "canonical task-memory intent must target the current bound task",
      );
    }
  }

  private async applyValidatedResult(
    result: AgentResult,
    scope: ProcessingScope,
  ): Promise<ProcessedAgentResult> {
    const persistedArtifacts: PersistedArtifactReference[] = [];
    const stateEffects: AgentStateEffect[] = [];

    switch (result.agent) {
      case "questioner":
        if (result.workingContext !== undefined) {
          const taskScope = requireTaskScope(scope);
          await this.artifacts.saveQuestionerContext(
            taskScope,
            result.workingContext,
          );
          stateEffects.push({
            kind: "questioner_context_saved",
            scope: taskScope,
          });
        }
        break;
      case "researcher": {
        const artifactScope = artifactScopeFrom(scope);
        const artifact = await this.artifacts.saveResearchArtifact(
          artifactScope,
          result.researchArtifact,
        );
        const reference = toArtifactReference(artifact);
        persistedArtifacts.push(reference);
        stateEffects.push({ kind: "research_artifact_saved", artifact: reference });
        break;
      }
      case "examiner":
        if (result.outcome !== "needs_user" && result.memoryConflict === undefined) {
          const effect = await this.applyExaminerIntent(result.memoryIntent);
          if (effect !== null) {
            stateEffects.push(effect);
          }
        }
        break;
      case "planner":
        if (result.draftPlanMarkdown !== undefined) {
          const task = requireTask(scope);
          await this.plans.saveDraft(task.id, result.draftPlanMarkdown);
          stateEffects.push({ kind: "plan_draft_saved", taskId: task.id });
        }
        break;
      case "coder": {
        const artifact = await this.artifacts.saveCoderWorkRecord(
          requireTaskScope(scope),
          result.workRecord,
        );
        const reference = toArtifactReference(artifact);
        persistedArtifacts.push(reference);
        stateEffects.push({ kind: "coder_artifact_saved", artifact: reference });
        break;
      }
      case "reviewer": {
        const taskScope = requireTaskScope(scope);
        // Intentional ordering: Reviewer writes are forbidden after completion.
        const artifact = await this.artifacts.saveReviewerReport(
          taskScope,
          {
            status: result.reviewStatus,
            warnings: [...(result.warnings ?? [])],
            ...(result.failureOrigin === undefined
              ? {}
              : { failureOrigin: result.failureOrigin }),
          },
          result.report,
        );
        const reference = toArtifactReference(artifact);
        persistedArtifacts.push(reference);
        stateEffects.push({
          kind: "reviewer_artifact_saved",
          artifact: reference,
        });
        if (result.reviewStatus !== "FAIL") {
          // TODO: Retrying a crash between report persistence and completion is
          // intentionally deferred to production idempotency hardening.
          const completed = await this.tasks.markCompleted(
            scope.project.id,
            taskScope.taskId,
          );
          stateEffects.push({ kind: "task_completed", taskId: completed.id });
        }
        break;
      }
    }

    return {
      agent: result.agent,
      outcome: result.outcome,
      summary: result.summary,
      warnings: [...(result.warnings ?? [])],
      persistedArtifacts,
      requestedCalls: copyRequestedCalls(result.requestedCalls ?? []),
      stateEffects,
      ...(result.agent === "questioner"
        ? {
            state: result.state,
            ...(result.state === "pending_question"
              ? { question: result.question }
              : {}),
          }
        : {}),
      ...(result.agent === "examiner" && result.memoryConflict !== undefined
        ? { memoryConflict: { summary: result.memoryConflict.summary } }
        : {}),
      ...(result.agent === "reviewer"
        ? {
            reviewStatus: result.reviewStatus,
            ...(result.failureOrigin === undefined
              ? {}
              : { failureOrigin: result.failureOrigin }),
          }
        : {}),
      ...(result.agent === "planner" && result.consultation !== undefined
        ? {
            consultation: {
              disposition: result.consultation.disposition,
              message: result.consultation.message,
            },
          }
        : {}),
    } as ProcessedAgentResult;
  }

  private async applyExaminerIntent(
    intent: ExaminerMemoryIntent,
  ): Promise<AgentStateEffect | null> {
    switch (intent.kind) {
      case "none":
        return null;
      case "replace_project": {
        const scope = { kind: "project", projectId: intent.projectId } as const;
        await this.memory.replaceCanonicalMemory(scope, intent.content);
        return { kind: "project_memory_replaced", scope };
      }
      case "clear_project": {
        const scope = { kind: "project", projectId: intent.projectId } as const;
        await this.memory.clearCanonicalMemory(scope);
        return { kind: "project_memory_cleared", scope };
      }
      case "replace_task": {
        const scope = {
          kind: "task",
          projectId: intent.projectId,
          taskId: intent.taskId,
        } as const;
        await this.memory.replaceCanonicalMemory(scope, intent.content);
        return { kind: "task_memory_replaced", scope };
      }
      case "clear_task": {
        const scope = {
          kind: "task",
          projectId: intent.projectId,
          taskId: intent.taskId,
        } as const;
        await this.memory.clearCanonicalMemory(scope);
        return { kind: "task_memory_cleared", scope };
      }
    }
  }
}

function artifactScopeFrom(scope: ProcessingScope): ArtifactScope {
  return scope.task === null
    ? { kind: "project", projectId: scope.project.id }
    : {
        kind: "task",
        projectId: scope.project.id,
        taskId: scope.task.id,
      };
}

function requireTask(scope: ProcessingScope): Task {
  if (scope.task === null) {
    throw new TypeError("Validated task-bound role has no task");
  }
  return scope.task;
}

function requireTaskScope(scope: ProcessingScope): TaskArtifactScope {
  const task = requireTask(scope);
  return {
    kind: "task",
    projectId: scope.project.id,
    taskId: task.id,
  };
}

function toArtifactReference(
  artifact: ArtifactRecord,
): PersistedArtifactReference {
  return {
    id: artifact.id,
    category: artifact.category,
    scope: artifact.scope,
  };
}

function copyRequestedCalls(
  calls: readonly RequestedAgentCall[],
): RequestedAgentCall[] {
  return calls.map((call) => ({
    target: call.target,
    purpose: call.purpose,
    handoff: {
      caller: call.handoff.caller,
      target: call.handoff.target,
      purpose: call.handoff.purpose,
      summary: call.handoff.summary,
      ...(call.handoff.question === undefined
        ? {}
        : { question: call.handoff.question }),
      ...(call.handoff.artifactRefs === undefined
        ? {}
        : { artifactRefs: [...call.handoff.artifactRefs] }),
    },
  }));
}
