import { SynaphexError, type SynaphexErrorCode } from "../domain/errors.js";

/**
 * Deterministic mapping from Synaphex domain errors to MCP-safe failures.
 *
 * Core error semantics are never changed to suit MCP. Recognizable domain
 * codes are preserved so a host can branch on them; anything unrecognized
 * collapses to `INTERNAL_ERROR`. Stack traces, raw Error objects, `cause`
 * chains and provider/credential state are never sent to the client --
 * diagnostics belong on stderr.
 */

export const MCP_INTERNAL_ERROR_CODE = "INTERNAL_ERROR";

/**
 * Domain codes Phase-1 read tools can legitimately surface. Anything outside
 * this set is reported as INTERNAL_ERROR even when it is a SynaphexError, so
 * MCP never leaks the existence of unrelated subsystems.
 *
 * Core has no SESSION_NOT_FOUND or CORRUPT_STATE code, and MCP does not invent
 * domain codes: an unbound/unknown session is a normal `null` read result
 * reported as `bound: false`, not a failure. `TASK_ALREADY_BOUND` is preserved
 * verbatim so a host can distinguish the one-writable-session-per-task
 * conflict from any other failure.
 */
export const MCP_EXPOSED_ERROR_CODES: readonly SynaphexErrorCode[] =
  Object.freeze([
    "PROJECT_NOT_FOUND",
    "TASK_NOT_FOUND",
    "INVALID_RULE",
    "INVALID_RULE_VALUE",
    // Phase 2A session lifecycle.
    "INVALID_SESSION_ID",
    "TASK_COMPLETED",
    "TASK_ARCHIVED",
    "TASK_ALREADY_BOUND",
    "SESSION_ALREADY_BOUND_TO_TASK",
    "NO_PROJECT_BOUND",
    "TASK_BINDING_LOCK_TIMEOUT",
    // Phase 2C fencing + Phase 3A invocation.
    "TASK_SESSION_OWNERSHIP_LOST",
    "UNSUPPORTED_AGENT_INVOCATION",
    "NO_TASK_BOUND",
    "AGENT_UNCONFIGURED",
    "AGENT_CONFIGURATION_REMOVED",
    "INVALID_PROVIDER_ROUTE",
    "PROVIDER_CLI_UNAVAILABLE",
    "NATIVE_HOST_EXECUTION_UNAVAILABLE",
    "PROVIDER_EXECUTION_POLICY_UNSUPPORTED",
    "AGENT_EXECUTION_FAILED",
    "INVALID_AGENT_RESULT",
    "REVIEW_TARGET_NOT_AVAILABLE",
    "PLAN_DRAFT_PENDING",
    // Phase 4A bootstrap.
    "PROJECT_PATH_NOT_FOUND",
    "PROJECT_PATH_ALREADY_REGISTERED",
    "INVALID_PROJECT_PATH",
    "INVALID_TASK_DESCRIPTION",
    // Phase 4B plan decisions.
    "NO_PLAN_DRAFT",
    "PLAN_ALREADY_ACCEPTED",
    "PLAN_DRAFT_REVISION_MISMATCH",
    "PLAN_MUTATION_LOCK_TIMEOUT",
    "INVALID_PLAN_CONTENT",
    // Phase 5B staged CODER.
    "CODER_STAGING_REQUIRES_GIT",
    "CODER_STAGING_WORKTREE_DIRTY",
    "CODER_STAGING_UNSUPPORTED_REPOSITORY",
    "CODER_STAGING_FAILED",
    "REVIEW_TARGET_NOT_APPLIED",
    // Phase 5C change-set review and decisions.
    "CHANGE_SET_NOT_FOUND",
    "CHANGE_SET_CORRUPT",
    "CHANGE_SET_NOT_AUTHORIZED",
    "CHANGE_SET_NOT_CURRENT_TARGET",
    "CHANGE_SET_ALREADY_DECIDED",
    "CHANGE_SET_SOURCE_HEAD_CHANGED",
    "CHANGE_SET_SOURCE_DIRTY",
    "CHANGE_SET_APPLY_CHECK_FAILED",
    "CHANGE_SET_APPLY_INTERRUPTED",
    "CHANGE_SET_APPLY_RECOVERY_REQUIRED",
    "CHANGE_SET_NOT_INTERRUPTED",
    // Phase 6A task lifecycle.
    "TASK_HAS_PENDING_CHANGE_SET",
    "INVALID_TASK_TRANSITION",
    "SOURCE_MUTATION_LOCK_TIMEOUT",
    "REVIEW_TARGET_REJECTED",
    "REVIEW_TARGET_APPLY_INTERRUPTED",
    "REVIEW_TARGET_CHANGED",
  ] as const satisfies readonly SynaphexErrorCode[]);

