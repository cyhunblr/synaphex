import { spawn } from "node:child_process";

/**
 * Runs Synaphex's own Git infrastructure commands deterministically.
 *
 * This is NOT provider execution: it never runs a model, never touches the
 * network, and its failures surface as Synaphex staging errors rather than
 * provider-execution errors.
 *
 * Isolation, verified against the installed Git (2.25.1):
 *
 * - `shell: false` with `executable = "git"` -- never `bash -c` / `sh -c`.
 * - `HOME` is redirected to an empty directory. `GIT_CONFIG_GLOBAL` is
 *   deliberately NOT relied upon: it was added in Git 2.32 and is silently
 *   ignored on 2.25.x, where a global alias still applied. Overriding `HOME`
 *   does suppress `~/.gitconfig` on every supported version.
 * - `GIT_CONFIG_NOSYSTEM=1` suppresses the system config.
 * - `core.hooksPath` is pointed at a non-directory, so no repository or user
 *   hook can run as a side effect of a Synaphex command.
 * - fsmonitor, external diff, pager, terminal prompt, replace refs and
 *   alternate object dirs are neutralised explicitly.
 *
 * Provider authentication is untouched: this environment is used only for
 * Synaphex's own subprocesses, never for provider execution.
 */
export interface IsolatedGitResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface IsolatedGitRunInput {
  readonly args: readonly string[];
  readonly cwd: string;
  /** Empty directory used as HOME so user global config cannot apply. */
  readonly isolatedHome: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface IsolatedGitRunner {
  run(input: IsolatedGitRunInput): Promise<IsolatedGitResult>;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** `-c` overrides applied to every Synaphex Git command. */
export const ISOLATED_GIT_CONFIG_OVERRIDES: readonly string[] = Object.freeze([
  // No repository or user hook may run as a side effect.
  "-c",
  "core.hooksPath=/dev/null",
  // No filesystem monitor hook process.
  "-c",
  "core.fsmonitor=",
  // No external diff or textconv driver.
  "-c",
  "diff.external=",
  // No pager, no interactive credential prompt.
  "-c",
  "core.pager=cat",
  "-c",
  "credential.helper=",
  // Object graph must not be rewritten by replace refs.
  "-c",
  "core.useReplaceRefs=false",
  // Protect against symlinked .git/.gitmodules trickery during checkout.
  "-c",
  "core.protectHFS=true",
  "-c",
  "core.protectNTFS=true",
  // Never auto-initialise or fetch submodules.
  "-c",
  "submodule.recurse=false",
]);

export class SpawnIsolatedGitRunner implements IsolatedGitRunner {
  async run(input: IsolatedGitRunInput): Promise<IsolatedGitResult> {
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    return new Promise<IsolatedGitResult>((resolve, reject) => {
      const child = spawn(
        "git",
        [...ISOLATED_GIT_CONFIG_OVERRIDES, ...input.args],
        {
          cwd: input.cwd,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            // A minimal, deterministic environment. PATH is required to find
            // git itself; everything else is dropped so no user Git variable
            // (GIT_DIR, GIT_ALTERNATE_OBJECT_DIRECTORIES, GIT_SSH_COMMAND,
            // GIT_EXTERNAL_DIFF, ...) can leak in.
            PATH: process.env.PATH ?? "/usr/bin:/bin",
            HOME: input.isolatedHome,
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_TERMINAL_PROMPT: "0",
            GIT_ASKPASS: "",
            GIT_OPTIONAL_LOCKS: "0",
            // Deterministic identity for any Synaphex-side commit/index work.
            GIT_AUTHOR_NAME: "Synaphex",
            GIT_AUTHOR_EMAIL: "synaphex@localhost",
            GIT_COMMITTER_NAME: "Synaphex",
            GIT_COMMITTER_EMAIL: "synaphex@localhost",
            LC_ALL: "C",
          },
        },
      );

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let timedOut = false;
      let settled = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes <= maxOutputBytes) {
          stdout.push(chunk);
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.byteLength;
        if (stderrBytes <= maxOutputBytes) {
          stderr.push(chunk);
        }
      });
      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (exitCode) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          timedOut,
        });
      });
    });
  }

  /** Raw stdout bytes, for binary-safe patch capture. */
  async runBinary(
    input: IsolatedGitRunInput,
  ): Promise<{ readonly exitCode: number | null; readonly stdout: Buffer }> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        "git",
        [...ISOLATED_GIT_CONFIG_OVERRIDES, ...input.args],
        {
          cwd: input.cwd,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            PATH: process.env.PATH ?? "/usr/bin:/bin",
            HOME: input.isolatedHome,
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_TERMINAL_PROMPT: "0",
            GIT_OPTIONAL_LOCKS: "0",
            LC_ALL: "C",
          },
        },
      );
      const chunks: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.on("error", reject);
      child.on("close", (exitCode) =>
        resolve({ exitCode, stdout: Buffer.concat(chunks) }),
      );
    });
  }
}
