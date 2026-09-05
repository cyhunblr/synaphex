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
 * The accepted installer host matrix.
 *
 * Every entry is verified against a real installed runtime; nothing here is
 * assumed. `google` means Antigravity (`agy`) -- Gemini CLI is deliberately
 * absent, and so is an Antigravity IDE surface.
 */
export const SUPPORTED_INSTALLATION_TARGETS: readonly InstallationTarget[] =
  Object.freeze([
    { provider: "openai", surface: "cli" },
    { provider: "openai", surface: "vscode" },
    { provider: "anthropic", surface: "cli" },
    { provider: "anthropic", surface: "vscode" },
    { provider: "google", surface: "cli" },
  ] as const);

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
