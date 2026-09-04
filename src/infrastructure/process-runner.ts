import { spawn } from "node:child_process";

export interface ProcessRunInput {
  readonly executable: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly terminationGraceMs: number;
  readonly stdoutCaptureMode?: "tail" | "full";
  readonly stdoutLimitBytes?: number;
  readonly stderrTailLimitBytes?: number;
}

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly stdoutOverflowed?: boolean;
  readonly stderrOverflowed?: boolean;
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
    const stdoutCaptureMode = input.stdoutCaptureMode ?? "tail";
    const stdoutLimitBytes = captureLimit(
      input.stdoutLimitBytes ?? this.maxCaptureBytes,
      "stdoutLimitBytes",
    );
    const stderrLimitBytes = captureLimit(
      input.stderrTailLimitBytes ?? this.maxCaptureBytes,
      "stderrTailLimitBytes",
    );
    return new Promise<ProcessResult>((resolve, reject) => {
      const child = spawn(input.executable, [...input.args], {
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        ...(input.env === undefined ? {} : { env: input.env }),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout = new BoundedCapture(
        stdoutLimitBytes,
        stdoutCaptureMode,
      );
      const stderr = new BoundedCapture(stderrLimitBytes, "tail");
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
        stdout.append(chunk);
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr.append(chunk);
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
        resolve({
          exitCode,
          signal,
          stdout: stdout.value(),
          stderr: stderr.value(),
          timedOut,
          stdoutOverflowed: stdout.overflowed,
          stderrOverflowed: stderr.overflowed,
        });
      });

      child.stdin.on("error", () => {
        // Process exit/error is the authoritative outcome; EPIPE is common when
        // a child fails before consuming all stdin.
      });
      child.stdin.end(input.stdin);
    });
  }
}

class BoundedCapture {
  private captured = Buffer.alloc(0);
  overflowed = false;

  constructor(
    private readonly limitBytes: number,
    private readonly mode: "tail" | "full",
  ) {}

  append(chunk: Buffer | string): void {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const combined = Buffer.concat([this.captured, incoming]);
    if (combined.byteLength <= this.limitBytes) {
      this.captured = combined;
      return;
    }
    this.overflowed = true;
    this.captured =
      this.mode === "full"
        ? combined.subarray(0, this.limitBytes)
        : combined.subarray(combined.byteLength - this.limitBytes);
  }

  value(): string {
    return this.captured.toString();
  }
}

function captureLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}
