import { AgentConfigManager } from "./agent-config-manager.js";
import { validateAgentResult } from "./agent-result-validator.js";
import { ArtifactManager } from "./artifact-manager.js";
import { ContextBuilder } from "./context-builder.js";
import { PlanManager } from "./plan-manager.js";
import { ProjectManager } from "./project-manager.js";
import { ProviderRouter } from "./provider-router.js";
import { ResultProcessor } from "./result-processor.js";
import {
  CODER_PLANNER_CALL_PURPOSES,
  RoleContractRegistry,
} from "./role-contract-registry.js";
import { RuleResolver } from "./rule-resolver.js";
import { SessionManager } from "./session-manager.js";
import { TaskManager } from "./task-manager.js";
import type { AgentName } from "../domain/agent.js";
import type {
  AgentExecutor,
  AgentInvocationResult,
  ForbiddenHelperCallClassification,
  HelperCallClassification,
  HelperCallUnavailableErrorCode,
  UserAgentInvocationRequest,
} from "../domain/agent-invocation.js";
import type { RequestedAgentCall } from "../domain/agent-result.js";
import {
  AgentExecutionFailedError,
  NoProjectBoundError,
  NoTaskBoundError,
  PlanDraftPendingError,
  ReviewTargetNotAvailableError,
  SynaphexError,
  TaskArchivedError,
  TaskCompletedError,
} from "../domain/errors.js";
import type { RuntimeAvailability } from "../domain/provider-routing.js";
import type { Project } from "../domain/project.js";
import type { Task } from "../domain/task.js";
import { StateStore } from "../infrastructure/state-store.js";

export interface AgentInvocationServiceOptions {
  readonly executor: AgentExecutor;
  readonly runtimeAvailability: RuntimeAvailability;
  readonly synaphexRoot?: string;
  readonly homeDirectory?: string;
}

interface InvocationScope {
  readonly project: Project;
  readonly task: Task | null;
}

export class AgentInvocationService {
  private readonly executor: AgentExecutor;
  private readonly sessions: SessionManager;
  private readonly projects: ProjectManager;
  private readonly tasks: TaskManager;
  private readonly plans: PlanManager;
  private readonly artifacts: ArtifactManager;
  private readonly configs: AgentConfigManager;
  private readonly contextBuilder: ContextBuilder;
  private readonly router: ProviderRouter;
  private readonly resultProcessor: ResultProcessor;
  private readonly roleContracts: RoleContractRegistry;
  private readonly rules: RuleResolver;

  constructor(options: AgentInvocationServiceOptions) {
    this.executor = options.executor;
    const store = new StateStore(options.synaphexRoot);
    this.projects = new ProjectManager(store, {
      ...(options.homeDirectory === undefined
        ? {}
        : { homeDirectory: options.homeDirectory }),
    });
    this.sessions = new SessionManager(store);
    this.tasks = new TaskManager(store, this.projects);
    this.plans = new PlanManager(store, this.tasks);
    this.artifacts = new ArtifactManager(store, this.projects, this.tasks);
    this.configs = new AgentConfigManager(store);
    this.contextBuilder = new ContextBuilder({
      ...(options.synaphexRoot === undefined
        ? {}
        : { synaphexRoot: options.synaphexRoot }),
      ...(options.homeDirectory === undefined
        ? {}
        : { homeDirectory: options.homeDirectory }),
    });
    this.router = new ProviderRouter(options.runtimeAvailability);
    this.resultProcessor = new ResultProcessor({
      ...(options.synaphexRoot === undefined
        ? {}
        : { synaphexRoot: options.synaphexRoot }),
      ...(options.homeDirectory === undefined
        ? {}
        : { homeDirectory: options.homeDirectory }),
    });
    this.roleContracts = new RoleContractRegistry();
    this.rules = new RuleResolver(
      store,
      this.projects,
      this.tasks,
      this.roleContracts,
    );
  }

  async invokeUserAgent<TAgent extends AgentName>(
    request: UserAgentInvocationRequest<TAgent>,
  ): Promise<AgentInvocationResult<TAgent>> {
    const scope = await this.resolveAndValidatePreflight(
      request.sessionId,
      request.agent,
    );
    const config = await this.configs.validateAgent(request.agent);
    const context = await this.contextBuilder.build({
      sessionId: request.sessionId,
      agent: request.agent,
      ...(request.instruction === undefined
        ? {}
        : { instruction: request.instruction }),
    });
    const route = await this.router.resolve({
      host: request.host,
      targetConfig: config,
    });

    let rawResult: unknown;
    try {
      rawResult = await this.executor.execute({ route, context });
    } catch (error) {
      throw new AgentExecutionFailedError(
        request.agent,
        route.provider,
        route.effectiveSurface,
        { cause: error },
      );
    }

    const validatedResult = validateAgentResult(request.agent, rawResult);
    const helperCalls = await this.classifyHelperCalls(
      validatedResult.requestedCalls ?? [],
      request.agent,
      scope,
    );
    // ResultProcessor deliberately validates again at the mutation boundary.
    const processedResult = await this.resultProcessor.process({
      sessionId: request.sessionId,
      expectedAgent: request.agent,
      result: validatedResult,
    });
    return {
      agent: request.agent,
      route,
      processedResult,
      helperCalls,
    };
  }

