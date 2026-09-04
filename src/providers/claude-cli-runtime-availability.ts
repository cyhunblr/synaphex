import type { AgentProvider, AgentSurface } from "../domain/agent-config.js";
import type { RuntimeAvailability } from "../domain/provider-routing.js";
import {
  SpawnProcessRunner,
  type ProcessRunner,
} from "../infrastructure/process-runner.js";

export interface ClaudeCliRuntimeAvailabilityOptions {
  readonly processRunner?: ProcessRunner;
  readonly executable?: string;
  readonly timeoutMs?: number;
  readonly terminationGraceMs?: number;
}

export const CLAUDE_MINIMUM_CLI_VERSION = "2.1.248" as const;

export const CLAUDE_ISOLATION_CAPABILITY_PROBE_ARGS = [
  "--safe-mode",
  "--restricted",
  "--version",
] as const;

export type ClaudeCliRuntimeUnavailableReason =
  | "executable_missing"
  | "version_probe_failed"
  | "invalid_version"
  | "version_too_old"
  | "required_cli_capability_unavailable";

export type ClaudeCliRuntimeAvailabilityResult =
  | {
      readonly available: true;
      readonly version: string;
    }
  | {
      readonly available: false;
      readonly reason: ClaudeCliRuntimeUnavailableReason;
      readonly version?: string;
    };

interface SemanticVersion {
  readonly display: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: boolean;
}

const MINIMUM_VERSION: SemanticVersion = {
  display: CLAUDE_MINIMUM_CLI_VERSION,
  major: 2,
  minor: 1,
  patch: 248,
  prerelease: false,
};

export class ClaudeCliRuntimeAvailability implements RuntimeAvailability {
  private readonly runner: ProcessRunner;
  private readonly executable: string;
  private readonly timeoutMs: number;
  private readonly terminationGraceMs: number;

  constructor(options: ClaudeCliRuntimeAvailabilityOptions = {}) {
    this.runner = options.processRunner ?? new SpawnProcessRunner();
    this.executable = options.executable ?? "claude";
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.terminationGraceMs = options.terminationGraceMs ?? 1_000;
  }

  async isAvailable(
    provider: AgentProvider,
    surface: AgentSurface,
  ): Promise<boolean> {
    if (provider !== "anthropic" || surface !== "cli") {
      return false;
    }
    return (await this.probe()).available;
  }

  async probe(): Promise<ClaudeCliRuntimeAvailabilityResult> {
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

    const version = parseClaudeCodeVersion(
      `${versionResult.stdout}\n${versionResult.stderr}`,
    );
    if (version === null) {
      return { available: false, reason: "invalid_version" };
    }
    if (compareVersions(version, MINIMUM_VERSION) < 0) {
      return {
        available: false,
        reason: "version_too_old",
        version: version.display,
      };
    }

    try {
      const capabilityResult = await this.runSafeProbe(
        CLAUDE_ISOLATION_CAPABILITY_PROBE_ARGS,
      );
      if (
        capabilityResult.exitCode !== 0 ||
        capabilityResult.timedOut ||
        parseClaudeCodeVersion(
          `${capabilityResult.stdout}\n${capabilityResult.stderr}`,
        ) === null
      ) {
        return {
          available: false,
          reason: "required_cli_capability_unavailable",
          version: version.display,
        };
      }
    } catch {
      return {
        available: false,
        reason: "required_cli_capability_unavailable",
        version: version.display,
      };
    }
    return { available: true, version: version.display };
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

function parseClaudeCodeVersion(output: string): SemanticVersion | null {
  const match = output.match(
    /(?:^|\s)(\d+)\.(\d+)\.(\d+)([-+][0-9A-Za-z.-]+)?(?=\s|$|\()/,
  );
  if (match === null) {
    return null;
  }
  const components = match.slice(1, 4).map(Number);
  if (components.some((value) => !Number.isSafeInteger(value))) {
    return null;
  }
  const [major, minor, patch] = components as [number, number, number];
  const suffix = match[4] ?? "";
  return {
    display: `${major}.${minor}.${patch}${suffix}`,
    major,
    minor,
    patch,
    prerelease: suffix.startsWith("-"),
  };
}

function compareVersions(left: SemanticVersion, right: SemanticVersion): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) {
      return left[key] < right[key] ? -1 : 1;
    }
  }
  if (left.prerelease === right.prerelease) {
    return 0;
  }
  return left.prerelease ? -1 : 1;
}

function isExecutableMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
