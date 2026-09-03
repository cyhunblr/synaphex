import { randomUUID } from "node:crypto";
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
  AgentHandoff,
  RoleContractSnapshot,
} from "../domain/agent-context.js";
import type {
  AgentExecutor,
  AgentInvocationResult,
  ActionApprovalContinuationRequest,
  ActionClassification,
  ActionUnavailableErrorCode,
  AnyAgentInvocationResult,
  CallerContinuation,
  ForbiddenHelperCallClassification,
  HelperCallClassification,
  HelperCallUnavailableErrorCode,
  HelperContinuationOutcome,
  HelperExecutionRequest,
  HelperExecutionResult,
  InvocationId,
  InvocationLineage,
  ResumeCallerRequest,
  UserAgentInvocationRequest,
} from "../domain/agent-invocation.js";
import type {
  RequestedAction,
  RequestedAgentCall,
} from "../domain/agent-result.js";
import type { ExecutionPolicy } from "../domain/execution-policy.js";
import { sourceModificationPolicy } from "../domain/execution-policy.js";
import {
  ActionApprovalRequiredError,
  ActionDeniedError,
  ActionUnavailableError,
  AgentCallApprovalRequiredError,
  AgentCallDeniedError,
  AgentCallForbiddenError,
  AgentCallUnavailableError,
  AgentExecutionFailedError,
  AgentInvocationDepthExceededError,
  InvalidAgentHandoffError,
  InvalidActionContinuationError,
  NoProjectBoundError,
  NoTaskBoundError,
  PlanDraftPendingError,
  ReviewTargetNotAvailableError,
  SynaphexError,
  TaskArchivedError,
  TaskCompletedError,
} from "../domain/errors.js";
import { ACTION_NAMES, type ActionName } from "../domain/rule.js";
import type { RuntimeAvailability } from "../domain/provider-routing.js";
import type { Project } from "../domain/project.js";
import type { SessionId } from "../domain/session.js";
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

interface PreparedInvocation<TAgent extends AgentName> {
  readonly sessionId: SessionId;
  readonly agent: TAgent;
  readonly host: UserAgentInvocationRequest["host"];
  readonly scope: InvocationScope;
  readonly lineage: InvocationLineage;
  readonly instruction?: string;
  readonly handoff?: AgentHandoff;
  readonly approvedActions?: ReadonlySet<ActionName>;
}

