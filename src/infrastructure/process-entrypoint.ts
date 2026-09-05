import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Reports whether `moduleUrl` is the module the process was started with.
 *
 * Compares RESOLVED filesystem paths. npm installs a package's `bin` entries
 * as symlinks (`<prefix>/bin/<name>` -> `<pkg>/dist/.../entry.js`), so
 * `process.argv[1]` is the SYMLINK path: comparing it directly against
 * `import.meta.url`, or matching on a filename suffix, silently fails and the
 * command exits 0 having done nothing at all.
 *
 * That failure mode is invisible to source tests, because running the built
 * file directly still works -- only the installed shim breaks. Both Synaphex
 * bins share this helper so the two cannot drift apart.
 */
export function isProcessEntrypoint(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
