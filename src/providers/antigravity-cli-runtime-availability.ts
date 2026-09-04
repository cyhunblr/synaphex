import type { AgentProvider, AgentSurface } from "../domain/agent-config.js";
import type { RuntimeAvailability } from "../domain/provider-routing.js";
import {
  SpawnProcessRunner,
  type ProcessRunner,
} from "../infrastructure/process-runner.js";

export interface AntigravityCliRuntimeAvailabilityOptions {
  readonly processRunner?: ProcessRunner;
  readonly executable?: string;
  readonly timeoutMs?: number;
  readonly terminationGraceMs?: number;
}

export const ANTIGRAVITY_REQUIRED_HELP_FLAGS = Object.freeze([
  "-p",
  "--output-format",
  "--json-schema",
  "--model",
  "--mode",
  "--sandbox",
  "--print-timeout",
  "--disable-slash-commands",
] as const);

export type AntigravityCliRuntimeUnavailableReason =
  | "executable_missing"
  | "version_probe_failed"
  | "invalid_version"
  | "required_cli_capability_unavailable";

export type AntigravityCliRuntimeAvailabilityResult =
  | { readonly available: true; readonly version: string }
  | {
      readonly available: false;
      readonly reason: AntigravityCliRuntimeUnavailableReason;
      readonly version?: string;
      readonly missingCapabilities?: readonly string[];
    };

export class AntigravityCliRuntimeAvailability implements RuntimeAvailability {
  private readonly runner: ProcessRunner;
  private readonly executable: string;
  private readonly timeoutMs: number;
  private readonly terminationGraceMs: number;

  constructor(options: AntigravityCliRuntimeAvailabilityOptions = {}) {
    this.runner = options.processRunner ?? new SpawnProcessRunner();
    this.executable = options.executable ?? "agy";
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.terminationGraceMs = options.terminationGraceMs ?? 1_000;
  }

  async isAvailable(
    provider: AgentProvider,
    surface: AgentSurface,
  ): Promise<boolean> {
    if (provider !== "google" || surface !== "cli") {
      return false;
    }
    return (await this.probe()).available;
  }

  async probe(): Promise<AntigravityCliRuntimeAvailabilityResult> {
    let versionResult;
    try {
      versionResult = await this.runSafeProbe(["--version"]);
    } catch (error) {
      return {
        available: false,
        reason: isExecutableMissing(error)
          ? "executable_missing"
          : "version_probe_failed",
      };
    }
    if (versionResult.exitCode !== 0 || versionResult.timedOut) {
      return { available: false, reason: "version_probe_failed" };
    }
    const version = parseAntigravityVersion(
      `${versionResult.stdout}\n${versionResult.stderr}`,
    );
    if (version === null) {
      return { available: false, reason: "invalid_version" };
    }

    try {
      const helpResult = await this.runSafeProbe(["--help"]);
      if (helpResult.exitCode !== 0 || helpResult.timedOut) {
        return capabilityUnavailable(version, ANTIGRAVITY_REQUIRED_HELP_FLAGS);
      }
      const help = `${helpResult.stdout}\n${helpResult.stderr}`;
      const missing = ANTIGRAVITY_REQUIRED_HELP_FLAGS.filter(
        (flag) => !hasHelpFlag(help, flag),
      );
      if (missing.length > 0 || !help.includes("accept-edits") || !help.includes("plan")) {
        return capabilityUnavailable(version, [
          ...missing,
          ...(!help.includes("accept-edits") ? ["mode:accept-edits"] : []),
          ...(!help.includes("plan") ? ["mode:plan"] : []),
        ]);
      }
    } catch {
      return capabilityUnavailable(version, ANTIGRAVITY_REQUIRED_HELP_FLAGS);
    }
    return { available: true, version };
  }

  private runSafeProbe(args: readonly string[]) {
    return this.runner.run({
      executable: this.executable,
      args,
      stdin: "",
      timeoutMs: this.timeoutMs,
      terminationGraceMs: this.terminationGraceMs,
    });
  }
}

function hasHelpFlag(help: string, flag: string): boolean {
  const escaped = flag.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)\\s*${escaped}(?:\\s|,|$)`, "m").test(help);
}

function capabilityUnavailable(
  version: string,
  missingCapabilities: readonly string[],
): AntigravityCliRuntimeAvailabilityResult {
  return {
    available: false,
    reason: "required_cli_capability_unavailable",
    version,
    missingCapabilities: Object.freeze([...missingCapabilities]),
  };
}

function parseAntigravityVersion(output: string): string | null {
  const match = output.match(
    /(?:^|\s)v?(\d+)\.(\d+)\.(\d+)([-+][0-9A-Za-z.-]+)?(?=\s|$|\()/,
  );
  if (match === null) {
    return null;
  }
  const parts = match.slice(1, 4).map(Number);
  if (parts.some((value) => !Number.isSafeInteger(value))) {
    return null;
  }
  return `${parts[0]}.${parts[1]}.${parts[2]}${match[4] ?? ""}`;
}

function isExecutableMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
