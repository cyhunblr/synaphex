import { randomUUID } from "node:crypto";
import { AgentConfigManager } from "./agent-config-manager.js";
import { validateAgentResult } from "./agent-result-validator.js";
import { ArtifactManager } from "./artifact-manager.js";
import { ContextBuilder } from "./context-builder.js";
import { PlanManager } from "./plan-manager.js";
import { ProjectManager } from "./project-manager.js";
import { ProviderRouter } from "./provider-router.js";
import type { AgentContext } from "../domain/agent-context.js";
import type { ProcessedAgentResultFor } from "../domain/processed-agent-result.js";
import type { TaskId } from "../domain/task.js";
import type { ExecutionRoute } from "../domain/provider-routing.js";
import type { TaskOwnershipFence } from "./session-manager.js";
import { ChangeSetApplyManager } from "./change-set-apply-manager.js";
import { CoderChangeSetManager } from "./coder-change-set-manager.js";
import {
  CoderStagingCoordinator,
  type StagedCoderExecutionResult,
} from "./coder-staging-coordinator.js";
import { CoderWorkspaceStager } from "./coder-workspace-stager.js";
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
  ResolvedActionClassification,
  ResumeCallerRequest,
  AllowedActionContinuationRequest,
  ProviderCapabilityContinuationRequest,
  UserAgentInvocationRequest,
} from "../domain/agent-invocation.js";
import type {
  RequestedAction,
  RequestedAgentCall,
} from "../domain/agent-result.js";
import type { ExecutionPolicy } from "../domain/execution-policy.js";
import { sourceModificationPolicy } from "../domain/execution-policy.js";
import {
  ActionRegistry,
  PROVIDER_CAPABILITY_NAMES,
  type HostActionName,
  type ProviderCapabilityName,
} from "../domain/action.js";
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
  InvalidActionExecutionKindError,
  HostActionApprovalRequiredError,
  HostActionDeniedError,
  HostActionUnavailableError,
  InvalidHostActionAuthorizationError,
  NativeHostExecutionUnavailableError,
  NoProjectBoundError,
  TaskSessionOwnershipLostError,
  NoTaskBoundError,
  PlanDraftPendingError,
  ReviewTargetApplyInterruptedError,
  ReviewTargetChangedError,
  ReviewTargetNotAppliedError,
  ReviewTargetNotAvailableError,
  ReviewTargetRejectedError,
  SynaphexError,
  TaskArchivedError,
  TaskCompletedError,
} from "../domain/errors.js";
import type {
  HostActionAuthorization,
  HostActionAuthorizationId,
  HostActionAuthorizationRequest,
  HostActionAuthorizationResult,
  HostActionExecutionContext,
  HostActionExecutionInput,
} from "../domain/host-action.js";
import type { RuntimeAvailability } from "../domain/provider-routing.js";
import type { Project } from "../domain/project.js";
import type { SessionId } from "../domain/session.js";
import type { Task } from "../domain/task.js";
import { StateStore } from "../infrastructure/state-store.js";

