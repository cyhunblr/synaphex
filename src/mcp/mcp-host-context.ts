import { AGENT_PROVIDERS } from "../domain/agent-config.js";
import type { AgentProvider } from "../domain/agent-config.js";
import type { McpHostContext } from "../domain/provider-routing.js";

/**
 * MCP host context: which provider application and surface the user is
 * currently interacting with Synaphex through.
 *
 * This reuses Core's existing `McpHostContext` rather than introducing a parallel
 * type. It is deliberately just `{provider, surface}` -- no model, sessionId,
 * conversationId or PID.
 *
 * Authoritative distinction:
 *
 *   Synaphex Session != MCP connection != provider host identity
 *
 * Host identity is IMMUTABLE PROCESS CONFIGURATION. It is never inferred from
 * MCP `clientInfo`, process name, PID, conversation/thread id, model output,
 * tool input or SessionId -- otherwise a model or a tool argument could spoof
 * ProviderRouter's routing context.
 */
export const HOST_PROVIDER_FLAG = "--host-provider";
/**
 * Obsolete. Retained only so it can be REJECTED by name.
 *
 * Registrations once asserted a UI surface; that assertion was unverifiable
 * and is now refused outright rather than ignored, so a stale or hand-written
 * launcher cannot smuggle UI identity back into host authority.
 */
export const OBSOLETE_HOST_SURFACE_FLAG = "--host-surface";

export class InvalidHostContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidHostContextError";
  }
}

/**
 * Provider runtimes Synaphex supports as an MCP host.
 *
 * Provider identity only -- there is no surface dimension, because none is
 * observable. Each provider shares ONE MCP registration store between its CLI
 * and its VS Code extension, with no per-surface scope, and both present the
 * same MCP `clientInfo`. It was verified directly that a VS Code extension
 * loads and connects to the very registration a CLI wrote, so any asserted
 * surface would be a claim Synaphex cannot substantiate (ADR 0009).
 *
 * This bounds HOST identity only. Which agent TARGETS are executable is a
 * separate question, answered by ProviderRouter.
 */
const SUPPORTED_HOST_PROVIDERS: readonly AgentProvider[] = Object.freeze([
  "openai",
  "anthropic",
  "google",
]);

export function isSupportedMcpHost(host: McpHostContext): boolean {
  return SUPPORTED_HOST_PROVIDERS.includes(host.provider);
}

/**
 * Parses the internal MCP stdio host arguments.
 *
 * These are INTERNAL integration arguments written by the installer, not a
 * public `synaphex mcp` command. Any problem is fatal: the server must never
 * start with ambiguous host identity.
 */
export function parseHostContextArguments(
  argv: readonly string[],
): McpHostContext {
  // Rejected before anything else: silently ignoring it would let a stale
  // registration keep implying a surface Synaphex no longer honours.
  if (argv.includes(OBSOLETE_HOST_SURFACE_FLAG)) {
    throw new InvalidHostContextError(
      `${OBSOLETE_HOST_SURFACE_FLAG} is no longer supported; MCP host identity is the provider runtime only`,
    );
  }
  const provider = takeSingleValue(argv, HOST_PROVIDER_FLAG);

  if (!(AGENT_PROVIDERS as readonly string[]).includes(provider)) {
    throw new InvalidHostContextError(
      `${HOST_PROVIDER_FLAG} must be one of: ${AGENT_PROVIDERS.join(", ")}`,
    );
  }
  const host: McpHostContext = { provider: provider as AgentProvider };
  if (!isSupportedMcpHost(host)) {
    throw new InvalidHostContextError(`unsupported host provider: ${host.provider}`);
  }
  return host;
}

/** Requires the flag exactly once, with a value. Duplicates are fatal. */
function takeSingleValue(argv: readonly string[], flag: string): string {
  const indexes = argv
    .map((argument, index) => (argument === flag ? index : -1))
    .filter((index) => index !== -1);
  if (indexes.length === 0) {
    throw new InvalidHostContextError(`${flag} is required`);
  }
  if (indexes.length > 1) {
    throw new InvalidHostContextError(`${flag} must be given exactly once`);
  }
  const value = argv[indexes[0]! + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new InvalidHostContextError(`${flag} requires a value`);
  }
  return value;
}
