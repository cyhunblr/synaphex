import { AGENT_PROVIDERS, AGENT_SURFACES } from "../domain/agent-config.js";
import type { AgentProvider, AgentSurface } from "../domain/agent-config.js";
import type { HostRuntime } from "../domain/provider-routing.js";

/**
 * MCP host context: which provider application and surface the user is
 * currently interacting with Synaphex through.
 *
 * This reuses Core's existing `HostRuntime` rather than introducing a parallel
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
export const HOST_SURFACE_FLAG = "--host-surface";

export class InvalidHostContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidHostContextError";
  }
}

/**
 * Host provider/surface combinations Synaphex supports as an interactive host.
 *
 * CLI surfaces only. Every `vscode` combination is deliberately absent, and
 * the server FAILS CLOSED if one is supplied.
 *
 * The reason is an identity limit, not a preference (ADR 0007). Each provider
 * shares ONE MCP registration store between its CLI and its VS Code extension,
 * with no per-surface scope, and both surfaces present the same MCP
 * `clientInfo` (`codex-mcp-client`, `claude-code`). A registration asserting
 * `--host-surface vscode` would therefore also be loaded by a CLI session, and
 * nothing in the protocol could detect the mismatch. Since Synaphex cannot
 * truthfully encode a VS Code host context, it refuses to claim one.
 *
 * `google + vscode` is absent for a separate reason: Antigravity IDE is not a
 * Synaphex host integration at all (ADR 0001).
 *
 * This bounds HOST identity only. `openai`, `anthropic` and `google` all
 * remain callable agent TARGETS -- host identity and target executability are
 * separate questions.
 */
const SUPPORTED_HOST_COMBINATIONS: readonly `${AgentProvider}/${AgentSurface}`[] =
  Object.freeze(["openai/cli", "anthropic/cli", "google/cli"]);

export function isSupportedHostRuntime(host: HostRuntime): boolean {
  return SUPPORTED_HOST_COMBINATIONS.includes(
    `${host.provider}/${host.surface}`,
  );
}

/**
 * Parses the internal MCP stdio host arguments.
 *
 * These are INTERNAL integration arguments for future installer-generated MCP
 * configuration, not a public `synaphex mcp` user command. Any problem is
 * fatal: the server must never start with ambiguous host identity.
 */
export function parseHostContextArguments(
  argv: readonly string[],
): HostRuntime {
  const provider = takeSingleValue(argv, HOST_PROVIDER_FLAG);
  const surface = takeSingleValue(argv, HOST_SURFACE_FLAG);

  if (!(AGENT_PROVIDERS as readonly string[]).includes(provider)) {
    throw new InvalidHostContextError(
      `${HOST_PROVIDER_FLAG} must be one of: ${AGENT_PROVIDERS.join(", ")}`,
    );
  }
  if (!(AGENT_SURFACES as readonly string[]).includes(surface)) {
    throw new InvalidHostContextError(
      `${HOST_SURFACE_FLAG} must be one of: ${AGENT_SURFACES.join(", ")}`,
    );
  }
  const host: HostRuntime = {
    provider: provider as AgentProvider,
    surface: surface as AgentSurface,
  };
  if (!isSupportedHostRuntime(host)) {
    throw new InvalidHostContextError(
      `unsupported host combination: ${host.provider}/${host.surface}`,
    );
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