  private async resolveAndValidatePreflight(
    sessionId: string,
    agent: AgentName,
  ): Promise<InvocationScope> {
    const binding = await this.sessions.getCurrentBinding(sessionId);
    if (binding.projectId === null) {
      throw new NoProjectBoundError(sessionId);
    }
    const project = await this.projects.get(binding.projectId);
    const task =
      binding.taskId === null
        ? null
        : await this.tasks.get(binding.projectId, binding.taskId);
    const contract = this.roleContracts.getInvocationLifecycleContract(agent);
    if (task === null && contract.taskBinding === "required") {
      throw new NoTaskBoundError(sessionId);
    }
    if (
      task !== null &&
      !contract.allowedTaskStatuses.includes(task.status)
    ) {
      if (task.status === "archived") {
        throw new TaskArchivedError(task.id);
      }
      throw new TaskCompletedError(task.id);
    }

    if (agent === "coder" && task !== null && (await this.plans.hasDraft(task.id))) {
      throw new PlanDraftPendingError(task.id);
    }
    if (
      agent === "reviewer" &&
      task !== null &&
      (await this.artifacts.listCoderWorkRecords({
        kind: "task",
        projectId: project.id,
        taskId: task.id,
      })).length === 0
    ) {
      throw new ReviewTargetNotAvailableError(task.id);
    }
    return { project, task };
  }

  private async classifyHelperCalls(
    calls: readonly RequestedAgentCall[],
    caller: AgentName,
    scope: InvocationScope,
  ): Promise<HelperCallClassification[]> {
    const classifications: HelperCallClassification[] = [];
    for (const request of calls) {
      let immutable;
      try {
        immutable = await this.evaluateImmutableHelperCall(
          caller,
          request,
          scope,
        );
      } catch (error) {
        const errorCode = unavailableErrorCode(error);
        if (errorCode === null) {
          throw error;
        }
        classifications.push({
          status: "unavailable",
          request,
          immutableReason: null,
          effectiveRule: null,
          errorCode,
        });
        continue;
      }
      if (!immutable.allowed) {
        classifications.push({
          status: "forbidden",
          request,
          immutableReason:
            immutable.reason as ForbiddenHelperCallClassification["immutableReason"],
          effectiveRule: null,
        });
        continue;
      }

      let effectiveRule;
      try {
        effectiveRule = await this.rules.resolveRuleReadOnly(
          { kind: "agent_call", caller, target: request.target },
          {
            projectId: scope.project.id,
            ...(scope.task === null ? {} : { taskId: scope.task.id }),
          },
        );
      } catch (error) {
        const errorCode = unavailableErrorCode(error);
        if (errorCode === null) {
          throw error;
        }
        classifications.push({
          status: "unavailable",
          request,
          immutableReason: immutable.reason,
          effectiveRule: null,
          errorCode,
        });
        continue;
      }
      classifications.push({
        status:
          effectiveRule.decision === "allow"
            ? "allowed"
            : effectiveRule.decision === "ask"
              ? "approval_required"
              : "denied",
        request,
        immutableReason: immutable.reason,
        effectiveRule,
      });
    }
    return classifications;
  }

  private async evaluateImmutableHelperCall(
    caller: AgentName,
    request: RequestedAgentCall,
    scope: InvocationScope,
  ) {
    if (caller !== "coder" || request.target !== "planner") {
      return this.roleContracts.evaluateAgentCall(caller, request.target);
    }
    const acceptedPlanExists =
      scope.task !== null && (await this.plans.hasAcceptedPlan(scope.task.id));
    return this.roleContracts.evaluateAgentCall(caller, request.target, {
      acceptedPlanExists,
      ...((CODER_PLANNER_CALL_PURPOSES as readonly string[]).includes(
        request.purpose,
      )
        ? {
            purpose: request.purpose as (typeof CODER_PLANNER_CALL_PURPOSES)[number],
          }
        : {}),
    });
  }
}

function unavailableErrorCode(
  error: unknown,
): HelperCallUnavailableErrorCode | null {
  if (!(error instanceof SynaphexError)) {
    return null;
  }
  switch (error.code) {
    case "INVALID_RULE":
    case "INVALID_RULE_VALUE":
    case "AGENT_UNCONFIGURED":
    case "AGENT_CONFIGURATION_REMOVED":
    case "INVALID_AGENT_CONFIG":
    case "INVALID_AGENT_MODEL":
    case "INVALID_AGENT_SETTING":
      return error.code;
    default:
      return null;
  }
}
