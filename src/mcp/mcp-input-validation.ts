import { AGENT_NAMES, isAgentName, type AgentName } from "../domain/agent.js";
import type { ProjectId } from "../domain/project.js";
import type { TaskId } from "../domain/task.js";
import { McpInvalidInputError } from "./mcp-error-mapping.js";

/**
 * Input validation for MCP tool arguments.
 *
 * The ID grammar is Synaphex's existing one (`prj_*` / `task_*` template
 * literal types, and `AGENT_NAMES` for agent names); MCP introduces no second
 * grammar. Session ids are validated by Core's canonical `parseSessionId`,
 * which MCP calls directly rather than duplicating. Every check runs before
 * any service call, so malformed input can never reach Core.
 */

export const PROJECT_ID_PREFIX = "prj_";
export const TASK_ID_PREFIX = "task_";

const SAFE_ID_SUFFIX = /^[A-Za-z0-9_-]+$/;
const MAX_ID_LENGTH = 200;

export function parseProjectId(value: string): ProjectId {
  assertOpaqueId(value, PROJECT_ID_PREFIX, "INVALID_PROJECT_ID", "project id");
  return value as ProjectId;
}

export function parseTaskId(value: string): TaskId {
  assertOpaqueId(value, TASK_ID_PREFIX, "INVALID_TASK_ID", "task id");
  return value as TaskId;
}

export function parseAgentName(value: string): AgentName {
  if (!isAgentName(value)) {
    throw new McpInvalidInputError(
      "INVALID_AGENT_NAME",
      `Invalid agent name. Expected one of: ${AGENT_NAMES.join(", ")}.`,
    );
  }
  return value;
}

function assertOpaqueId(
  value: string,
  prefix: string,
  code: string,
  label: string,
): void {
  const suffix = value.startsWith(prefix) ? value.slice(prefix.length) : null;
  if (
    suffix === null ||
    suffix === "" ||
    value.length > MAX_ID_LENGTH ||
    !SAFE_ID_SUFFIX.test(suffix)
  ) {
    throw new McpInvalidInputError(code, `Invalid ${label}.`);
  }
}
