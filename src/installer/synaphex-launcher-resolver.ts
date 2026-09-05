import { access, constants } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SynaphexLauncherNotFoundError } from "../domain/errors.js";
import type { SynaphexLauncher } from "../domain/installation.js";

export interface LauncherResolverOptions {
  /** Overridable for tests; defaults to this module's own location. */
  readonly moduleUrl?: string;
  readonly nodeExecutable?: string;
}

const ENTRYPOINT_RELATIVE = join("mcp", "stdio-main.js");

/**
 * Resolves the absolute launcher a provider host should spawn.
 *
 * Deliberately NOT the npm bin shim. A shim begins with
 * `#!/usr/bin/env node`, which resolves whatever `node` happens to be first on
 * the host's PATH. A GUI-launched VS Code frequently does not inherit the
 * shell PATH used at install time, and an old system Node cannot parse the
 * package's ESM -- the server would die with a syntax error before the
 * transport ever opened. Pinning the absolute interpreter and the absolute
 * entrypoint removes that whole class of failure.
 *
 * The path is derived from THIS module's own location, so it points at the
 * installed package rather than at a build directory or a source checkout.
 */
export class SynaphexLauncherResolver {
  constructor(private readonly options: LauncherResolverOptions = {}) {}

  async resolve(): Promise<SynaphexLauncher> {
    const command = this.options.nodeExecutable ?? process.execPath;
    const moduleUrl = this.options.moduleUrl ?? import.meta.url;
    // .../<pkg>/dist/installer/this-file.js -> .../<pkg>/dist
    const distDirectory = resolve(dirname(fileURLToPath(moduleUrl)), "..");
    const entrypoint = join(distDirectory, ENTRYPOINT_RELATIVE);

    for (const [path, what] of [
      [command, "node executable"],
      [entrypoint, "MCP entrypoint"],
    ] as const) {
      try {
        await access(path, constants.R_OK);
      } catch {
        throw new SynaphexLauncherNotFoundError(
          `${what} is not readable at ${path}`,
        );
      }
    }
    return { command, args: [entrypoint] };
  }
}
