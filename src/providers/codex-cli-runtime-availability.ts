import type { AgentProvider, AgentSurface } from "../domain/agent-config.js";
import type { RuntimeAvailability } from "../domain/provider-routing.js";
import {
  SpawnProcessRunner,
  type ProcessRunner,
} from "../infrastructure/process-runner.js";

export interface CodexCliRuntimeAvailabilityOptions {
  readonly processRunner?: ProcessRunner;
  readonly executable?: string;
  readonly timeoutMs?: number;
  readonly terminationGraceMs?: number;
}

export type CodexCliRuntimeUnavailableReason =
  | "executable_missing"
  | "version_probe_failed";

export type CodexCliRuntimeAvailabilityResult =
  | {
      readonly available: true;
      /** Absent when the runtime succeeds but emits an unrecognised version. */
      readonly version?: string;
    }
  | {
      readonly available: false;
      readonly reason: CodexCliRuntimeUnavailableReason;
      readonly version?: string;
    };

export class CodexCliRuntimeAvailability implements RuntimeAvailability {
  private readonly runner: ProcessRunner;
  private readonly executable: string;
  private readonly timeoutMs: number;
  private readonly terminationGraceMs: number;

  constructor(options: CodexCliRuntimeAvailabilityOptions = {}) {
    this.runner = options.processRunner ?? new SpawnProcessRunner();
    this.executable = options.executable ?? "codex";
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.terminationGraceMs = options.terminationGraceMs ?? 1_000;
  }

  async isAvailable(
    provider: AgentProvider,
    surface: AgentSurface,
  ): Promise<boolean> {
    if (provider !== "openai" || surface !== "cli") {
      return false;
    }
    return (await this.probe()).available;
  }

  /**
   * Observational version probe used by Configure diagnostics.
   *
   * A successful command still proves that the runtime is installed even if
   * its output shape is newer or malformed. In that case only the optional
   * display version is withheld; provider routing keeps its prior boolean
   * availability semantics.
   */
  async probe(): Promise<CodexCliRuntimeAvailabilityResult> {
    try {
      const result = await this.runner.run({
        executable: this.executable,
        args: ["--version"],
        stdin: "",
        timeoutMs: this.timeoutMs,
        terminationGraceMs: this.terminationGraceMs,
      });
      if (result.exitCode !== 0 || result.timedOut) {
        return { available: false, reason: "version_probe_failed" };
      }
      const version = parseCodexCliVersion(
        `${result.stdout}\n${result.stderr}`,
      );
      return {
        available: true,
        ...(version === null ? {} : { version }),
      };
    } catch (error) {
      return {
        available: false,
        reason: isExecutableMissing(error)
          ? "executable_missing"
          : "version_probe_failed",
      };
    }
  }
}

/** Accepts only a complete `codex-cli <semver>` line, never arbitrary text. */
function parseCodexCliVersion(output: string): string | null {
  const match = output.match(
    /(?:^|\r?\n)\s*codex-cli\s+(\d+)\.(\d+)\.(\d+)([-+][0-9A-Za-z.-]+)?\s*(?=\r?\n|$)/,
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
