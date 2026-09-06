import type { AgentName } from "./agent.js";
import type {
  ActionExecutionKind,
  ActionName,
  HostActionName,
} from "./action.js";
import type { AgentProvider } from "./agent-config.js";
import type { AgentSurface } from "./agent-config.js";
import type { McpHostContext } from "./provider-routing.js";
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
  "CODER_STAGING_REQUIRES_GIT",
  "CODER_STAGING_WORKTREE_DIRTY",
  "CODER_STAGING_UNSUPPORTED_REPOSITORY",
  "CODER_STAGING_FAILED",
  "CHANGE_SET_NOT_FOUND",
  "CHANGE_SET_CORRUPT",
  "CHANGE_SET_NOT_CURRENT_TARGET",
  "CHANGE_SET_NOT_AUTHORIZED",
  "CHANGE_SET_ALREADY_DECIDED",
  "CHANGE_SET_SOURCE_HEAD_CHANGED",
  "CHANGE_SET_SOURCE_DIRTY",
  "CHANGE_SET_APPLY_CHECK_FAILED",
  "CHANGE_SET_APPLY_INTERRUPTED",
  "CHANGE_SET_APPLY_RECOVERY_REQUIRED",
  "CHANGE_SET_NOT_INTERRUPTED",
  "TASK_HAS_PENDING_CHANGE_SET",
  "PROVIDER_RUNTIME_NOT_FOUND",
  "PROVIDER_RUNTIME_VERSION_UNSUPPORTED",
  "PROVIDER_MCP_REGISTRATION_UNSUPPORTED",
  "PROVIDER_MCP_REGISTRATION_CONFLICT",
  "PROVIDER_MCP_REGISTRATION_FAILED",
  "PROVIDER_MCP_UNREGISTRATION_FAILED",
  "SYNAPHEX_LAUNCHER_NOT_FOUND",
  "SOURCE_MUTATION_LOCK_TIMEOUT",
  "REVIEW_TARGET_REJECTED",
  "REVIEW_TARGET_APPLY_INTERRUPTED",
  "REVIEW_TARGET_CHANGED",
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
  "AGENT_TARGET_SURFACE_UNSUPPORTED",
  "INVALID_CONFIGURATION_FILE",
  "PROVIDER_CLI_UNAVAILABLE",
  "NATIVE_HOST_EXECUTION_UNAVAILABLE",
  "INVALID_AGENT_CONTEXT",
  "INVALID_AGENT_HANDOFF",
  "INVALID_AGENT_RESULT",
  "PLAN_DRAFT_PENDING",
  "REVIEW_TARGET_NOT_AVAILABLE",
  "REVIEW_TARGET_NOT_APPLIED",
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

/** Reasons a registered source workspace cannot be staged in Phase 5A. */
export type CoderStagingUnsupportedReason =
  | "submodule_gitlink"
  | "unsafe_symlink"
  | "detached_or_unborn_head"
  | "bare_repository"
  /** CODER re-added a remote inside the staging workspace. */
  | "provider_added_remote";

export class CoderStagingRequiresGitError extends SynaphexError<"CODER_STAGING_REQUIRES_GIT"> {
  constructor(projectId: ProjectId) {
    super(
      "CODER_STAGING_REQUIRES_GIT",
      "CODER staging requires the registered source workspace to be a Git worktree",
      { projectId },
    );
  }
}

/**
 * The source worktree has staged, unstaged or untracked changes.
 *
 * Synaphex never stashes, resets, cleans or commits the user's work to make
 * staging possible -- it fails closed instead.
 */
export class CoderStagingWorktreeDirtyError extends SynaphexError<"CODER_STAGING_WORKTREE_DIRTY"> {
  constructor(projectId: ProjectId, entryCount: number) {
    super(
      "CODER_STAGING_WORKTREE_DIRTY",
      "CODER staging requires a clean source worktree; commit or set aside local changes first",
      { projectId, entryCount },
    );
  }
}

export class CoderStagingUnsupportedRepositoryError extends SynaphexError<"CODER_STAGING_UNSUPPORTED_REPOSITORY"> {
  constructor(projectId: ProjectId, reason: CoderStagingUnsupportedReason) {
    super(
      "CODER_STAGING_UNSUPPORTED_REPOSITORY",
      `CODER staging does not support this repository: ${reason.replaceAll("_", " ")}`,
      { projectId, reason },
    );
  }
}

/** Infrastructure failure in Synaphex's own Git operations -- never a provider error. */
export class CoderStagingFailedError extends SynaphexError<"CODER_STAGING_FAILED"> {
  constructor(operation: string, options?: ErrorOptions) {
    super(
      "CODER_STAGING_FAILED",
      `CODER staging failed during ${operation}`,
      { operation },
      options,
    );
  }
}

