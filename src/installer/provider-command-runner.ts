import { spawn } from "node:child_process";

export interface ProviderCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProviderCommandInput {
  readonly command: string;
  readonly args: readonly string[];
  /** Overrides HOME so tests never touch the developer's real config. */
  readonly home?: string;
}

export interface ProviderCommandRunner {
  run(input: ProviderCommandInput): Promise<ProviderCommandResult>;
}

const OUTPUT_LIMIT_BYTES = 64 * 1024;
const COMMAND_TIMEOUT_MS = 60_000;

/**
 * Runs provider management commands with `shell: false`.
 *
 * No argument is ever interpolated into `bash -c` or `sh -c`, so a path
 * containing shell metacharacters cannot become executable text. Output is
 * bounded, and callers summarise stderr rather than dumping it, because
 * provider diagnostics can contain account or path detail.
 */
export class SpawnProviderCommandRunner implements ProviderCommandRunner {
  async run(input: ProviderCommandInput): Promise<ProviderCommandResult> {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(input.command, [...input.args], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env:
          input.home === undefined
            ? process.env
            : { ...process.env, HOME: input.home },
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill("SIGKILL");
          resolvePromise({
            exitCode: 124,
            stdout,
            stderr: "provider command timed out",
          });
        }
      }, COMMAND_TIMEOUT_MS);

      child.stdout?.on("data", (chunk: Buffer) => {
        if (stdout.length < OUTPUT_LIMIT_BYTES) {
          stdout += chunk.toString("utf8");
        }
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length < OUTPUT_LIMIT_BYTES) {
          stderr += chunk.toString("utf8");
        }
      });
      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          // A missing runtime is an ordinary detection outcome, not a crash.
          resolvePromise({ exitCode: 127, stdout: "", stderr: "not found" });
          return;
        }
        rejectPromise(error);
      });
      child.on("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolvePromise({ exitCode: code ?? 1, stdout, stderr });
      });
    });
  }
}

/** Collapses provider output into a short, safe diagnostic. */
export function summarizeFailure(result: ProviderCommandResult): string {
  const text = (result.stderr || result.stdout).trim();
  const firstLine = text.split("\n").find((line) => line.trim().length > 0) ?? "";
  const trimmed = firstLine.trim().slice(0, 200);
  return trimmed.length > 0 ? trimmed : `exit code ${result.exitCode}`;
}