export interface McpToolFailure {
  readonly code: string;
  readonly message: string;
}

const SAFE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  PROJECT_NOT_FOUND: "Project not found.",
  TASK_NOT_FOUND: "Task not found.",
  INVALID_RULE: "Rule state is invalid.",
  INVALID_RULE_VALUE: "Rule value is invalid.",
  INVALID_SESSION_ID: "Invalid session id.",
  TASK_COMPLETED: "Task is completed and cannot be opened.",
  TASK_ARCHIVED: "Task is archived and cannot be opened.",
  TASK_ALREADY_BOUND:
    "Task is already bound to another writable session.",
  SESSION_ALREADY_BOUND_TO_TASK: "Session is already bound to a task.",
  NO_PROJECT_BOUND: "Session has no project bound.",
  TASK_BINDING_LOCK_TIMEOUT:
    "Timed out waiting to update task binding state.",
  TASK_SESSION_OWNERSHIP_LOST:
    "Task session ownership was lost before the result could be committed.",
  UNSUPPORTED_AGENT_INVOCATION:
    "This agent or scope cannot be invoked through MCP.",
  NO_TASK_BOUND: "Session has no task bound.",
  AGENT_UNCONFIGURED: "Agent is not configured.",
  AGENT_CONFIGURATION_REMOVED: "Agent configuration was removed.",
  INVALID_PROVIDER_ROUTE:
    "The configured agent cannot be reached from this host.",
  PROVIDER_CLI_UNAVAILABLE: "The provider CLI runtime is unavailable.",
  NATIVE_HOST_EXECUTION_UNAVAILABLE:
    "The route is valid but native host execution is not available; configure the target agent for CLI execution.",
  PROVIDER_EXECUTION_POLICY_UNSUPPORTED:
    "The provider cannot safely enforce the required execution policy.",
  // Deliberately generic: provider stderr, command arguments, environment and
  // stack traces must never reach the client.
  AGENT_EXECUTION_FAILED: "Agent execution failed.",
  INVALID_AGENT_RESULT: "The agent returned an invalid result.",
  REVIEW_TARGET_NOT_AVAILABLE:
    "The task has no persisted Coder work record to review.",
  PLAN_DRAFT_PENDING: "A plan draft is pending acceptance.",
  PROJECT_PATH_NOT_FOUND: "The project source path does not exist.",
  PROJECT_PATH_ALREADY_REGISTERED:
    "That source path is already registered as a Synaphex project.",
  INVALID_PROJECT_PATH:
    "The project source path is not a usable directory.",
  INVALID_TASK_DESCRIPTION: "Task description must not be empty.",
  NO_PLAN_DRAFT: "The task has no plan draft.",
  PLAN_ALREADY_ACCEPTED: "The task already has an accepted plan.",
  // Deliberately does not include the current draft: the user must read the
  // plan state again and review the new draft explicitly.
  PLAN_DRAFT_REVISION_MISMATCH:
    "That plan draft revision is not the current draft; read the plan state again before deciding.",
  PLAN_MUTATION_LOCK_TIMEOUT: "Timed out waiting to update plan state.",
  INVALID_PLAN_CONTENT: "Plan content must not be empty.",
  CODER_STAGING_REQUIRES_GIT:
    "CODER requires the project source workspace to be a Git worktree.",
  CODER_STAGING_WORKTREE_DIRTY:
    "CODER requires a clean source worktree; commit or set aside local changes first.",
  CODER_STAGING_UNSUPPORTED_REPOSITORY:
    "CODER cannot safely stage this repository, or the produced changes were unsafe.",
  // Generic on purpose: raw Git stderr and paths never reach the client.
  CODER_STAGING_FAILED: "CODER workspace staging failed.",
  REVIEW_TARGET_NOT_APPLIED:
    "The task has staged code changes that are not applied to the source workspace.",
  [MCP_INTERNAL_ERROR_CODE]: "Internal Synaphex error.",
  CHANGE_SET_NOT_FOUND: "Change set not found.",
  CHANGE_SET_CORRUPT: "Change set state is corrupt.",
  CHANGE_SET_NOT_AUTHORIZED:
    "Change set is not authorised by a CODER work record for this task.",
  CHANGE_SET_NOT_CURRENT_TARGET:
    "Change set is not the task's current CODER target.",
  CHANGE_SET_ALREADY_DECIDED: "Change set has already been decided.",
  CHANGE_SET_SOURCE_HEAD_CHANGED:
    "Source HEAD no longer matches the change-set baseline.",
  CHANGE_SET_SOURCE_DIRTY: "Source workspace has uncommitted changes.",
  CHANGE_SET_APPLY_CHECK_FAILED:
    "Change set could not be applied cleanly to the source workspace.",
  CHANGE_SET_APPLY_INTERRUPTED:
    "Apply failed and the source was restored to its baseline.",
  TASK_HAS_PENDING_CHANGE_SET:
    "This task has an undecided CODER change set; apply, reject or reconcile it first.",
  INVALID_TASK_TRANSITION: "That task lifecycle transition is not allowed.",
  CHANGE_SET_NOT_INTERRUPTED:
    "This change set has no interrupted apply to reconcile.",
  CHANGE_SET_APPLY_RECOVERY_REQUIRED:
    "A previous apply was interrupted and the source must be resolved manually.",
  SOURCE_MUTATION_LOCK_TIMEOUT: "Timed out acquiring the source mutation lock.",
  REVIEW_TARGET_REJECTED: "The change set under review was rejected.",
  REVIEW_TARGET_APPLY_INTERRUPTED:
    "The change set under review was not successfully applied.",
  REVIEW_TARGET_CHANGED:
    "The applied change set no longer matches the source workspace.",
});

