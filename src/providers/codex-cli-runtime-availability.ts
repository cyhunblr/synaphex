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
    try {
      const result = await this.runner.run({
        executable: this.executable,
        args: ["--version"],
        stdin: "",
        timeoutMs: this.timeoutMs,
        terminationGraceMs: this.terminationGraceMs,
      });
      return result.exitCode === 0 && !result.timedOut;
    } catch {
      return false;
    }
  }
}
