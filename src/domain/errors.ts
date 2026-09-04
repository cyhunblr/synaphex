import type { AgentName } from "./agent.js";
import type {
  ActionExecutionKind,
  ActionName,
  HostActionName,
} from "./action.js";
import type { AgentProvider } from "./agent-config.js";
import type { AgentSurface } from "./agent-config.js";
import type { HostRuntime } from "./provider-routing.js";
import type { ProjectId } from "./project.js";
import type { MemoryScope } from "./memory.js";
import type {
  ArtifactCategory,
  ArtifactId,
  ArtifactScope,
} from "./artifact.js";
import {
  formatRuleKey,
  type EffectiveRuleSource,
  type RuleDecision,
  type RuleKey,
} from "./rule.js";
import type { SessionId } from "./session.js";
import type { TaskId, TaskStatus } from "./task.js";

export const SYNAPHEX_ERROR_CODES = [
  "PROJECT_PATH_NOT_FOUND",
  "PROJECT_PATH_ALREADY_REGISTERED",
  "PROJECT_NOT_FOUND",
  "AMBIGUOUS_PROJECT_REFERENCE",
  "INVALID_PROJECT_PATH",
  "INVALID_SESSION_ID",
  "SESSION_ALREADY_BOUND_TO_TASK",
  "INVALID_TASK_DESCRIPTION",
  "TASK_NOT_FOUND",
  "AMBIGUOUS_TASK_REFERENCE",
  "TASK_COMPLETED",
  "TASK_ARCHIVED",
  "TASK_ALREADY_BOUND",
  "TASK_SESSION_OWNERSHIP_LOST",
  "INVALID_TASK_TRANSITION",
  "NO_PROJECT_BOUND",
  "TASK_BINDING_LOCK_TIMEOUT",
  "INVALID_RULE",
  "INVALID_RULE_VALUE",
  "IMMUTABLE_CONTRACT_VIOLATION",
  "NO_TASK_BOUND",
  "INVALID_PLAN_CONTENT",
  "NO_PLAN_DRAFT",
  "PLAN_ALREADY_ACCEPTED",
  "PLAN_DRAFT_REVISION_MISMATCH",
  "PLAN_MUTATION_LOCK_TIMEOUT",
  "MEMORY_SOURCE_NOT_FOUND",
  "MEMORY_ALREADY_LOADED",
  "MEMORY_NOT_LOADED",
  "MEMORY_LOAD_CYCLE",
  "INVALID_MEMORY_REFERENCE",
  "MEMORY_MUTATION_LOCK_TIMEOUT",
  "INVALID_ARTIFACT",
  "INVALID_ARTIFACT_PAYLOAD",
  "INVALID_ARTIFACT_SCOPE",
  "ARTIFACT_NOT_FOUND",
  "AGENT_UNCONFIGURED",
  "AGENT_CONFIGURATION_REMOVED",
  "INVALID_AGENT_CONFIG",
  "INVALID_AGENT_MODEL",
  "INVALID_AGENT_SETTING",
  "INVALID_AGENT_BEHAVIOR",
  "UNSUPPORTED_AGENT_BEHAVIOR",
  "INVALID_PROVIDER_ROUTE",
  "PROVIDER_CLI_UNAVAILABLE",
  "NATIVE_HOST_EXECUTION_UNAVAILABLE",
  "INVALID_AGENT_CONTEXT",
  "INVALID_AGENT_HANDOFF",
  "INVALID_AGENT_RESULT",
  "PLAN_DRAFT_PENDING",
  "REVIEW_TARGET_NOT_AVAILABLE",
  "AGENT_EXECUTION_FAILED",
  "AGENT_CALL_APPROVAL_REQUIRED",
  "AGENT_CALL_DENIED",
  "AGENT_CALL_FORBIDDEN",
  "AGENT_CALL_UNAVAILABLE",
  "ACTION_APPROVAL_REQUIRED",
  "ACTION_DENIED",
  "ACTION_UNAVAILABLE",
  "INVALID_ACTION_CONTINUATION",
  "INVALID_ACTION_EXECUTION_KIND",
  "HOST_ACTION_APPROVAL_REQUIRED",
  "HOST_ACTION_DENIED",
  "HOST_ACTION_UNAVAILABLE",
  "INVALID_HOST_ACTION_AUTHORIZATION",
  "AGENT_INVOCATION_DEPTH_EXCEEDED",
  "UNSUPPORTED_AGENT_INVOCATION",
  "PROVIDER_EXECUTION_POLICY_UNSUPPORTED",
  "CODEX_CLI_EXECUTION_FAILED",
  "CLAUDE_CLI_EXECUTION_FAILED",
  "ANTIGRAVITY_CLI_EXECUTION_FAILED",
] as const;