/** Validation failures raised before any service is touched. */
export class McpInvalidInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "McpInvalidInputError";
    this.code = code;
  }
}

const CONTINUATION_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  CONTINUATION_NOT_FOUND:
    "Continuation was not found. Continuations are process-local and do not survive an MCP restart.",
  INVALID_CONTINUATION_STATE:
    "This continuation cannot be progressed in its current state.",
  CONTINUATION_CAPACITY_EXHAUSTED:
    "Too many pending continuations; complete or abandon one before starting another.",
});

export function toMcpToolFailure(error: unknown): McpToolFailure {
  if (error instanceof McpInvalidInputError) {
    return { code: error.code, message: error.message };
  }
  // Continuation-store failures carry their own stable codes.
  const continuationCode = (error as { code?: unknown } | null)?.code;
  if (
    typeof continuationCode === "string" &&
    continuationCode in CONTINUATION_MESSAGES
  ) {
    return {
      code: continuationCode,
      message: CONTINUATION_MESSAGES[continuationCode]!,
    };
  }
  if (
    error instanceof SynaphexError &&
    (MCP_EXPOSED_ERROR_CODES as readonly string[]).includes(error.code)
  ) {
    return {
      code: error.code,
      message: SAFE_MESSAGES[error.code] ?? SAFE_MESSAGES[MCP_INTERNAL_ERROR_CODE]!,
    };
  }
  return {
    code: MCP_INTERNAL_ERROR_CODE,
    message: SAFE_MESSAGES[MCP_INTERNAL_ERROR_CODE]!,
  };
}