export interface AgentInvocationServiceOptions {
  readonly executor: AgentExecutor;
  readonly runtimeAvailability: RuntimeAvailability;
  /**
   * Staged-CODER coordinator. Explicitly injected so tests can supply a
   * controlled stager; when omitted, a filesystem-backed one is composed from
   * the same state root.
   */
  readonly coderStaging?: CoderStagingCoordinator;
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
  readonly approvedActions?: ReadonlySet<ProviderCapabilityName>;
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
  private readonly coderStaging: CoderStagingCoordinator;
  private readonly changeSetApply: ChangeSetApplyManager;
  private readonly roleContracts: RoleContractRegistry;
  private readonly rules: RuleResolver;
  private readonly actionRegistry = new ActionRegistry();
  private readonly hostAuthorizations = new Map<
    HostActionAuthorizationId,
    HostActionAuthorizationResult
  >();

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
    this.changeSetApply = new ChangeSetApplyManager(store, this.tasks);
    this.coderStaging =
      options.coderStaging ??
      new CoderStagingCoordinator({
        stager: new CoderWorkspaceStager(),
        changeSets: new CoderChangeSetManager(store, this.tasks),
        sessions: this.sessions,
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

  /**
   * Continues a caller whose requested provider capability was classified
   * `approval_required`, using an explicit one-time approval.
   *
   * Authority source: `explicit_approval`. The effective rule stays `ask`; the
   * approval is invocation-scoped and never persisted.
   */
  async resumeCallerWithActionApproval(
    request: ActionApprovalContinuationRequest,
  ): Promise<AgentInvocationResult> {
    return this.resumeCallerWithProviderCapability({
      ...request,
      authorizationSource: "explicit_approval",
    });
  }

  /**
   * Continues a caller whose requested provider capability was ALREADY
   * classified `allowed` by rule.
   *
   * Authority source: `rule_allow`. No approval event exists or is invented --
   * the capability was already permitted, so no approval token is carried. The
   * continuation is still explicit user orchestration: the caller is never
   * auto-resumed just because a capability is allowed.
   */
  async resumeCallerWithAllowedAction(
    request: AllowedActionContinuationRequest,
  ): Promise<AgentInvocationResult> {
    return this.resumeCallerWithProviderCapability({
      ...request,
      approvalGranted: false,
      authorizationSource: "rule_allow",
    });
  }

  /**
   * Shared primitive for provider-capability continuation.
   *
   * The two public entrypoints differ only in their authority source, and that
   * distinction is preserved rather than erased: `rule_allow` requires the
   * trusted classification to be `allowed` and carries NO approval, while
   * `explicit_approval` requires `approval_required` and carries a one-time
   * invocation-scoped approval.
   *
   * Both are fresh executions with a continuation handoff -- no provider
   * thread or session reuse -- so a task-bound caller re-runs binding
   * preflight and captures/revalidates a fresh ownership fence.
   */
  private async resumeCallerWithProviderCapability(
    request: ProviderCapabilityContinuationRequest,
  ): Promise<AgentInvocationResult> {
    const previousClassification = findActionClassification(
      request.previousInvocation,
      request.actionClassification,
    );
    if (
      previousClassification.executionKind !== "provider_capability" ||
      !this.actionRegistry.isProviderCapability(
        previousClassification.request.action,
      )
    ) {
      // Host actions (git_push, ci) can never be continued here.
      throw new InvalidActionExecutionKindError(
        previousClassification.request.action,
        "provider_capability",
        previousClassification.executionKind,
      );
    }
    const requiredStatus =
      request.authorizationSource === "rule_allow"
        ? "allowed"
        : "approval_required";
    if (previousClassification.status !== requiredStatus) {
      throw new InvalidActionContinuationError(
        `only a ${requiredStatus} action can be continued through this path`,
      );
    }

    const scope = await this.resolveAndValidatePreflight(
      request.sessionId,
      request.previousInvocation.agent,
    );
    assertInvocationScope(
      request.previousInvocation,
      request.sessionId,
      scope,
    );
    const effectiveClassification = await this.classifySingleAction(
      previousClassification.request,
      scope,
    );
    assertActionContinuationAllowed(
      effectiveClassification,
      request.approvalGranted,
    );
    // An approval token is only meaningful for an `ask` decision. A
    // rule-allowed capability is already usable, so nothing is approved.
    const approvedActions =
      effectiveClassification.status === "approval_required" &&
      request.approvalGranted
        ? new Set<ProviderCapabilityName>([
            effectiveClassification.request.action as ProviderCapabilityName,
          ])
        : new Set<ProviderCapabilityName>();

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

  async authorizeHostAction(
    request: HostActionAuthorizationRequest,
  ): Promise<HostActionAuthorizationResult> {
    const previousClassification = findActionClassification(
      request.previousInvocation,
      request.actionClassification,
    );
    if (
      previousClassification.executionKind !== "host_action" ||
      !this.actionRegistry.isHostAction(previousClassification.request.action)
    ) {
      throw new InvalidActionExecutionKindError(
        previousClassification.request.action,
        "host_action",
        previousClassification.executionKind,
      );
    }

    const scope = await this.resolveCurrentScope(request.sessionId);
    assertInvocationScope(
      request.previousInvocation,
      request.sessionId,
      scope,
    );
    const current = await this.classifySingleAction(
      previousClassification.request,
      scope,
    );
    const action = previousClassification.request.action;
    assertHostActionAuthorizable(current, action, request.approvalGranted);

    const invocationLineage = Object.freeze({
      ...request.previousInvocation.lineage,
    });
    const effectiveRule = Object.freeze({
      ...current.effectiveRule,
      key: Object.freeze({ ...current.effectiveRule.key }),
    });
    const authorization: HostActionAuthorization = Object.freeze({
      id: createHostActionAuthorizationId(),
      executionKind: "host_action",
      action,
      sessionId: request.sessionId,
      projectId: scope.project.id,
      taskId: scope.task?.id ?? null,
      invocationLineage,
      effectiveRule,
      approvedForAuthorization:
        current.status === "approval_required" && request.approvalGranted,
    });
    const context: HostActionExecutionContext = Object.freeze({
      projectId: scope.project.id,
      sourcePath: scope.project.sourcePath,
      taskId: scope.task?.id ?? null,
      action,
      invocationLineage,
    });
    const result = Object.freeze({ authorization, context });
    this.hostAuthorizations.set(authorization.id, result);
    return result;
  }

  async validateHostActionAuthorization(
    input: HostActionExecutionInput,
  ): Promise<void> {
    const authorization = input?.authorization as unknown;
    const context = input?.context as unknown;
    if (
      !isRecord(authorization) ||
      typeof authorization.id !== "string" ||
      !authorization.id.startsWith("host_action_auth_")
    ) {
      throw new InvalidHostActionAuthorizationError(
        "authorization identity is malformed",
      );
    }
    const stored = this.hostAuthorizations.get(
      authorization.id as HostActionAuthorizationId,
    );
    if (
      stored === undefined ||
      JSON.stringify(authorization) !==
        JSON.stringify(stored.authorization) ||
      JSON.stringify(context) !== JSON.stringify(stored.context) ||
      stored.authorization.executionKind !== "host_action" ||
      !this.actionRegistry.isHostAction(stored.authorization.action) ||
      stored.authorization.action !== stored.context.action ||
      stored.authorization.projectId !== stored.context.projectId ||
      stored.authorization.taskId !== stored.context.taskId ||
      JSON.stringify(stored.authorization.invocationLineage) !==
        JSON.stringify(stored.context.invocationLineage)
    ) {
      throw new InvalidHostActionAuthorizationError(
        "authorization is unknown or does not match its execution context",
      );
    }
    const currentBinding = await this.sessions.getCurrentBinding(
      stored.authorization.sessionId,
    );
    if (
      currentBinding.projectId !== stored.authorization.projectId ||
      currentBinding.taskId !== stored.authorization.taskId
    ) {
      throw new InvalidHostActionAuthorizationError(
        "current session scope no longer matches the authorization",
      );
    }
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
      invocation.approvedActions ?? new Set<ProviderCapabilityName>(),
    );
    const route = await this.router.resolve({
      host: invocation.host,
      targetConfig: config,
    });

    // Task-ownership fencing. Captured BEFORE provider execution so the exact
    // claim instance this invocation is authorized under is pinned; a
    // project-only invocation (no task binding) has no task authority to fence
    // and is deliberately left alone.
    //
    // Every invocation path -- user, helper, and continuation -- funnels
    // through invokePrepared, so each captures its OWN current fence rather
    // than inheriting authority from a caller or an earlier lineage.
    const ownershipFence =
      invocation.scope.task === null
        ? null
        : await this.sessions.captureTaskOwnership(invocation.sessionId);
    if (invocation.scope.task !== null && ownershipFence === null) {
      throw new TaskSessionOwnershipLostError(
        invocation.scope.task.id,
        invocation.sessionId,
        "preflight",
      );
    }

    // Staged CODER: the provider edits an isolated staging clone, never the
    // registered source workspace. This applies to EVERY AgentInvocationService
    // CODER path, whatever transport the caller used.
    const stagedCoder =
      invocation.agent === "coder" && invocation.scope.task !== null
        ? await this.coderStaging.execute({
            sessionId: invocation.sessionId,
            project: invocation.scope.project,
            taskId: invocation.scope.task.id,
            ownershipFence: requireOwnershipFence(
              ownershipFence,
              invocation.scope.task.id,
              invocation.sessionId,
            ),
            // Phase 6A: the commit boundary below holds task-ownership
            // authority across BOTH the change-set publication and the work
            // record, so publication must not re-enter the same lock.
            withinOwnershipAuthority: true,
            context,
            execute: async (executionContext) => {
              try {
                return await this.executor.execute({
                  route,
                  context: executionContext,
                  executionPolicy,
                });
              } catch (error) {
                // Tag the provider failure so it still surfaces as
                // AGENT_EXECUTION_FAILED after staging unwinds, rather than
                // leaking as a raw staging-path error.
                throw new AgentExecutionFailedError(
                  invocation.agent,
                  route.provider,
                  route.effectiveSurface,
                  { cause: error },
                );
              }
            },
          })
        : null;

    try {
      return await this.completeInvocation({
        invocation,
        route,
        context,
        executionPolicy,
        ownershipFence,
        stagedCoder,
      });
    } finally {
      // Single lifecycle owner: the temp workspace and its isolated Git HOME
      // are removed on provider success, provider error, invalid AgentResult,
      // ownership loss, capture error, unsafe output, publication error and
      // ResultProcessor error alike. A published change set is durable task
      // state and is never removed by this cleanup.
      if (stagedCoder !== null) {
        await stagedCoder.dispose();
      }
    }
  }

  private async completeInvocation<TAgent extends AgentName>(input: {
    readonly invocation: PreparedInvocation<TAgent>;
    readonly route: ExecutionRoute;
    readonly context: AgentContext;
    readonly executionPolicy: ExecutionPolicy;
    readonly ownershipFence: TaskOwnershipFence | null;
    readonly stagedCoder: StagedCoderExecutionResult | null;
  }): Promise<AgentInvocationResult<TAgent>> {
    const { invocation, route, context, executionPolicy, ownershipFence, stagedCoder } =
      input;
    let rawResult: unknown;
    try {
      rawResult =
        stagedCoder === null
          ? await this.executor.execute({
              route,
              context,
              executionPolicy,
            })
          : stagedCoder.rawResult;
    } catch (error) {
      // A valid-but-undispatchable route is an infrastructure capability gap,
      // not a provider execution failure: no provider ever ran. Preserve its
      // precise identity so a client can distinguish it from a real provider
      // failure and from an invalid route.
      if (error instanceof NativeHostExecutionUnavailableError) {
        throw error;
      }
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
    // Git capture happens BEFORE the authority boundary: deriving the patch
    // and revalidating the staging repository is real work, and the
    // task-binding lock must never span it. Only the durable write below is
    // taken under the lock.
    const capturedChanges =
      stagedCoder === null ? null : await stagedCoder.capture();

    // The durable commit boundary.
    //
    // Everything above this point is provider work and pure validation. From
    // here on, task-scoped state is mutated, so ownership AND role/lifecycle
    // eligibility must both still hold -- and must stay held while the write
    // happens. `withTaskOwnershipAuthority` keeps the task-binding lock across
    // validation and the durable write, closing the check-then-mutate window
    // in which a concurrent completion or archive could interleave.
    //
    // The lock spans only this short deterministic boundary. Provider
    // execution, staging clone and Git capture all already happened above it.
    const commit = async (): Promise<ProcessedAgentResultFor<TAgent>> => {
      if (ownershipFence !== null) {
        // Re-read the task INSIDE the authority boundary: a stale scope
        // snapshot from preflight would defeat the point of re-checking.
        const currentTask = await this.tasks.get(
          invocation.scope.project.id,
          ownershipFence.taskId,
        );
        // Reuses the SAME role-contract table as preflight, so a role that is
        // legitimately allowed on a completed task (RESEARCHER, EXAMINER) is
        // not invalidated merely because the status changed while it ran.
        //
        // Note this runs BEFORE ResultProcessor: a REVIEWER PASS completes the
        // task as part of its own processing, and must not be rejected by a
        // check against the state it is itself about to create.
        this.assertRoleLifecycleEligible(
          invocation.agent,
          invocation.sessionId,
          currentTask,
        );
      }
      // Staged CODER: capture and publish the immutable change set BEFORE the
      // work record, under the task-binding ownership authority. Ordering is
      // deliberate -- a work record referencing a change set that was never
      // fully published would be worse than an orphaned change set, and apply
      // authority requires a valid work-record reference, so a bare directory
      // under `changes/` never becomes apply authority.
      const changeSet =
        stagedCoder === null || capturedChanges === null
          ? undefined
          : await stagedCoder.publish(capturedChanges);

      // ResultProcessor deliberately validates again at the mutation boundary.
      return this.resultProcessor.process({
        sessionId: invocation.sessionId,
        expectedAgent: invocation.agent,
        result: validatedResult,
        ...(changeSet === undefined ? {} : { coderChangeSet: changeSet }),
      });
    };

    // A project-only invocation has no task authority to fence, and must not
    // take the task-binding lock at all.
    //
    // Ownership loss surfaces as TASK_SESSION_OWNERSHIP_LOST rather than
    // AGENT_EXECUTION_FAILED: the provider did complete, and this is authority
    // revocation, not provider failure.
    const processedResult =
      ownershipFence === null
        ? await commit()
        : await this.sessions.withTaskOwnershipAuthority(ownershipFence, commit);
    return {
      agent: invocation.agent,
      lineage: invocation.lineage,
      scope: {
        sessionId: invocation.sessionId,
        projectId: invocation.scope.project.id,
        taskId: invocation.scope.task?.id ?? null,
      },
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
    approvedActions: ReadonlySet<ProviderCapabilityName>,
  ): Promise<ExecutionPolicy> {
    const effectiveRules = await Promise.all(
      PROVIDER_CAPABILITY_NAMES.map((action) =>
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
      providerCapabilities: Object.fromEntries(
        PROVIDER_CAPABILITY_NAMES.map((action, index) => [
          action,
          {
            decision: effectiveRules[index]!.decision,
            source: effectiveRules[index]!.source,
            approvedForInvocation:
              effectiveRules[index]!.decision === "ask" &&
              approvedActions.has(action),
          },
        ]),
      ) as ExecutionPolicy["providerCapabilities"],
    };
  }

  /**
   * The single role/lifecycle eligibility rule, shared by invocation preflight
   * and the durable commit boundary.
   *
   * Deliberately NOT "the task must be active": the role contract table is the
   * authority, and it legitimately allows RESEARCHER and EXAMINER to operate on
   * a completed task. Duplicating a second table here would let the two checks
   * drift apart.
   */
  private assertRoleLifecycleEligible(
    agent: AgentName,
    sessionId: SessionId,
    task: Task | null,
  ): void {
    const contract = this.roleContracts.getInvocationLifecycleContract(agent);
    if (task === null && contract.taskBinding === "required") {
      throw new NoTaskBoundError(sessionId);
    }
    if (task !== null && !contract.allowedTaskStatuses.includes(task.status)) {
      if (task.status === "archived") {
        throw new TaskArchivedError(task.id);
      }
      throw new TaskCompletedError(task.id);
    }
  }

  private async resolveAndValidatePreflight(
    sessionId: SessionId,
    agent: AgentName,
  ): Promise<InvocationScope> {
    const scope = await this.resolveCurrentScope(sessionId);
    const { task } = scope;
    this.assertRoleLifecycleEligible(agent, sessionId, task);

    if (
      agent === "coder" &&
      task !== null &&
      (await this.plans.hasDraft(task.id))
    ) {
      throw new PlanDraftPendingError(task.id);
    }
    if (agent === "reviewer" && task !== null) {
      const coderRecords = await this.artifacts.listCoderWorkRecords({
        kind: "task",
        projectId: scope.project.id,
        taskId: task.id,
      });
      if (coderRecords.length === 0) {
        throw new ReviewTargetNotAvailableError(task.id);
      }
      // Staged CODER leaves the registered source unchanged, so REVIEWER may
      // only proceed when the source EXACTLY represents an applied change set.
      // A legacy record has no `changeSet` field at all and keeps its accepted
      // behavior; a staged record with `changeSet: null` changed nothing.
      const latest = coderRecords[coderRecords.length - 1]!;
      if ("changeSet" in latest && latest.changeSet != null) {
        const changeSetId = latest.changeSet.id;
        const status = await this.changeSetApply.status(task.id, changeSetId);
        if (status.state === "pending") {
          throw new ReviewTargetNotAppliedError(task.id, changeSetId);
        }
        if (status.state === "rejected") {
          throw new ReviewTargetRejectedError(task.id, changeSetId);
        }
        if (status.state === "applying_interrupted") {
          throw new ReviewTargetApplyInterruptedError(task.id, changeSetId);
        }
        // Applied: the source must STILL exactly represent that target, or a
        // PASS could complete the task against drifted state.
        const drift = await this.changeSetApply.verifyAppliedStillCurrent(
          scope.project,
          status.decision!,
        );
        if (drift !== null) {
          throw new ReviewTargetChangedError(task.id, changeSetId, drift);
        }
      }
    }
    return scope;
  }

  private async resolveCurrentScope(
    sessionId: SessionId,
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
          executionKind: this.actionRegistry.get(request.action).executionKind,
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
          executionKind: this.actionRegistry.get(request.action).executionKind,
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

function createHostActionAuthorizationId(): HostActionAuthorizationId {
  return `host_action_auth_${randomUUID().replaceAll("-", "")}`;
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

function assertInvocationScope(
  invocation: AnyAgentInvocationResult,
  sessionId: SessionId,
  scope: InvocationScope,
): void {
  if (
    !isRecord(invocation.scope) ||
    invocation.scope.sessionId !== sessionId ||
    invocation.scope.projectId !== scope.project.id ||
    invocation.scope.taskId !== (scope.task?.id ?? null)
  ) {
    throw new InvalidActionContinuationError(
      "current session scope does not match the originating invocation",
    );
  }
}

/**
 * A task-bound CODER invocation must always have captured an ownership fence.
 * Missing one is a Core defect, so fail closed rather than stage unfenced.
 */
function requireOwnershipFence(
  fence: TaskOwnershipFence | null,
  taskId: TaskId,
  sessionId: SessionId,
): TaskOwnershipFence {
  if (fence === null) {
    throw new TaskSessionOwnershipLostError(taskId, sessionId, "preflight");
  }
  return fence;
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

function assertHostActionAuthorizable(
  current: ActionClassification,
  action: HostActionName,
  approvalGranted: boolean,
): asserts current is ResolvedActionClassification & {
  readonly status: "allowed" | "approval_required";
} {
  if (current.executionKind !== "host_action") {
    throw new InvalidActionExecutionKindError(
      action,
      "host_action",
      current.executionKind,
    );
  }
  if (current.status === "unavailable") {
    throw new HostActionUnavailableError(action, current.errorCode);
  }
  if (current.status === "denied") {
    throw new HostActionDeniedError(action, current.effectiveRule.source);
  }
  if (current.status === "approval_required" && !approvalGranted) {
    throw new HostActionApprovalRequiredError(
      action,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
