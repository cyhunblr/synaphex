import { randomUUID } from "node:crypto";
import { InvalidSessionIdError } from "./errors.js";
import type { ProjectId } from "./project.js";
import type { TaskId } from "./task.js";

export type SessionId = string;

/**
 * Canonical Synaphex session identity.
 *
 * A Synaphex session is an explicit logical Synaphex resource. It is NOT
 * derived from an MCP connection/session id, a provider conversation or thread
 * id (Claude/Codex/Antigravity), a process id, or client metadata: transport
 * and provider details must never redefine domain identity, and Core stays
 * provider-independent.
 *
 * The format follows the same convention as project and task ids
 * (`prefix_<uuid without dashes>`), and deliberately encodes no provider
 * identity, host name, process id or conversation id.
 *
 * `SessionId` remains a plain string for backward compatibility: sessions
 * created before canonical ids existed (and Synaphex host surfaces that supply
 * their own session identifier) stay valid. `parseSessionId` is the validator
 * for untrusted boundaries such as MCP; `generateSessionId` is the factory for
 * newly opened sessions.
 */
export const SESSION_ID_PREFIX = "ses_";

const CANONICAL_SESSION_ID = /^ses_[0-9a-f]{32}$/;
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]+$/;
const MAX_SESSION_ID_LENGTH = 200;

export function generateSessionId(): SessionId {
  return `${SESSION_ID_PREFIX}${randomUUID().replaceAll("-", "")}`;
}

export function isCanonicalSessionId(value: unknown): value is SessionId {
  return typeof value === "string" && CANONICAL_SESSION_ID.test(value);
}

/**
 * Returns true for a session id that is safe to accept from an untrusted
 * caller. Session ids address state paths, so separators, traversal segments
 * and control characters are rejected here rather than relied upon downstream.
 */
export function isSessionId(value: unknown): value is SessionId {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SESSION_ID_LENGTH &&
    SAFE_SESSION_ID.test(value)
  );
}

/**
 * Validates a session id arriving from an untrusted boundary (for example an
 * MCP tool argument) and returns it as a `SessionId`.
 *
 * This is the single canonical grammar; callers must not define their own.
 */
export function parseSessionId(value: unknown): SessionId {
  if (typeof value !== "string") {
    throw new InvalidSessionIdError("expected a string");
  }
  if (value.length === 0) {
    throw new InvalidSessionIdError("must not be empty");
  }
  if (value.length > MAX_SESSION_ID_LENGTH) {
    throw new InvalidSessionIdError(
      `must be at most ${MAX_SESSION_ID_LENGTH} characters`,
    );
  }
  if (!SAFE_SESSION_ID.test(value)) {
    throw new InvalidSessionIdError(
      "must contain only letters, digits, underscore or hyphen",
    );
  }
  return value;
}

export type SessionBinding =
  | {
      readonly sessionId: SessionId;
      readonly projectId: null;
      readonly taskId: null;
    }
  | {
      readonly sessionId: SessionId;
      readonly projectId: ProjectId;
      readonly taskId: TaskId | null;
    };
