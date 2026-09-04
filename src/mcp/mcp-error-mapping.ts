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
  [MCP_INTERNAL_ERROR_CODE]: "Internal Synaphex error.",
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

export function toMcpToolFailure(error: unknown): McpToolFailure {
  if (error instanceof McpInvalidInputError) {
    return { code: error.code, message: error.message };
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