export type SynaphexErrorCode = (typeof SYNAPHEX_ERROR_CODES)[number];

export class SynaphexError<
  TCode extends SynaphexErrorCode = SynaphexErrorCode,
> extends Error {
  readonly code: TCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: TCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class ProjectPathNotFoundError extends SynaphexError<"PROJECT_PATH_NOT_FOUND"> {
  constructor(sourcePath: string, options?: ErrorOptions) {
    super(
      "PROJECT_PATH_NOT_FOUND",
      `Project source path does not exist: ${sourcePath}`,
      { sourcePath },
      options,
    );
  }
}

export class ProjectPathAlreadyRegisteredError extends SynaphexError<"PROJECT_PATH_ALREADY_REGISTERED"> {
  constructor(sourcePath: string, projectId: ProjectId) {
    super(
      "PROJECT_PATH_ALREADY_REGISTERED",
      `Project source path is already registered: ${sourcePath}`,
      { sourcePath, projectId },
    );
  }
}

export class ProjectNotFoundError extends SynaphexError<"PROJECT_NOT_FOUND"> {
  constructor(projectReference: string) {
    super(
      "PROJECT_NOT_FOUND",
      `Project was not found: ${projectReference}`,
      { projectReference },
    );
  }
}

export class AmbiguousProjectReferenceError extends SynaphexError<"AMBIGUOUS_PROJECT_REFERENCE"> {
  constructor(projectReference: string, projectIds: readonly ProjectId[]) {
    super(
      "AMBIGUOUS_PROJECT_REFERENCE",
      `Project reference matches more than one project: ${projectReference}`,
      { projectReference, projectIds },
    );
  }
}

export class InvalidProjectPathError extends SynaphexError<"INVALID_PROJECT_PATH"> {
  constructor(sourcePath: string, reason: string, options?: ErrorOptions) {
    super(
      "INVALID_PROJECT_PATH",
      `Invalid project source path (${reason}): ${sourcePath}`,
      { sourcePath, reason },
      options,
    );
  }
}

export class InvalidSessionIdError extends SynaphexError<"INVALID_SESSION_ID"> {
  constructor(reason: string) {
    super("INVALID_SESSION_ID", `Invalid session id: ${reason}`, { reason });
  }
}

export class SessionAlreadyBoundToTaskError extends SynaphexError<"SESSION_ALREADY_BOUND_TO_TASK"> {
  constructor(sessionId: SessionId, taskId: TaskId) {
    super(
      "SESSION_ALREADY_BOUND_TO_TASK",
      `Session ${sessionId} is already bound to task ${taskId}`,
      { sessionId, taskId },
    );
  }
}

export class InvalidTaskDescriptionError extends SynaphexError<"INVALID_TASK_DESCRIPTION"> {
  constructor() {
    super(
      "INVALID_TASK_DESCRIPTION",
      "Task description must not be empty",
    );
  }
}

export class TaskNotFoundError extends SynaphexError<"TASK_NOT_FOUND"> {
  constructor(projectId: ProjectId | null, taskReference: string) {
    super(
      "TASK_NOT_FOUND",
      projectId === null
        ? `Task was not found: ${taskReference}`
        : `Task was not found in project ${projectId}: ${taskReference}`,
      { projectId, taskReference },
    );
  }
}

export class AmbiguousTaskReferenceError extends SynaphexError<"AMBIGUOUS_TASK_REFERENCE"> {
  constructor(
    projectId: ProjectId,
    taskReference: string,
    taskIds: readonly TaskId[],
  ) {
    super(
      "AMBIGUOUS_TASK_REFERENCE",
      `Task reference matches more than one task in project ${projectId}: ${taskReference}`,
      { projectId, taskReference, taskIds },
    );
  }
}

export class TaskCompletedError extends SynaphexError<"TASK_COMPLETED"> {
  constructor(taskId: TaskId) {
    super("TASK_COMPLETED", `Completed task cannot be resumed: ${taskId}`, {
      taskId,
    });
  }
}

export class TaskArchivedError extends SynaphexError<"TASK_ARCHIVED"> {
  constructor(taskId: TaskId) {
    super("TASK_ARCHIVED", `Archived task cannot be resumed: ${taskId}`, {
      taskId,
    });
  }
}

export class TaskAlreadyBoundError extends SynaphexError<"TASK_ALREADY_BOUND"> {
  constructor(taskId: TaskId, ownerSessionId: SessionId) {
    super(
      "TASK_ALREADY_BOUND",
      `Task ${taskId} is already bound to another writable session`,
      { taskId, ownerSessionId },
    );
  }
}

/**
 * Raised when a task-bound operation's ownership fence is no longer current:
 * the claim was released, force-released, or replaced by a new claim instance.
 *
 * Distinct from `TASK_ALREADY_BOUND`, which reports that a task cannot be
 * claimed. This reports that authority already held has been revoked, so a
 * completed provider result must not commit.
 *
 * The replacement owner's SessionId is deliberately NOT included.
 */
export class TaskSessionOwnershipLostError extends SynaphexError<"TASK_SESSION_OWNERSHIP_LOST"> {
  constructor(taskId: TaskId, sessionId: SessionId, phase: "preflight" | "commit") {
    super(
      "TASK_SESSION_OWNERSHIP_LOST",
      `Task session ownership was lost before ${phase}: ${taskId}`,
      { taskId, sessionId, phase },
    );
  }
}

export class InvalidTaskTransitionError extends SynaphexError<"INVALID_TASK_TRANSITION"> {
  constructor(taskId: TaskId, from: TaskStatus, to: TaskStatus) {
    super(
      "INVALID_TASK_TRANSITION",
      `Task ${taskId} cannot transition from ${from} to ${to}`,
      { taskId, from, to },
    );
  }
}

export class NoProjectBoundError extends SynaphexError<"NO_PROJECT_BOUND"> {
  constructor(sessionId: SessionId) {
    super("NO_PROJECT_BOUND", `Session has no project bound: ${sessionId}`, {
      sessionId,
    });
  }
}

export class TaskBindingLockTimeoutError extends SynaphexError<"TASK_BINDING_LOCK_TIMEOUT"> {
  constructor() {
    super(
      "TASK_BINDING_LOCK_TIMEOUT",
      "Timed out waiting to update task binding state",
    );
  }
}

export class InvalidRuleError extends SynaphexError<"INVALID_RULE"> {
  constructor(reason: string) {
    super("INVALID_RULE", `Invalid rule: ${reason}`, { reason });
  }
}

export class InvalidRuleValueError extends SynaphexError<"INVALID_RULE_VALUE"> {
  constructor(value: unknown) {
    super("INVALID_RULE_VALUE", `Invalid rule decision: ${String(value)}`, {
      value,
    });
  }
}

export class ImmutableContractViolationError extends SynaphexError<"IMMUTABLE_CONTRACT_VIOLATION"> {
  constructor(key: RuleKey, decision: RuleDecision) {
    super(
      "IMMUTABLE_CONTRACT_VIOLATION",
      `Rule ${formatRuleKey(key)} cannot be set to ${decision} because it violates an immutable role contract`,
      { key, decision },
    );
  }
}

export class NoTaskBoundError extends SynaphexError<"NO_TASK_BOUND"> {
  constructor(sessionId: SessionId) {
    super("NO_TASK_BOUND", `Session has no task bound: ${sessionId}`, {
      sessionId,
    });
  }
}

export class InvalidPlanContentError extends SynaphexError<"INVALID_PLAN_CONTENT"> {
  constructor() {
    super("INVALID_PLAN_CONTENT", "Plan content must not be empty");
  }
}

export class NoPlanDraftError extends SynaphexError<"NO_PLAN_DRAFT"> {
  constructor(taskId: TaskId) {
    super("NO_PLAN_DRAFT", `Task has no plan draft to accept: ${taskId}`, {
      taskId,
    });
  }
}

export class PlanAlreadyAcceptedError extends SynaphexError<"PLAN_ALREADY_ACCEPTED"> {
  constructor(taskId: TaskId) {
    super(
      "PLAN_ALREADY_ACCEPTED",
      `Task already has an accepted plan and no pending revision: ${taskId}`,
      { taskId },
    );
  }
}

/**
 * Raised when a plan decision names a draft revision that is not the current
 * persisted draft instance.
 *
 * This is the stale-review and same-content-ABA fence: the user decided about
 * a specific draft instance, and that instance is gone or was replaced. The
 * current draft content is deliberately NOT included -- the user must call the
 * plan-read tool again and review the new draft explicitly.
 */
export class PlanDraftRevisionMismatchError extends SynaphexError<"PLAN_DRAFT_REVISION_MISMATCH"> {
  constructor(taskId: TaskId, suppliedRevisionId: string) {
    super(
      "PLAN_DRAFT_REVISION_MISMATCH",
      `The supplied plan draft revision is not the current draft for task ${taskId}`,
      { taskId, suppliedRevisionId },
    );
  }
}

export class PlanMutationLockTimeoutError extends SynaphexError<"PLAN_MUTATION_LOCK_TIMEOUT"> {
  constructor() {
    super(
      "PLAN_MUTATION_LOCK_TIMEOUT",
      "Timed out waiting to update plan state",
    );
  }
}

export class MemorySourceNotFoundError extends SynaphexError<"MEMORY_SOURCE_NOT_FOUND"> {
  constructor(source: MemoryScope) {
    super(
      "MEMORY_SOURCE_NOT_FOUND",
      `Canonical memory source scope does not exist: ${formatMemoryScope(source)}`,
      { source },
    );
  }
}

export class MemoryAlreadyLoadedError extends SynaphexError<"MEMORY_ALREADY_LOADED"> {
  constructor(target: MemoryScope, source: MemoryScope) {
    super(
      "MEMORY_ALREADY_LOADED",
      `Memory source ${formatMemoryScope(source)} is already loaded into ${formatMemoryScope(target)}`,
      { target, source },
    );
  }
}

export class MemoryNotLoadedError extends SynaphexError<"MEMORY_NOT_LOADED"> {
  constructor(target: MemoryScope, source: MemoryScope) {
    super(
      "MEMORY_NOT_LOADED",
      `Memory source ${formatMemoryScope(source)} is not loaded into ${formatMemoryScope(target)}`,
      { target, source },
    );
  }
}

export class MemoryLoadCycleError extends SynaphexError<"MEMORY_LOAD_CYCLE"> {
  constructor(target: MemoryScope, source: MemoryScope) {
    super(
      "MEMORY_LOAD_CYCLE",
      `Loading ${formatMemoryScope(source)} into ${formatMemoryScope(target)} would create a memory-reference cycle`,
      { target, source },
    );
  }
}

export class InvalidMemoryReferenceError extends SynaphexError<"INVALID_MEMORY_REFERENCE"> {
  constructor(reason: string) {
    super(
      "INVALID_MEMORY_REFERENCE",
      `Invalid loaded-memory reference: ${reason}`,
      { reason },
    );
  }
}

export class MemoryMutationLockTimeoutError extends SynaphexError<"MEMORY_MUTATION_LOCK_TIMEOUT"> {
  constructor() {
    super(
      "MEMORY_MUTATION_LOCK_TIMEOUT",
      "Timed out waiting to update loaded-memory references",
    );
  }
}

export class InvalidArtifactError extends SynaphexError<"INVALID_ARTIFACT"> {
  constructor(reason: string) {
    super("INVALID_ARTIFACT", `Invalid persisted artifact: ${reason}`, {
      reason,
    });
  }
}

export class InvalidArtifactPayloadError extends SynaphexError<"INVALID_ARTIFACT_PAYLOAD"> {
  constructor(reason: string) {
    super(
      "INVALID_ARTIFACT_PAYLOAD",
      `Artifact payload is not safely JSON-serializable: ${reason}`,
      { reason },
    );
  }
}

export class InvalidArtifactScopeError extends SynaphexError<"INVALID_ARTIFACT_SCOPE"> {
  constructor(category: ArtifactCategory, scope: ArtifactScope) {
    super(
      "INVALID_ARTIFACT_SCOPE",
      `Artifact category ${category} is not valid for ${formatArtifactScope(scope)}`,
      { category, scope },
    );
  }
}

export class ArtifactNotFoundError extends SynaphexError<"ARTIFACT_NOT_FOUND"> {
  constructor(artifactId: ArtifactId) {
    super("ARTIFACT_NOT_FOUND", `Artifact was not found: ${artifactId}`, {
      artifactId,
    });
  }
}

export class AgentUnconfiguredError extends SynaphexError<"AGENT_UNCONFIGURED"> {
  constructor(agent: AgentName) {
    super("AGENT_UNCONFIGURED", `Agent is not configured: ${agent}`, {
      agent,
    });
  }
}

export class AgentConfigurationRemovedError extends SynaphexError<"AGENT_CONFIGURATION_REMOVED"> {
  constructor(agent: AgentName, previousProvider: AgentProvider) {
    super(
      "AGENT_CONFIGURATION_REMOVED",
      `Agent configuration was removed with provider ${previousProvider}: ${agent}`,
      { agent, previousProvider, reason: "provider_removed" },
    );
  }
}

export class InvalidAgentConfigError extends SynaphexError<"INVALID_AGENT_CONFIG"> {
  constructor(agent: AgentName | null, reason: string) {
    super(
      "INVALID_AGENT_CONFIG",
      agent === null
        ? `Invalid agent configuration state: ${reason}`
        : `Invalid configuration for agent ${agent}: ${reason}`,
      { agent, reason },
    );
  }
}

export class InvalidAgentModelError extends SynaphexError<"INVALID_AGENT_MODEL"> {
  constructor(agent: AgentName, reason: string) {
    super(
      "INVALID_AGENT_MODEL",
      `Invalid model configuration for agent ${agent}: ${reason}`,
      { agent, reason },
    );
  }
}

export class InvalidAgentSettingError extends SynaphexError<"INVALID_AGENT_SETTING"> {
  constructor(agent: AgentName, setting: string, reason: string) {
    super(
      "INVALID_AGENT_SETTING",
      `Invalid setting ${setting} for agent ${agent}: ${reason}`,
      { agent, setting, reason },
    );
  }
}

export class InvalidAgentBehaviorError extends SynaphexError<"INVALID_AGENT_BEHAVIOR"> {
  constructor(agent: AgentName | null, reason: string) {
    super(
      "INVALID_AGENT_BEHAVIOR",
      agent === null
        ? `Invalid agent behavior state: ${reason}`
        : `Invalid behavior for agent ${agent}: ${reason}`,
      { agent, reason },
    );
  }
}

export class UnsupportedAgentBehaviorError extends SynaphexError<"UNSUPPORTED_AGENT_BEHAVIOR"> {
  constructor(agent: AgentName) {
    super(
      "UNSUPPORTED_AGENT_BEHAVIOR",
      `Agent does not support configurable output behavior: ${agent}`,
      { agent },
    );
  }
}

export class InvalidProviderRouteError extends SynaphexError<"INVALID_PROVIDER_ROUTE"> {
  constructor(
    host: HostRuntime,
    provider: AgentProvider,
    configuredSurface: AgentSurface,
    effectiveSurface: AgentSurface,
  ) {
    super(
      "INVALID_PROVIDER_ROUTE",
      `A ${host.provider}/${host.surface} host cannot invoke the same provider's ${configuredSurface} surface; configure the target agent for CLI execution`,
      {
        hostProvider: host.provider,
        hostSurface: host.surface,
        provider,
        configuredSurface,
        effectiveSurface,
        reason: "same_provider_vscode_target_from_cli",
      },
    );
  }
}

export class ProviderCliUnavailableError extends SynaphexError<"PROVIDER_CLI_UNAVAILABLE"> {
  constructor(
    host: HostRuntime,
    provider: AgentProvider,
    configuredSurface: AgentSurface,
  ) {
    super(
      "PROVIDER_CLI_UNAVAILABLE",
      `Required provider CLI runtime is unavailable: ${provider}`,
      {
        hostProvider: host.provider,
        hostSurface: host.surface,
        provider,
        configuredSurface,
        effectiveSurface: "cli",
      },
    );
  }
}

/**
 * Raised when a resolved ExecutionRoute is VALID but Synaphex has no callable
 * bridge for it -- specifically a `same_provider_native` route whose
 * `effectiveSurface` is `vscode`.
 *
 * Deliberately distinct from `INVALID_PROVIDER_ROUTE` (the router rejected the
 * route itself) and from `PROVIDER_CLI_UNAVAILABLE` (a CLI runtime is missing).
 * Here the route is legitimate and execution support is simply absent, so the
 * dispatcher fails closed rather than silently spawning a provider CLI and
 * reporting it as native VS Code execution.
 */
export class NativeHostExecutionUnavailableError extends SynaphexError<"NATIVE_HOST_EXECUTION_UNAVAILABLE"> {
  constructor(
    provider: AgentProvider,
    surface: AgentSurface,
    agent: AgentName,
  ) {
    super(
      "NATIVE_HOST_EXECUTION_UNAVAILABLE",
      `Native host execution is not available for ${provider}/${surface}`,
      { provider, surface, agent },
    );
  }
}

export class InvalidAgentContextError extends SynaphexError<"INVALID_AGENT_CONTEXT"> {
  constructor(reason: string) {
    super("INVALID_AGENT_CONTEXT", `Invalid agent context: ${reason}`, {
      reason,
    });
  }
}

export class InvalidAgentHandoffError extends SynaphexError<"INVALID_AGENT_HANDOFF"> {
  constructor(reason: string) {
    super("INVALID_AGENT_HANDOFF", `Invalid agent handoff: ${reason}`, {
      reason,
    });
  }
}

export class InvalidAgentResultError extends SynaphexError<"INVALID_AGENT_RESULT"> {
  constructor(agent: AgentName | null, reason: string) {
    super(
      "INVALID_AGENT_RESULT",
      agent === null
        ? `Invalid agent result: ${reason}`
        : `Invalid result for agent ${agent}: ${reason}`,
      { agent, reason },
    );
  }
}

export class PlanDraftPendingError extends SynaphexError<"PLAN_DRAFT_PENDING"> {
  constructor(taskId: TaskId) {
    super(
      "PLAN_DRAFT_PENDING",
      `Coder invocation is blocked while task ${taskId} has a pending plan draft`,
      { taskId },
    );
  }
}

export class ReviewTargetNotAvailableError extends SynaphexError<"REVIEW_TARGET_NOT_AVAILABLE"> {
  constructor(taskId: TaskId) {
    super(
      "REVIEW_TARGET_NOT_AVAILABLE",
      `Task has no persisted Coder work record to review: ${taskId}`,
      { taskId },
    );
  }
}

export class AgentExecutionFailedError extends SynaphexError<"AGENT_EXECUTION_FAILED"> {
  constructor(
    agent: AgentName,
    provider: AgentProvider,
    surface: AgentSurface,
    options?: ErrorOptions,
  ) {
    super(
      "AGENT_EXECUTION_FAILED",
      `Agent execution failed at the provider boundary: ${agent}`,
      { agent, provider, surface },
      options,
    );
  }
}

export class AgentCallApprovalRequiredError extends SynaphexError<"AGENT_CALL_APPROVAL_REQUIRED"> {
  constructor(
    caller: AgentName,
    target: AgentName,
    previousStatus: string,
    currentStatus: string,
    source: string | null,
  ) {
    super(
      "AGENT_CALL_APPROVAL_REQUIRED",
      `One-time approval is required for ${caller} to invoke ${target}`,
      { caller, target, previousStatus, currentStatus, source },
    );
  }
}

export class AgentCallDeniedError extends SynaphexError<"AGENT_CALL_DENIED"> {
  constructor(
    caller: AgentName,
    target: AgentName,
    previousStatus: string,
    currentStatus: string,
    source: string | null,
  ) {
    super(
      "AGENT_CALL_DENIED",
      `Agent call is denied: ${caller} -> ${target}`,
      { caller, target, previousStatus, currentStatus, source },
    );
  }
}

export class AgentCallForbiddenError extends SynaphexError<"AGENT_CALL_FORBIDDEN"> {
  constructor(
    caller: AgentName,
    target: AgentName,
    previousStatus: string,
    currentStatus: string,
    reason: string | null,
  ) {
    super(
      "AGENT_CALL_FORBIDDEN",
      `Immutable role contract forbids agent call: ${caller} -> ${target}`,
      { caller, target, previousStatus, currentStatus, reason },
    );
  }
}

export class AgentCallUnavailableError extends SynaphexError<"AGENT_CALL_UNAVAILABLE"> {
  constructor(
    caller: AgentName,
    target: AgentName,
    previousStatus: string,
    currentStatus: string,
    classificationErrorCode: string | null,
  ) {
    super(
      "AGENT_CALL_UNAVAILABLE",
      `Agent-call permission is unavailable: ${caller} -> ${target}`,
      {
        caller,
        target,
        previousStatus,
        currentStatus,
        classificationErrorCode,
      },
    );
  }
}

export class ActionApprovalRequiredError extends SynaphexError<"ACTION_APPROVAL_REQUIRED"> {
  constructor(action: ActionName, source: EffectiveRuleSource) {
    super(
      "ACTION_APPROVAL_REQUIRED",
      `One-time approval is required for action: ${action}`,
      { action, source },
    );
  }
}

export class ActionDeniedError extends SynaphexError<"ACTION_DENIED"> {
  constructor(action: ActionName, source: EffectiveRuleSource) {
    super("ACTION_DENIED", `Action is denied: ${action}`, { action, source });
  }
}

export class ActionUnavailableError extends SynaphexError<"ACTION_UNAVAILABLE"> {
  constructor(action: ActionName, classificationErrorCode: string | null) {
    super(
      "ACTION_UNAVAILABLE",
      `Action permission is unavailable: ${action}`,
      { action, classificationErrorCode },
    );
  }
}

export class InvalidActionContinuationError extends SynaphexError<"INVALID_ACTION_CONTINUATION"> {
  constructor(reason: string) {
    super(
      "INVALID_ACTION_CONTINUATION",
      `Invalid action-approval continuation: ${reason}`,
      { reason },
    );
  }
}

export class InvalidActionExecutionKindError extends SynaphexError<"INVALID_ACTION_EXECUTION_KIND"> {
  constructor(
    action: ActionName,
    expected: ActionExecutionKind,
    actual: ActionExecutionKind,
  ) {
    super(
      "INVALID_ACTION_EXECUTION_KIND",
      `Action ${action} cannot use the ${expected} execution path`,
      { action, expected, actual },
    );
  }
}

export class HostActionApprovalRequiredError extends SynaphexError<"HOST_ACTION_APPROVAL_REQUIRED"> {
  constructor(action: HostActionName, source: EffectiveRuleSource) {
    super(
      "HOST_ACTION_APPROVAL_REQUIRED",
      `One-time approval is required for host action: ${action}`,
      { action, source },
    );
  }
}

export class HostActionDeniedError extends SynaphexError<"HOST_ACTION_DENIED"> {
  constructor(action: HostActionName, source: EffectiveRuleSource) {
    super("HOST_ACTION_DENIED", `Host action is denied: ${action}`, {
      action,
      source,
    });
  }
}

export class HostActionUnavailableError extends SynaphexError<"HOST_ACTION_UNAVAILABLE"> {
  constructor(action: HostActionName, classificationErrorCode: string | null) {
    super(
      "HOST_ACTION_UNAVAILABLE",
      `Host-action permission is unavailable: ${action}`,
      { action, classificationErrorCode },
    );
  }
}

export class InvalidHostActionAuthorizationError extends SynaphexError<"INVALID_HOST_ACTION_AUTHORIZATION"> {
  constructor(reason: string) {
    super(
      "INVALID_HOST_ACTION_AUTHORIZATION",
      `Invalid host-action authorization: ${reason}`,
      { reason },
    );
  }
}

export class ProviderExecutionPolicyUnsupportedError extends SynaphexError<"PROVIDER_EXECUTION_POLICY_UNSUPPORTED"> {
  constructor(provider: AgentProvider, reason: string, action?: ActionName) {
    super(
      "PROVIDER_EXECUTION_POLICY_UNSUPPORTED",
      `Provider cannot safely enforce the requested execution policy: ${provider}`,
      { provider, reason, ...(action === undefined ? {} : { action }) },
    );
  }
}

/**
 * Raised when an invocation target or scope is not permitted by the calling
 * surface -- for example an agent that is not exposed through MCP Phase 3A, an
 * agent whose role may modify the source workspace, or a project-scope request
 * made against a task-bound session.
 *
 * Distinct from the Core lifecycle errors, which describe why a legitimately
 * exposed agent cannot run right now.
 */
export class UnsupportedAgentInvocationError extends SynaphexError<"UNSUPPORTED_AGENT_INVOCATION"> {
  constructor(agent: string, reason: string) {
    super(
      "UNSUPPORTED_AGENT_INVOCATION",
      `Agent invocation is not supported: ${agent} (${reason})`,
      { agent, reason },
    );
  }
}

export class AgentInvocationDepthExceededError extends SynaphexError<"AGENT_INVOCATION_DEPTH_EXCEEDED"> {
  constructor(currentDepth: number, attemptedDepth: number, maximumDepth: number) {
    super(
      "AGENT_INVOCATION_DEPTH_EXCEEDED",
      `Agent invocation depth ${attemptedDepth} exceeds maximum ${maximumDepth}`,
      { currentDepth, attemptedDepth, maximumDepth },
    );
  }
}

export type CodexCliExecutionFailureReason =
  | "unsupported_route"
  | "unsupported_settings"
  | "invalid_workspace"
  | "temporary_io"
  | "spawn_failed"
  | "non_zero_exit"
  | "timeout"
  | "missing_result"
  | "empty_result"
  | "malformed_result";

export class CodexCliExecutionError extends SynaphexError<"CODEX_CLI_EXECUTION_FAILED"> {
  constructor(
    reason: CodexCliExecutionFailureReason,
    details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(
      "CODEX_CLI_EXECUTION_FAILED",
      `OpenAI Codex CLI execution failed: ${reason.replaceAll("_", " ")}`,
      { reason, ...details },
      options,
    );
  }
}

export type ClaudeCliExecutionFailureReason =
  | "unsupported_route"
  | "unsupported_settings"
  | "invalid_workspace"
  | "unsupported_cli_capability"
  | "spawn_failed"
  | "timeout"
  | "stdout_overflow"
  | "non_zero_exit"
  | "malformed_output"
  | "missing_structured_output"
  | "structured_output_error"
  | "invalid_execution_policy";

export class ClaudeCliExecutionError extends SynaphexError<"CLAUDE_CLI_EXECUTION_FAILED"> {
  constructor(
    reason: ClaudeCliExecutionFailureReason,
    details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(
      "CLAUDE_CLI_EXECUTION_FAILED",
      `Anthropic Claude CLI execution failed: ${reason.replaceAll("_", " ")}`,
      { reason, ...details },
      options,
    );
  }
}

export type AntigravityCliExecutionFailureReason =
  | "unsupported_route"
  | "unsupported_settings"
  | "invalid_workspace"
  | "unsupported_execution_policy"
  | "unsupported_cli_capability"
  | "temporary_io"
  | "spawn_failed"
  | "timeout"
  | "stdout_overflow"
  | "non_zero_exit"
  | "malformed_output"
  | "provider_error"
  | "missing_structured_output";

export class AntigravityCliExecutionError extends SynaphexError<"ANTIGRAVITY_CLI_EXECUTION_FAILED"> {
  constructor(
    reason: AntigravityCliExecutionFailureReason,
    details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(
      "ANTIGRAVITY_CLI_EXECUTION_FAILED",
      `Google Antigravity CLI execution failed: ${reason.replaceAll("_", " ")}`,
      { reason, ...details },
      options,
    );
  }
}

function formatMemoryScope(scope: MemoryScope): string {
  return scope.kind === "project"
    ? `project:${scope.projectId}`
    : `task:${scope.taskId}`;
}

function formatArtifactScope(scope: ArtifactScope): string {
  return scope.kind === "project"
    ? `project:${scope.projectId}`
    : `task:${scope.taskId}`;
}