export class ChangeSetNotFoundError extends SynaphexError<"CHANGE_SET_NOT_FOUND"> {
  constructor(taskId: TaskId, changeSetId: string) {
    super(
      "CHANGE_SET_NOT_FOUND",
      `Change set was not found for task ${taskId}`,
      { taskId, changeSetId },
    );
  }
}

/** The change set is not the task's current actionable CODER target. */
export class ChangeSetNotCurrentTargetError extends SynaphexError<"CHANGE_SET_NOT_CURRENT_TARGET"> {
  constructor(taskId: TaskId, changeSetId: string) {
    super(
      "CHANGE_SET_NOT_CURRENT_TARGET",
      "That change set is not the current CODER target for this task",
      { taskId, changeSetId },
    );
  }
}

/**
 * The change set has no authoritative CODER work-record reference.
 *
 * Directory existence under `changes/` is never authority: this is what makes
 * a Phase-5B orphan (published, then a crash before the work record) unusable
 * as an implementation target.
 */
export class ChangeSetNotAuthorizedError extends SynaphexError<"CHANGE_SET_NOT_AUTHORIZED"> {
  constructor(taskId: TaskId, changeSetId: string) {
    super(
      "CHANGE_SET_NOT_AUTHORIZED",
      "That change set is not referenced by an authoritative CODER work record",
      { taskId, changeSetId },
    );
  }
}

export class ChangeSetAlreadyDecidedError extends SynaphexError<"CHANGE_SET_ALREADY_DECIDED"> {
  constructor(changeSetId: string, decision: "applied" | "rejected") {
    super(
      "CHANGE_SET_ALREADY_DECIDED",
      `That change set was already ${decision}`,
      { changeSetId, decision },
    );
  }
}

export class ChangeSetSourceHeadChangedError extends SynaphexError<"CHANGE_SET_SOURCE_HEAD_CHANGED"> {
  constructor(changeSetId: string, expectedBaseCommit: string) {
    super(
      "CHANGE_SET_SOURCE_HEAD_CHANGED",
      "The source workspace HEAD no longer matches the change set baseline",
      { changeSetId, expectedBaseCommit },
    );
  }
}

export class ChangeSetSourceDirtyError extends SynaphexError<"CHANGE_SET_SOURCE_DIRTY"> {
  constructor(changeSetId: string, entryCount: number) {
    super(
      "CHANGE_SET_SOURCE_DIRTY",
      "The source workspace has local changes; applying requires a clean worktree",
      { changeSetId, entryCount },
    );
  }
}

/**
 * The exact patch could not apply to the exact baseline, or the post-apply
 * tree did not match the expected result.
 *
 * Never resolved by a merge or three-way apply: that would produce a result
 * the user never reviewed.
 */
export class ChangeSetApplyCheckFailedError extends SynaphexError<"CHANGE_SET_APPLY_CHECK_FAILED"> {
  constructor(changeSetId: string, stage: string) {
    super(
      "CHANGE_SET_APPLY_CHECK_FAILED",
      `The change set could not be applied exactly (${stage})`,
      { changeSetId, stage },
    );
  }
}

/** A durable apply intent exists with no terminal decision. */
export class ChangeSetApplyInterruptedError extends SynaphexError<"CHANGE_SET_APPLY_INTERRUPTED"> {
  constructor(changeSetId: string) {
    super(
      "CHANGE_SET_APPLY_INTERRUPTED",
      "A previous apply of this change set was interrupted and needs explicit recovery",
      { changeSetId },
    );
  }
}

/** Rollback did not restore the exact clean baseline; no further automatic action. */
export class ChangeSetApplyRecoveryRequiredError extends SynaphexError<"CHANGE_SET_APPLY_RECOVERY_REQUIRED"> {
  constructor(changeSetId: string) {
    super(
      "CHANGE_SET_APPLY_RECOVERY_REQUIRED",
      "Applying failed and the source workspace could not be restored automatically; manual recovery is required",
      { changeSetId },
    );
  }
}

/**
 * Reconciliation was requested for a change set that is not interrupted.
 *
 * Distinct from {@link ChangeSetAlreadyDecidedError}: it names the invalid
 * *reconciliation* precondition rather than an invalid apply/reject, so a
 * caller can tell "nothing to recover" from "already decided".
 */
/**
 * Manual completion was refused because the task's current CODER change set
 * still has an undecided source-mutation decision.
 *
 * The user must apply, reject or reconcile it first. This is deliberately a
 * distinct code from the plan-draft blocker so a caller knows which explicit
 * decision flow to run.
 */
