import { spawn } from "node:child_process";
import { startConfigureServer } from "./configure-server.js";

/**
 * `synaphex configure` -- the local configuration GUI.
 *
 * Configuration only. This command starts a loopback HTTP server and opens a
 * browser at it; it registers no MCP host, installs no provider, touches no
 * credential and invokes no agent. The install/configure boundary is
 * deliberate: `synaphex install` owns provider registration, this owns agent
 * and rule configuration.
 */

export interface ConfigureCommandOptions {
  /** Suppresses the browser launch. Used by automated smoke runs. */
  readonly open?: boolean;
  readonly port?: number;
  readonly synaphexRoot?: string;
  readonly homeDirectory?: string;
  readonly stdout?: (line: string) => void;
  /** Resolves when the caller wants the server to stop. Tests supply this. */
  readonly until?: Promise<void>;
}

export async function runConfigure(
  options: ConfigureCommandOptions = {},
): Promise<number> {
  const write = options.stdout ?? ((line: string) => process.stdout.write(line));

  const server = await startConfigureServer({
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.synaphexRoot === undefined
      ? {}
      : { synaphexRoot: options.synaphexRoot }),
    ...(options.homeDirectory === undefined
      ? {}
      : { homeDirectory: options.homeDirectory }),
  });

  write(`\nSynaphex Configure\n${server.url}\n\n`);

  if (options.open !== false) {
    const opened = await openBrowser(server.url);
    if (!opened) {
      // A failed browser launch is not a failed command: the server is
      // running and the URL is already printed, so the user can open it.
      write("Could not open a browser automatically. Open the URL above.\n");
    }
  }

  await waitForShutdown(options.until);
  await server.close();
  write("Synaphex Configure stopped.\n");
  return 0;
}

/**
 * Opens the default browser on Linux, the only platform v0.1 claims.
 *
 * `xdg-open` is detached and its output discarded so a desktop-less machine
 * cannot hang or spam the terminal. Failure is reported, never thrown.
 */
function openBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn("xdg-open", [url], {
        stdio: "ignore",
        detached: true,
      });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Resolves on Ctrl+C, SIGTERM, or an injected signal.
 *
 * Listeners are removed afterwards so repeated in-process runs (tests) do not
 * accumulate handlers, and so the process is left exactly as it was found.
 */
function waitForShutdown(until: Promise<void> | undefined): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      process.removeListener("SIGINT", finish);
      process.removeListener("SIGTERM", finish);
      resolve();
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
    void until?.then(finish);
  });
}

/** Parses the one supported flag. Unknown flags are reported, not ignored. */
export function parseConfigureArgs(
  argv: readonly string[],
): { readonly open: boolean } | { readonly error: string } {
  let open = true;
  for (const argument of argv) {
    if (argument === "--no-open") {
      open = false;
      continue;
    }
    return { error: `Unknown option for synaphex configure: ${argument}` };
  }
  return { open };
}
