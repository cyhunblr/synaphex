import { AgentBehaviorManager } from "./agent-behavior-manager.js";
import { parseAgentHandoff } from "./agent-handoff-validator.js";
import { ArtifactManager } from "./artifact-manager.js";
import { MemoryManager } from "./memory-manager.js";
import { PlanManager } from "./plan-manager.js";
import { ProjectManager } from "./project-manager.js";
import { RoleContractRegistry } from "./role-contract-registry.js";
import { RuleResolver } from "./rule-resolver.js";
import { SessionManager } from "./session-manager.js";
import { TaskManager } from "./task-manager.js";
import { AGENT_NAMES, isAgentName, type AgentName } from "../domain/agent.js";
import type {
  AgentArtifactContext,
  AgentContext,
  AgentContextRequest,
  AgentMemoryContext,
  AgentPlanContext,
  AgentRuleContext,
  LoadedMemoryContextEntry,
} from "../domain/agent-context.js";
import type { AgentBehavior } from "../domain/agent-behavior.js";
import type {
  ArtifactRecord,
  CoderArtifactRecord,
  ResearchArtifactRecord,
  ReviewerArtifactRecord,
  TaskArtifactScope,
} from "../domain/artifact.js";
import {
  InvalidAgentContextError,
  InvalidAgentHandoffError,
  NoProjectBoundError,
  NoTaskBoundError,
  TaskArchivedError,
  TaskCompletedError,
} from "../domain/errors.js";
import type { MemoryScope, MemorySourceIdentity } from "../domain/memory.js";
import type { Project } from "../domain/project.js";
import type { Task } from "../domain/task.js";
import { StateStore } from "../infrastructure/state-store.js";

export interface ContextBuilderOptions {
  readonly synaphexRoot?: string;
  readonly homeDirectory?: string;
}

export class ContextBuilder {
  private readonly sessions: SessionManager;
  private readonly projects: ProjectManager;
  private readonly tasks: TaskManager;
  private readonly rules: RuleResolver;
  private readonly roleContracts: RoleContractRegistry;
  private readonly memory: MemoryManager;
  private readonly plans: PlanManager;
  private readonly artifacts: ArtifactManager;
  private readonly behavior: AgentBehaviorManager;

  constructor(options: ContextBuilderOptions = {}) {
    const store = new StateStore(options.synaphexRoot);
    this.projects = new ProjectManager(store, {
      ...(options.homeDirectory === undefined
        ? {}
        : { homeDirectory: options.homeDirectory }),
    });
    this.sessions = new SessionManager(store);
    this.tasks = new TaskManager(store, this.projects);
    this.roleContracts = new RoleContractRegistry();
    this.rules = new RuleResolver(
      store,
      this.projects,
      this.tasks,
      this.roleContracts,
    );
    this.memory = new MemoryManager(store, this.projects, this.tasks);
    this.plans = new PlanManager(store, this.tasks);
    this.artifacts = new ArtifactManager(store, this.projects, this.tasks);
    this.behavior = new AgentBehaviorManager(store);
  }

  async build(request: AgentContextRequest): Promise<AgentContext> {
    if (!isAgentName(request.agent)) {
      throw new InvalidAgentContextError("target agent is not recognized");
    }
    if (
      request.instruction !== undefined &&
      (typeof request.instruction !== "string" ||
        request.instruction.trim().length === 0)
    ) {
      throw new InvalidAgentContextError(
        "instruction must be non-empty when provided",
      );
    }
    const handoff =
      request.handoff === undefined
        ? undefined
        : parseAgentHandoff(request.handoff, request.agent);

    const binding = await this.sessions.getCurrentBinding(request.sessionId);
    if (binding.projectId === null) {
      throw new NoProjectBoundError(request.sessionId);
    }
    const project = await this.projects.get(binding.projectId);
    const task =
      binding.taskId === null
        ? null
        : await this.tasks.get(binding.projectId, binding.taskId);
    this.assertRolePreconditions(request.sessionId, request.agent, task);

    const targetScope: MemoryScope =
      task === null
        ? { kind: "project", projectId: project.id }
        : { kind: "task", projectId: project.id, taskId: task.id };
    const [memory, rules, plan, artifacts, behavior] = await Promise.all([
      this.buildMemory(project, task, targetScope),
      this.buildRules(request.agent, project, task),
      this.buildPlan(request.agent, task),
      this.buildArtifacts(request.agent, project, task, handoff?.artifactRefs),
      this.buildBehavior(request.agent),
    ]);

    return {
      agent: request.agent,
      project,
      task,
      roleContract: this.roleContracts.getSnapshot(request.agent),
      rules,
      memory,
      plan,
      artifacts,
      behavior,
      ...(request.instruction === undefined
        ? {}
        : { instruction: request.instruction }),
      ...(handoff === undefined ? {} : { handoff }),
    };
  }

  private assertRolePreconditions(
    sessionId: string,
    agent: AgentName,
    task: Task | null,
  ): void {
    const taskRequired =
      agent === "questioner" ||
      agent === "planner" ||
      agent === "coder" ||
      agent === "reviewer";
    if (taskRequired && task === null) {
      throw new NoTaskBoundError(sessionId);
    }
    if (task === null) {
      return;
    }
    if (task.status === "archived") {
      throw new TaskArchivedError(task.id);
    }
    const activeRequired = taskRequired;
    if (activeRequired && task.status === "completed") {
      throw new TaskCompletedError(task.id);
    }
  }

