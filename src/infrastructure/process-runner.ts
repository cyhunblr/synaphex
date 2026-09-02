import { spawn } from "node:child_process";

export interface ProcessRunInput {
  readonly executable: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly terminationGraceMs: number;
}

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface ProcessRunner {
  run(input: ProcessRunInput): Promise<ProcessResult>;
}

const DEFAULT_MAX_CAPTURE_BYTES = 64 * 1024;

export class SpawnProcessRunner implements ProcessRunner {
  constructor(
    private readonly maxCaptureBytes: number = DEFAULT_MAX_CAPTURE_BYTES,
  ) {}

  async run(input: ProcessRunInput): Promise<ProcessResult> {
    return new Promise<ProcessResult>((resolve, reject) => {
      const child = spawn(input.executable, [...input.args], {
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        ...(input.env === undefined ? {} : { env: input.env }),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      let terminationTimer: NodeJS.Timeout | undefined;

      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        terminationTimer = setTimeout(() => {
          child.kill("SIGKILL");
        }, input.terminationGraceMs);
        terminationTimer.unref();
      }, input.timeoutMs);
      timeoutTimer.unref();

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout = appendBounded(stdout, chunk, this.maxCaptureBytes);
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr = appendBounded(stderr, chunk, this.maxCaptureBytes);
      });
      child.once("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutTimer);
        if (terminationTimer !== undefined) {
          clearTimeout(terminationTimer);
        }
        reject(error);
      });
      child.once("close", (exitCode, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutTimer);
        if (terminationTimer !== undefined) {
          clearTimeout(terminationTimer);
        }
        resolve({ exitCode, signal, stdout, stderr, timedOut });
      });

      child.stdin.on("error", () => {
        // Process exit/error is the authoritative outcome; EPIPE is common when
        // a child fails before consuming all stdin.
      });
      child.stdin.end(input.stdin);
    });
  }
}

function appendBounded(
  current: string,
  chunk: Buffer | string,
  maximumBytes: number,
): string {
  const combined = Buffer.from(current + chunk.toString());
  if (combined.byteLength <= maximumBytes) {
    return combined.toString();
  }
  return combined.subarray(combined.byteLength - maximumBytes).toString();
}
