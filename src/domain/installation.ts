import type { AgentProvider } from "./agent-config.js";

/**
 * The deterministic name of the Synaphex MCP server registration in every
 * supported provider host.
 */
export const SYNAPHEX_MCP_SERVER_REGISTRATION_NAME = "synaphex" as const;

/**
 * One provider runtime Synaphex can be installed into as an MCP host.
 *
 * Provider only. There is no surface dimension: a provider's CLI and its VS
 * Code extension share one MCP registration, so an installer that offered them
 * separately would be offering a distinction it cannot deliver (ADR 0009).
 */
export interface InstallationTarget {
  readonly provider: AgentProvider;
}

/**
 * The provider runtimes Synaphex can host under.
 *
 * Every entry is verified against a real installed runtime; nothing here is
 * assumed. `google` means Antigravity (`agy`) -- Gemini CLI is deliberately
 * absent.
 *
 * Installing a host says nothing about which agent TARGETS are executable;
 * ProviderRouter answers that separately.
 */
export const SUPPORTED_INSTALLATION_TARGETS: readonly InstallationTarget[] =
  Object.freeze([
    { provider: "openai" },
    { provider: "anthropic" },
    { provider: "google" },
  ] as const);


export function isSupportedTarget(target: InstallationTarget): boolean {
  return SUPPORTED_INSTALLATION_TARGETS.some(
    (supported) => supported.provider === target.provider,
  );
}

export function formatTarget(target: InstallationTarget): string {
  return { openai: "OpenAI", anthropic: "Anthropic", google: "Google" }[
    target.provider
  ];
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
  // The host PROVIDER is baked into the registration and can never be supplied
  // by an MCP client at runtime -- that is the Phase-3A trust boundary.
  //
  // No UI surface is asserted. A provider's CLI and its VS Code extension read
  // the same registration, so claiming one would be unverifiable (ADR 0009).
  return [entrypoint, "--host-provider", target.provider];
}

/**
 * The launcher argv Synaphex wrote before host identity became provider-only.
 *
 * Recognised so reinstall can MIGRATE our own previous registration instead of
 * mistaking it for a foreign server. Only the exact legacy shape counts.
 */
export function legacyLauncherArgsFor(
  entrypoint: string,
  target: InstallationTarget,
): readonly string[] {
  return [
    entrypoint,
    "--host-provider",
    target.provider,
    "--host-surface",
    "cli",
  ];
}
