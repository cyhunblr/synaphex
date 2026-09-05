import type { AgentProvider, AgentSurface } from "./agent-config.js";

/**
 * The deterministic name of the Synaphex MCP server registration in every
 * supported provider host.
 */
export const SYNAPHEX_MCP_SERVER_REGISTRATION_NAME = "synaphex" as const;

/** One provider host surface Synaphex can be installed into. */
export interface InstallationTarget {
  readonly provider: AgentProvider;
  readonly surface: AgentSurface;
}

/**
 * The accepted installer host matrix: CLI surfaces only.
 *
 * Every entry is verified against a real installed runtime; nothing here is
 * assumed. `google` means Antigravity (`agy`) -- Gemini CLI is deliberately
 * absent, and so is an Antigravity IDE surface.
 *
 * VS Code surfaces are deliberately ABSENT because Synaphex cannot truthfully
 * encode them (see {@link VSCODE_SURFACE_UNSUPPORTED_REASON} and ADR 0007).
 * That is a limitation of MCP host identity, NOT of provider execution:
 * `openai`, `anthropic` and `google` all remain callable agent targets.
 */
export const SUPPORTED_INSTALLATION_TARGETS: readonly InstallationTarget[] =
  Object.freeze([
    { provider: "openai", surface: "cli" },
    { provider: "anthropic", surface: "cli" },
    { provider: "google", surface: "cli" },
  ] as const);

/**
 * Why no VS Code surface can be registered.
 *
 * Established by direct audit of the installed runtimes:
 *
 * 1. Each provider keeps ONE MCP registration store shared by its CLI and its
 *    VS Code extension, keyed by server name. Registering a second surface
 *    under the same name REPLACES the first, so two host contexts cannot
 *    coexist.
 * 2. Two differently-named registrations CAN coexist, but neither runtime
 *    offers any per-surface filter: a CLI session loads BOTH, and would
 *    connect to a server asserting `--host-surface vscode`. That is exactly
 *    the false host identity the Phase-3A trust model forbids.
 * 3. MCP `clientInfo` cannot disambiguate. Codex reports `codex-mcp-client`
 *    from both surfaces (only the build version differs), and Claude Code
 *    reports `claude-code` from both. The only observed surface signal is the
 *    `CLAUDE_CODE_ENTRYPOINT` environment variable, which is host-controlled
 *    ambient state rather than MCP protocol identity -- not authority.
 *
 * Rather than relabel VS Code as CLI, or infer a surface from a signal that
 * cannot bear that weight, the surface is reported unsupported.
 */
export const VSCODE_SURFACE_UNSUPPORTED_REASON =
  "this provider shares one MCP registration between its CLI and VS Code extension, and neither exposes a per-surface scope or a distinguishable MCP client identity, so Synaphex cannot truthfully encode a VS Code host context";

export function isSupportedTarget(target: InstallationTarget): boolean {
  return SUPPORTED_INSTALLATION_TARGETS.some(
    (supported) =>
      supported.provider === target.provider &&
      supported.surface === target.surface,
  );
}

export function formatTarget(target: InstallationTarget): string {
  const provider = { openai: "OpenAI", anthropic: "Anthropic", google: "Google" }[
    target.provider
  ];
  const surface = target.surface === "cli" ? "CLI" : "VS Code";
  return `${provider} ${surface}`;
}

/** Why a host cannot currently be configured, or that it can. */
export type HostAvailability =
  | { readonly state: "available"; readonly version: string }
  | { readonly state: "not_found" }
  | {
      readonly state: "unsupported_version";
      readonly version: string;
      readonly minimum: string;
    }
  | { readonly state: "registration_unsupported"; readonly reason: string };

/**
 * The immutable launcher a provider host is told to spawn.
 *
 * Absolute `command` and absolute script path deliberately: an npm bin shim
 * starts with `#!/usr/bin/env node`, which resolves whatever `node` appears
 * first on the host's PATH. A GUI-launched VS Code can easily inherit an old
 * system Node that cannot parse ESM, and the server would die at startup with
 * a syntax error. Pinning the interpreter removes that entire class of
 * failure.
 */
export interface SynaphexLauncher {
  /** Absolute path to the Node executable. */
  readonly command: string;
  /** Absolute path to the Synaphex MCP stdio entrypoint, then host context. */
  readonly args: readonly string[];
}

/** Builds the immutable launcher argv for one host surface. */
export function launcherArgsFor(
  entrypoint: string,
  target: InstallationTarget,
): readonly string[] {
  // The host context is baked into the registration and can never be supplied
  // by an MCP client at runtime -- that is the Phase-3A trust boundary.
  return [
    entrypoint,
    "--host-provider",
    target.provider,
    "--host-surface",
    target.surface,
  ];
}