// --- Phase 6B1: installer -------------------------------------------------
//
// These describe TERMINAL BOOTSTRAP conditions and are deliberately separate
// from agent-execution errors: a host that cannot be registered is not a
// provider execution failure.

export class ProviderRuntimeNotFoundError extends SynaphexError<"PROVIDER_RUNTIME_NOT_FOUND"> {
  constructor(target: string) {
    super(
      "PROVIDER_RUNTIME_NOT_FOUND",
      `No installed runtime was found for ${target}. Synaphex does not install provider software.`,
      { target },
    );
  }
}

export class ProviderRuntimeVersionUnsupportedError extends SynaphexError<"PROVIDER_RUNTIME_VERSION_UNSUPPORTED"> {
  constructor(target: string, version: string, minimum: string) {
    super(
      "PROVIDER_RUNTIME_VERSION_UNSUPPORTED",
      `${target} runtime ${version} is older than the required ${minimum}.`,
      { target, version, minimum },
    );
  }
}

export class ProviderMcpRegistrationUnsupportedError extends SynaphexError<"PROVIDER_MCP_REGISTRATION_UNSUPPORTED"> {
  constructor(target: string, reason: string) {
    super(
      "PROVIDER_MCP_REGISTRATION_UNSUPPORTED",
      `${target} has no safe MCP registration mechanism: ${reason}`,
      { target, reason },
    );
  }
}

/**
 * An MCP entry with the Synaphex name exists but is not provably
 * Synaphex-managed. It is never overwritten or deleted.
 */
export class ProviderMcpRegistrationConflictError extends SynaphexError<"PROVIDER_MCP_REGISTRATION_CONFLICT"> {
  constructor(target: string, registrationName: string) {
    super(
      "PROVIDER_MCP_REGISTRATION_CONFLICT",
      `${target} already has an MCP server named "${registrationName}" that Synaphex does not own; it was left untouched.`,
      { target, registrationName },
    );
  }
}

export class ProviderMcpRegistrationFailedError extends SynaphexError<"PROVIDER_MCP_REGISTRATION_FAILED"> {
  constructor(target: string, detail: string) {
    super(
      "PROVIDER_MCP_REGISTRATION_FAILED",
      `Registering Synaphex with ${target} failed: ${detail}`,
      { target, detail },
    );
  }
}

export class ProviderMcpUnregistrationFailedError extends SynaphexError<"PROVIDER_MCP_UNREGISTRATION_FAILED"> {
  constructor(target: string, detail: string) {
    super(
      "PROVIDER_MCP_UNREGISTRATION_FAILED",
      `Removing the Synaphex registration from ${target} failed: ${detail}`,
      { target, detail },
    );
  }
}

export class SynaphexLauncherNotFoundError extends SynaphexError<"SYNAPHEX_LAUNCHER_NOT_FOUND"> {
  constructor(detail: string) {
    super(
      "SYNAPHEX_LAUNCHER_NOT_FOUND",
      `The Synaphex MCP launcher could not be resolved: ${detail}`,
      { detail },
    );
  }
}

export class TaskHasPendingChangeSetError extends SynaphexError<"TASK_HAS_PENDING_CHANGE_SET"> {
  constructor(taskId: TaskId, changeSetId: string, state: string) {
    super(
      "TASK_HAS_PENDING_CHANGE_SET",
      "This task has an undecided CODER change set; apply, reject or reconcile it before completing",
      { taskId, changeSetId, state },
    );
  }
}

export class ChangeSetNotInterruptedError extends SynaphexError<"CHANGE_SET_NOT_INTERRUPTED"> {
  constructor(changeSetId: string, state: string) {
    super(
      "CHANGE_SET_NOT_INTERRUPTED",
      "This change set has no interrupted apply to reconcile",
      { changeSetId, state },
    );
  }
}

export class ReviewTargetRejectedError extends SynaphexError<"REVIEW_TARGET_REJECTED"> {
  constructor(taskId: TaskId, changeSetId: string) {
    super(
      "REVIEW_TARGET_REJECTED",
      "The task's current CODER change set was rejected and cannot be reviewed",
      { taskId, changeSetId },
    );
  }
}

export class ReviewTargetApplyInterruptedError extends SynaphexError<"REVIEW_TARGET_APPLY_INTERRUPTED"> {
  constructor(taskId: TaskId, changeSetId: string) {
    super(
      "REVIEW_TARGET_APPLY_INTERRUPTED",
      "The task's current CODER change set has an interrupted apply and cannot be reviewed",
      { taskId, changeSetId },
    );
  }
}