const MAX_INVOCATION_DEPTH = 8;

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
    return this.invokePrepared({
      sessionId: request.sessionId,
      agent: request.agent,
      host: request.host,
      scope,
      lineage: createRootLineage(request.agent),
      ...(request.instruction === undefined
        ? {}
        : { instruction: request.instruction }),
    });
  }

  async executeHelper(
    request: HelperExecutionRequest,
  ): Promise<HelperExecutionResult> {
    const previousClassification = findParentClassification(
      request.parentInvocation,
      request.helperClassification,
    );
    const caller = request.parentInvocation.agent;
    const target = previousClassification.request.target;

    await this.resolveAndValidatePreflight(request.sessionId, caller);
    const helperScope = await this.resolveAndValidatePreflight(
      request.sessionId,
      target,
    );
    const effectiveClassification = await this.classifySingleHelperCall(
      previousClassification.request,
      caller,
      helperScope,
    );
    assertHelperExecutable(
      previousClassification,
      effectiveClassification,
      request.approvalGranted === true,
    );
    const lineage = createChildLineage(
      request.parentInvocation.lineage,
      target,
    );

    const helperInvocation = (await this.invokePrepared({
      sessionId: request.sessionId,
      agent: target,
      host: request.host,
      scope: helperScope,
      lineage,
      handoff: previousClassification.request.handoff,
    })) as AnyAgentInvocationResult;
    const continuation = await this.buildContinuation(
      caller,
      previousClassification.request,
      helperInvocation,
      helperScope,
    );
    return {
      previousClassification,
      effectiveClassification,
      helperInvocation,
      continuation,
    };
  }

  async resumeCaller(
    request: ResumeCallerRequest,
  ): Promise<AgentInvocationResult> {
    const { continuation, helperInvocation } = request.helperExecution;
    assertContinuationIntegrity(request.helperExecution);
    const lineage = createChildLineage(
      helperInvocation.lineage,
      continuation.originalCaller,
    );
    const scope = await this.resolveAndValidatePreflight(
      request.sessionId,
      continuation.originalCaller,
    );
    return this.invokePrepared({
      sessionId: request.sessionId,
      agent: continuation.originalCaller,
      host: request.host,
      scope,
      lineage,
      handoff: continuation.handoff,
      ...(request.instruction === undefined
        ? {}
        : { instruction: request.instruction }),
    });
  }

  async resumeCallerWithActionApproval(
    request: ActionApprovalContinuationRequest,
  ): Promise<AgentInvocationResult> {
    const previousClassification = findActionClassification(
      request.previousInvocation,
      request.actionClassification,
    );
    if (previousClassification.status !== "approval_required") {
      throw new InvalidActionContinuationError(
        "only an approval_required action can be continued",
      );
    }

    const scope = await this.resolveAndValidatePreflight(
      request.sessionId,
      request.previousInvocation.agent,
    );
    const effectiveClassification = await this.classifySingleAction(
      previousClassification.request,
      scope,
    );
    assertActionContinuationAllowed(
      effectiveClassification,
      request.approvalGranted,
    );
    const approvedActions =
      effectiveClassification.status === "approval_required" &&
      request.approvalGranted
        ? new Set<ActionName>([effectiveClassification.request.action])
        : new Set<ActionName>();

    return this.invokePrepared({
      sessionId: request.sessionId,
      agent: request.previousInvocation.agent,
      host: request.host,
      scope,
      lineage: createChildLineage(
        request.previousInvocation.lineage,
        request.previousInvocation.agent,
      ),
      approvedActions,
      ...(request.instruction === undefined
        ? {}
        : { instruction: request.instruction }),
    });
  }

  private async invokePrepared<TAgent extends AgentName>(
    invocation: PreparedInvocation<TAgent>,
  ): Promise<AgentInvocationResult<TAgent>> {
    const config = await this.configs.validateAgent(invocation.agent);
    const context = await this.contextBuilder.build({
      sessionId: invocation.sessionId,
      agent: invocation.agent,
      ...(invocation.instruction === undefined
        ? {}
        : { instruction: invocation.instruction }),
      ...(invocation.handoff === undefined
        ? {}
        : { handoff: invocation.handoff }),
    });
    const executionPolicy = await this.buildExecutionPolicy(
      context.roleContract,
      invocation.scope,
      invocation.approvedActions ?? new Set<ActionName>(),
    );
    const route = await this.router.resolve({
      host: invocation.host,
      targetConfig: config,
    });

    let rawResult: unknown;
    try {
      rawResult = await this.executor.execute({
        route,
        context,
        executionPolicy,
      });
    } catch (error) {
      throw new AgentExecutionFailedError(
        invocation.agent,
        route.provider,
        route.effectiveSurface,
        { cause: error },
      );
    }

    const validatedResult = validateAgentResult(invocation.agent, rawResult);
    const helperCalls = await this.classifyHelperCalls(
      validatedResult.requestedCalls ?? [],
      invocation.agent,
      invocation.scope,
    );
    const actionClassifications = await this.classifyActions(
      validatedResult.requestedActions ?? [],
      invocation.scope,
    );
    // ResultProcessor deliberately validates again at the mutation boundary.
    const processedResult = await this.resultProcessor.process({
      sessionId: invocation.sessionId,
      expectedAgent: invocation.agent,
      result: validatedResult,
    });
    return {
      agent: invocation.agent,
      lineage: invocation.lineage,
      route,
      executionPolicy,
      processedResult,
      helperCalls,
      actionClassifications,
    };
  }

  private async buildExecutionPolicy(
    roleContract: RoleContractSnapshot,
    scope: InvocationScope,
    approvedActions: ReadonlySet<ActionName>,
  ): Promise<ExecutionPolicy> {
    const effectiveRules = await Promise.all(
      ACTION_NAMES.map((action) =>
        this.rules.resolveRuleReadOnly(
          { kind: "action", action },
          {
            projectId: scope.project.id,
            ...(scope.task === null ? {} : { taskId: scope.task.id }),
          },
        ),
      ),
    );
    return {
      sourceModification: sourceModificationPolicy(roleContract),
      actions: Object.fromEntries(
        ACTION_NAMES.map((action, index) => [
          action,
          {
            decision: effectiveRules[index]!.decision,
            source: effectiveRules[index]!.source,
            approvedForInvocation:
              effectiveRules[index]!.decision === "ask" &&
              approvedActions.has(action),
          },
        ]),
      ) as ExecutionPolicy["actions"],
    };
  }

  private async resolveAndValidatePreflight(
    sessionId: SessionId,
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

    if (
      agent === "coder" &&
      task !== null &&
      (await this.plans.hasDraft(task.id))
    ) {
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

  private async classifySingleHelperCall(
    request: RequestedAgentCall,
    caller: AgentName,
    scope: InvocationScope,
  ): Promise<HelperCallClassification> {
    const classification = (
      await this.classifyHelperCalls([request], caller, scope)
    )[0];
    if (classification === undefined) {
      throw new TypeError("Helper classification unexpectedly produced no result");
    }
    return classification;
  }

  private async classifySingleAction(
    request: RequestedAction,
    scope: InvocationScope,
  ): Promise<ActionClassification> {
    const classification = (await this.classifyActions([request], scope))[0];
    if (classification === undefined) {
      throw new TypeError("Action classification unexpectedly produced no result");
    }
    return classification;
  }

  private async classifyActions(
    actions: readonly RequestedAction[],
    scope: InvocationScope,
  ): Promise<ActionClassification[]> {
    const classifications: ActionClassification[] = [];
    for (const request of actions) {
      try {
        const effectiveRule = await this.rules.resolveRuleReadOnly(
          { kind: "action", action: request.action },
          {
            projectId: scope.project.id,
            ...(scope.task === null ? {} : { taskId: scope.task.id }),
          },
        );
        classifications.push({
          status:
            effectiveRule.decision === "allow"
              ? "allowed"
              : effectiveRule.decision === "ask"
                ? "approval_required"
                : "denied",
          request,
          effectiveRule,
        });
      } catch (error) {
        const errorCode = actionUnavailableErrorCode(error);
        if (errorCode === null) {
          throw error;
        }
        classifications.push({
          status: "unavailable",
          request,
          effectiveRule: null,
          errorCode,
        });
      }
    }
    return classifications;
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

  private async buildContinuation(
    originalCaller: AgentName,
    originalRequest: RequestedAgentCall,
    helperInvocation: AnyAgentInvocationResult,
    scope: InvocationScope,
  ): Promise<CallerContinuation> {
    const processed = helperInvocation.processedResult;
    const message = continuationMessage(processed);
    const helperArtifactRefs = [...processed.persistedArtifacts];
    const blockedByPendingPlan =
      originalCaller === "coder" &&
      helperInvocation.agent === "planner" &&
      scope.task !== null &&
      (await this.plans.hasDraft(scope.task.id));
    const summary =
      message === undefined
        ? processed.summary
        : `${processed.summary}\n\nHelper response: ${message}`;
    return {
      status: blockedByPendingPlan ? "blocked_by_pending_plan" : "ready",
      originalCaller,
      helperAgent: helperInvocation.agent,
      originalPurpose: originalRequest.purpose,
      helperSummary: processed.summary,
      helperArtifactRefs,
      helperOutcome: continuationOutcome(processed),
      ...(message === undefined ? {} : { message }),
      handoff: {
        caller: helperInvocation.agent,
        target: originalCaller,
        purpose: originalRequest.purpose,
        summary,
        ...(helperArtifactRefs.length === 0
          ? {}
          : { artifactRefs: helperArtifactRefs.map(({ id }) => id) }),
      },
      lineage: helperInvocation.lineage,
    };
  }
}

function createInvocationId(): InvocationId {
  return `invocation_${randomUUID().replaceAll("-", "")}`;
}

function createRootLineage(agent: AgentName): InvocationLineage {
  const id = createInvocationId();
  return {
    rootInvocationId: id,
    currentInvocationId: id,
    parentInvocationId: null,
    depth: 0,
    agent,
  };
}

function createChildLineage(
  parent: InvocationLineage,
  agent: AgentName,
): InvocationLineage {
  const depth = parent.depth + 1;
  if (depth > MAX_INVOCATION_DEPTH) {
    throw new AgentInvocationDepthExceededError(
      parent.depth,
      depth,
      MAX_INVOCATION_DEPTH,
    );
  }
  return {
    rootInvocationId: parent.rootInvocationId,
    currentInvocationId: createInvocationId(),
    parentInvocationId: parent.currentInvocationId,
    depth,
    agent,
  };
}

function findParentClassification(
  parent: AnyAgentInvocationResult,
  supplied: HelperCallClassification,
): HelperCallClassification {
  if (parent.lineage.agent !== parent.agent) {
    throw new InvalidAgentHandoffError(
      "parent invocation lineage does not match its agent",
    );
  }
  const match = parent.helperCalls.find(
    (candidate) =>
      candidate.status === supplied.status &&
      JSON.stringify(candidate.request) === JSON.stringify(supplied.request),
  );
  if (match === undefined) {
    throw new InvalidAgentHandoffError(
      "helper classification does not belong to the parent invocation",
    );
  }
  return match;
}

function findActionClassification(
  parent: AnyAgentInvocationResult,
  supplied: ActionClassification,
): ActionClassification {
  if (parent.lineage.agent !== parent.agent) {
    throw new InvalidActionContinuationError(
      "previous invocation lineage does not match its agent",
    );
  }
  if (
    JSON.stringify(parent.processedResult.requestedActions) !==
    JSON.stringify(parent.actionClassifications.map(({ request }) => request))
  ) {
    throw new InvalidActionContinuationError(
      "action classifications do not match the previous invocation result",
    );
  }
  const matches = parent.actionClassifications.filter(
    (candidate) =>
      candidate.status === supplied.status &&
      JSON.stringify(candidate.request) === JSON.stringify(supplied.request),
  );
  if (matches.length !== 1) {
    throw new InvalidActionContinuationError(
      "action classification does not uniquely belong to the previous invocation",
    );
  }
  return matches[0]!;
}

function assertActionContinuationAllowed(
  current: ActionClassification,
  approvalGranted: boolean,
): void {
  if (current.status === "denied") {
    throw new ActionDeniedError(
      current.request.action,
      current.effectiveRule.source,
    );
  }
  if (current.status === "unavailable") {
    throw new ActionUnavailableError(
      current.request.action,
      current.errorCode,
    );
  }
  if (current.status === "approval_required" && !approvalGranted) {
    throw new ActionApprovalRequiredError(
      current.request.action,
      current.effectiveRule.source,
    );
  }
}

function assertHelperExecutable(
  previous: HelperCallClassification,
  current: HelperCallClassification,
  approvalGranted: boolean,
): void {
  const caller = previous.request.handoff.caller;
  const target = previous.request.target;
  if (previous.status === "denied" || current.status === "denied") {
    throw new AgentCallDeniedError(
      caller,
      target,
      previous.status,
      current.status,
      current.effectiveRule?.source ?? null,
    );
  }
  if (previous.status === "forbidden" || current.status === "forbidden") {
    const forbidden =
      current.status === "forbidden"
        ? current
        : previous.status === "forbidden"
          ? previous
          : null;
    throw new AgentCallForbiddenError(
      caller,
      target,
      previous.status,
      current.status,
      forbidden?.immutableReason ?? null,
    );
  }
  if (previous.status === "unavailable" || current.status === "unavailable") {
    const unavailable =
      current.status === "unavailable"
        ? current
        : previous.status === "unavailable"
          ? previous
          : null;
    throw new AgentCallUnavailableError(
      caller,
      target,
      previous.status,
      current.status,
      unavailable?.errorCode ?? null,
    );
  }
  if (
    (previous.status === "approval_required" ||
      current.status === "approval_required") &&
    !approvalGranted
  ) {
    throw new AgentCallApprovalRequiredError(
      caller,
      target,
      previous.status,
      current.status,
      current.effectiveRule.source,
    );
  }
}

function assertContinuationIntegrity(execution: HelperExecutionResult): void {
  const {
    previousClassification,
    effectiveClassification,
    continuation,
    helperInvocation,
  } = execution;
  const expectedArtifactIds = helperInvocation.processedResult.persistedArtifacts.map(
    ({ id }) => id,
  );
  if (
    JSON.stringify(previousClassification.request) !==
      JSON.stringify(effectiveClassification.request) ||
    continuation.originalCaller !==
      previousClassification.request.handoff.caller ||
    continuation.helperAgent !== previousClassification.request.target ||
    continuation.originalPurpose !== previousClassification.request.purpose ||
    continuation.helperAgent !== helperInvocation.agent ||
    continuation.helperOutcome.agent !== helperInvocation.agent ||
    JSON.stringify(continuation.lineage) !==
      JSON.stringify(helperInvocation.lineage) ||
    continuation.handoff.caller !== helperInvocation.agent ||
    continuation.handoff.target !== continuation.originalCaller ||
    continuation.handoff.purpose !== continuation.originalPurpose ||
    JSON.stringify(continuation.helperArtifactRefs.map(({ id }) => id)) !==
      JSON.stringify(expectedArtifactIds) ||
    JSON.stringify(continuation.handoff.artifactRefs ?? []) !==
      JSON.stringify(expectedArtifactIds)
  ) {
    throw new InvalidAgentHandoffError(
      "helper continuation does not match its helper invocation",
    );
  }
}

function continuationMessage(
  processed: AgentInvocationResult["processedResult"],
): string | undefined {
  switch (processed.agent) {
    case "questioner":
      return processed.state === "pending_question"
        ? processed.question
        : undefined;
    case "examiner":
      return processed.memoryConflict?.summary;
    case "planner":
      return processed.consultation?.message;
    case "researcher":
    case "coder":
    case "reviewer":
      return undefined;
  }
}

function continuationOutcome(
  processed: AgentInvocationResult["processedResult"],
): HelperContinuationOutcome {
  switch (processed.agent) {
    case "questioner":
      return {
        agent: processed.agent,
        outcome: processed.outcome,
        state: processed.state,
        ...(processed.state === "pending_question"
          ? { question: processed.question }
          : {}),
      };
    case "researcher":
      return { agent: processed.agent, outcome: processed.outcome };
    case "examiner":
      return {
        agent: processed.agent,
        outcome: processed.outcome,
        ...(processed.memoryConflict === undefined
          ? {}
          : { conflictSummary: processed.memoryConflict.summary }),
      };
    case "planner":
      return {
        agent: processed.agent,
        outcome: processed.outcome,
        ...(processed.consultation === undefined
          ? {}
          : { consultation: processed.consultation }),
      };
    case "coder":
      return { agent: processed.agent, outcome: processed.outcome };
    case "reviewer":
      return {
        agent: processed.agent,
        outcome: processed.outcome,
        reviewStatus: processed.reviewStatus,
        ...(processed.failureOrigin === undefined
          ? {}
          : { failureOrigin: processed.failureOrigin }),
      };
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

function actionUnavailableErrorCode(
  error: unknown,
): ActionUnavailableErrorCode | null {
  if (!(error instanceof SynaphexError)) {
    return null;
  }
  return error.code === "INVALID_RULE" || error.code === "INVALID_RULE_VALUE"
    ? error.code
    : null;
}