  private async buildMemory(
    project: Project,
    task: Task | null,
    targetScope: MemoryScope,
  ): Promise<AgentMemoryContext> {
    const [projectMemory, taskMemory, loadedReferences] = await Promise.all([
      this.memory.getProjectCanonicalMemory(project.id),
      task === null
        ? Promise.resolve(null)
        : this.memory.getTaskCanonicalMemory(project.id, task.id),
      this.memory.listLoadedReferences(targetScope),
    ]);
    const directlyLoaded: LoadedMemoryContextEntry[] = await Promise.all(
      loadedReferences.map(async (reference) => ({
        reference,
        memory: await this.memory.getCanonicalMemory(
          scopeFromSource(reference.source),
        ),
      })),
    );
    return { project: projectMemory, task: taskMemory, directlyLoaded };
  }

  private async buildRules(
    agent: AgentName,
    project: Project,
    task: Task | null,
  ): Promise<AgentRuleContext> {
    const context = {
      projectId: project.id,
      ...(task === null ? {} : { taskId: task.id }),
    };
    const [outgoingAgentCalls, effectiveRules] = await Promise.all([
      Promise.all(
        AGENT_NAMES.map((target) =>
          this.rules.resolveRuleReadOnly(
            { kind: "agent_call", caller: agent, target },
            context,
          ),
        ),
      ),
      this.rules.listEffectiveRulesReadOnly(context),
    ]);
    return {
      outgoingAgentCalls,
      actions: effectiveRules.filter(({ key }) => key.kind === "action"),
    };
  }

  private async buildPlan(
    agent: AgentName,
    task: Task | null,
  ): Promise<AgentPlanContext | null> {
    if (
      task === null ||
      (agent !== "planner" && agent !== "coder" && agent !== "reviewer")
    ) {
      return null;
    }
    const [current, draft] = await Promise.all([
      this.plans.getCurrent(task.id),
      this.plans.getDraft(task.id),
    ]);
    return {
      current,
      draft: agent === "planner" ? draft : null,
      hasPendingDraft: draft !== null,
    };
  }

  private async buildArtifacts(
    agent: AgentName,
    project: Project,
    task: Task | null,
    artifactRefs: readonly `artifact_${string}`[] | undefined,
  ): Promise<AgentArtifactContext> {
    const taskScope: TaskArtifactScope | null =
      task === null
        ? null
        : { kind: "task", projectId: project.id, taskId: task.id };
    const explicitlyReferenced = await this.resolveArtifactRefs(
      project,
      task,
      artifactRefs ?? [],
    );
    let questionerContext: AgentArtifactContext["questionerContext"] = null;
    let research: readonly ResearchArtifactRecord[] = [];
    let coderWorkRecords: readonly CoderArtifactRecord[] = [];
    let latestReviewerReport: ReviewerArtifactRecord | null = null;

    if (taskScope !== null) {
      if (agent === "questioner" || agent === "planner") {
        questionerContext = await this.artifacts.getQuestionerContext(taskScope);
      }
      if (agent === "planner" || agent === "coder" || agent === "reviewer") {
        research = await this.artifacts.listResearchArtifacts(taskScope);
      }
      if (agent === "reviewer") {
        coderWorkRecords = await this.artifacts.listCoderWorkRecords(taskScope);
      }
      if (agent === "planner" || agent === "coder" || agent === "reviewer") {
        latestReviewerReport = (
          await this.artifacts.listReviewerReports(taskScope)
        ).at(-1) ?? null;
      }
    }

    return {
      questionerContext,
      research,
      coderWorkRecords,
      latestReviewerReport,
      explicitlyReferenced,
    };
  }

  private async resolveArtifactRefs(
    project: Project,
    task: Task | null,
    refs: readonly `artifact_${string}`[],
  ): Promise<ArtifactRecord[]> {
    const artifacts: ArtifactRecord[] = [];
    for (const ref of refs) {
      const artifact = await this.artifacts.findRunArtifactById(ref);
      if (artifact.scope.projectId !== project.id) {
        throw new InvalidAgentHandoffError(
          `artifact ${ref} belongs to a different project`,
        );
      }
      if (
        task !== null &&
        artifact.scope.kind === "task" &&
        artifact.scope.taskId !== task.id
      ) {
        throw new InvalidAgentHandoffError(
          `artifact ${ref} belongs to a different task`,
        );
      }
      artifacts.push(artifact);
    }
    return artifacts;
  }

  private async buildBehavior(agent: AgentName): Promise<AgentBehavior | null> {
    if (agent !== "researcher" && agent !== "coder" && agent !== "reviewer") {
      return null;
    }
    return this.behavior.peekBehavior(agent);
  }
}

function scopeFromSource(source: MemorySourceIdentity): MemoryScope {
  return source.kind === "project"
    ? { kind: "project", projectId: source.projectId }
    : {
        kind: "task",
        projectId: source.projectId,
        taskId: source.taskId,
      };
}
