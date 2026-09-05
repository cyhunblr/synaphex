import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Serves the pre-built configure UI from the published package.
 *
 * The bundle is produced at build time and shipped inside `dist/`, so
 * `synaphex configure` works from a plain `npm install -g` with no checkout,
 * no dev server and no network access.
 *
 * Path handling is deliberately strict: a request path is normalised and then
 * required to resolve *inside* the asset root, so no `..` sequence or absolute
 * path can turn this into a general file-read endpoint.
 */

const WEB_ROOT = resolve(fileURLToPath(new URL("./web", import.meta.url)));

const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
});

export interface ConfigureAsset {
  readonly body: string | Buffer;
  readonly contentType: string;
}

/**
 * Resolves one request path to a shipped asset.
 *
 * Returns null rather than throwing for anything unresolvable, so the server
 * answers a plain 404 without revealing whether a path exists on disk.
 */
export async function readConfigureAsset(
  requestPath: string,
  sessionToken: string,
): Promise<ConfigureAsset | null> {
  const relative = requestPath === "/" ? "index.html" : requestPath.slice(1);

  // Reject traversal before touching the filesystem.
  const normalized = normalize(relative);
  if (
    normalized.startsWith("..") ||
    normalized.startsWith(sep) ||
    normalized.includes(`..${sep}`)
  ) {
    return null;
  }

  const absolute = resolve(join(WEB_ROOT, normalized));
  // Containment check on the resolved path: the definitive guard.
  if (absolute !== WEB_ROOT && !absolute.startsWith(WEB_ROOT + sep)) {
    return null;
  }

  const extension = extname(absolute).toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  if (contentType === undefined) {
    return null;
  }

  let body: Buffer;
  try {
    body = await readFile(absolute);
  } catch {
    return null;
  }

  if (extension === ".html") {
    // The token reaches the page only by being written into the document we
    // served, so a page the user did not open from this process never has it.
    return {
      contentType,
      body: body
        .toString("utf8")
        .replace("__SYNAPHEX_CONFIGURE_TOKEN__", sessionToken),
    };
  }

  return { body, contentType };
}

export { WEB_ROOT };