/**
 * The source no longer exactly represents the applied change set, so a review
 * would examine drifted state and a PASS could complete the task falsely.
 */
export class ReviewTargetChangedError extends SynaphexError<"REVIEW_TARGET_CHANGED"> {
  constructor(taskId: TaskId, changeSetId: string, reason: string) {
    super(
      "REVIEW_TARGET_CHANGED",
      "The source workspace no longer matches the applied change set",
      { taskId, changeSetId, reason },
    );
  }
}

/**
 * The per-project source-mutation lock could not be acquired.
 *
 * Distinct from {@link TaskBindingLockTimeoutError}: this one means another
 * apply/reject is mutating the SAME registered source workspace, so the caller
 * must retry rather than assume a task-ownership problem.
 */
export class SourceMutationLockTimeoutError extends SynaphexError<"SOURCE_MUTATION_LOCK_TIMEOUT"> {
  constructor(projectId: string) {
    super(
      "SOURCE_MUTATION_LOCK_TIMEOUT",
      `Timed out acquiring the source mutation lock for project ${projectId}.`,
    );
  }
}

export class ChangeSetCorruptError extends SynaphexError<"CHANGE_SET_CORRUPT"> {
  constructor(changeSetId: string, reason: string) {
    super(
      "CHANGE_SET_CORRUPT",
      `Change set state is corrupt: ${reason}`,
      { changeSetId, reason },
    );
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

/**
 * A configured agent target names an execution surface Synaphex cannot run.
 *
 * v0.1 executes provider CLI targets only. A `vscode` target used to be
 * silently rewritten to `cli` on a cross-provider route, which executed
 * something the user never configured; it now fails deterministically before
 * any provider runs. The user's configuration is never rewritten on their
 * behalf -- changing `vscode` to `cli` would change their intent.
 */
/**
 * A managed configuration file cannot be parsed or is semantically invalid.
 *
 * Raised BEFORE any write. Regenerating the file from defaults would discard
 * configuration the user deliberately wrote, so the original bytes are left
 * exactly as they are and the problem is reported instead.
 */
export class InvalidConfigurationFileError extends SynaphexError<"INVALID_CONFIGURATION_FILE"> {
  constructor(file: string, detail: string) {
    super(
      "INVALID_CONFIGURATION_FILE",
      `${file} could not be used: ${detail}. It was left unchanged.`,
      { file, detail },
    );
  }
}

export class AgentTargetSurfaceUnsupportedError extends SynaphexError<"AGENT_TARGET_SURFACE_UNSUPPORTED"> {
  constructor(agent: string, provider: string, surface: string) {
    super(
      "AGENT_TARGET_SURFACE_UNSUPPORTED",
      `Agent ${agent} is configured for ${provider}/${surface}, but Synaphex v0.1 executes CLI targets only`,
      { agent, provider, surface },
    );
  }
}

export class InvalidProviderRouteError extends SynaphexError<"INVALID_PROVIDER_ROUTE"> {
  constructor(
    host: McpHostContext,
    provider: AgentProvider,
    configuredSurface: AgentSurface,
    effectiveSurface: AgentSurface,
  ) {
    super(
      "INVALID_PROVIDER_ROUTE",
      `A ${host.provider} host cannot dispatch ${provider}/${configuredSurface}`,
      {
        hostProvider: host.provider,
        provider,
        configuredSurface,
        effectiveSurface,
      },
    );
  }
}

export class ProviderCliUnavailableError extends SynaphexError<"PROVIDER_CLI_UNAVAILABLE"> {
  constructor(
    host: McpHostContext,
    provider: AgentProvider,
    configuredSurface: AgentSurface,
  ) {
    super(
      "PROVIDER_CLI_UNAVAILABLE",
      `Required provider CLI runtime is unavailable: ${provider}`,
      {
        hostProvider: host.provider,
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

/**
 * The latest CODER work record describes a STAGED change set that has not been
 * applied to the registered source workspace.
 *
 * REVIEWER reads the real source, which staged CODER intentionally leaves
 * unchanged, so reviewing would examine a tree without the implementation --
 * and a PASS could complete a task on that false basis. Legacy CODER records
 * (pre-staging, direct-source execution) keep their existing behavior.
 */
export class ReviewTargetNotAppliedError extends SynaphexError<"REVIEW_TARGET_NOT_APPLIED"> {
  constructor(taskId: TaskId, changeSetId: string | null) {
    super(
      "REVIEW_TARGET_NOT_APPLIED",
      `Task ${taskId} has staged code changes that are not applied to the source workspace`,
      { taskId, changeSetId },
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
  | "unsupported_model"
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
  | "unsupported_model"
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
