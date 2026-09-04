import type { AgentProvider, AgentSurface } from "../domain/agent-config.js";
import type { RuntimeAvailability } from "../domain/provider-routing.js";
import {
  SpawnProcessRunner,
  type ProcessRunner,
} from "../infrastructure/process-runner.js";

export interface GeminiCliRuntimeAvailabilityOptions {
  readonly processRunner?: ProcessRunner;
  readonly executable?: string;
  readonly timeoutMs?: number;
  readonly terminationGraceMs?: number;
}

export const GEMINI_CALLABLE_CAPABILITY_PROBE_ARGS = Object.freeze([
  "-p",
  "Synaphex parser capability probe; do not execute.",
  "--output-format",
  "json",
  "--model",
  "synaphex-capability-probe",
  "--approval-mode",
  "default",
  "--extensions",
  "none",
  "--policy",
  "synaphex-capability-probe-policy.toml",
  "--allowed-mcp-server-names",
  "synaphex-capability-probe-no-mcp",
  "--include-directories",
  ".",
  "--version",
] as const);

export type GeminiCliRuntimeUnavailableReason =
  | "executable_missing"
  | "version_probe_failed"
  | "invalid_version"
  | "required_cli_capability_unavailable";

export type GeminiCliRuntimeAvailabilityResult =
  | { readonly available: true; readonly version: string }
  | {
      readonly available: false;
      readonly reason: GeminiCliRuntimeUnavailableReason;
      readonly version?: string;
    };

export class GeminiCliRuntimeAvailability implements RuntimeAvailability {
  private readonly runner: ProcessRunner;
  private readonly executable: string;
  private readonly timeoutMs: number;
  private readonly terminationGraceMs: number;

  constructor(options: GeminiCliRuntimeAvailabilityOptions = {}) {
    this.runner = options.processRunner ?? new SpawnProcessRunner();
    this.executable = options.executable ?? "gemini";
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

  async probe(): Promise<GeminiCliRuntimeAvailabilityResult> {
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
    const version = parseGeminiVersion(
      `${versionResult.stdout}\n${versionResult.stderr}`,
    );
    if (version === null) {
      return { available: false, reason: "invalid_version" };
    }

    try {
      const capability = await this.runSafeProbe(
        GEMINI_CALLABLE_CAPABILITY_PROBE_ARGS,
      );
      if (
        capability.exitCode !== 0 ||
        capability.timedOut ||
        parseGeminiVersion(`${capability.stdout}\n${capability.stderr}`) === null
      ) {
        return {
          available: false,
          reason: "required_cli_capability_unavailable",
          version,
        };
      }
    } catch {
      return {
        available: false,
        reason: "required_cli_capability_unavailable",
        version,
      };
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

function parseGeminiVersion(output: string): string | null {
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
