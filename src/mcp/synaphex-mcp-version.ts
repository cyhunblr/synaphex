import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolves the Synaphex package version for MCP server identity.
 *
 * The version is read from the package's own `package.json` rather than
 * duplicated as a constant, so server identity cannot drift from the published
 * package. The manifest is located by walking upwards, because this module
 * sits at a different depth under `dist/` than under the test output root.
 */
export async function readSynaphexVersion(): Promise<string> {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(directory, "package.json");
    const version = await readVersion(candidate);
    if (version !== null) {
      return version;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  throw new Error("Unable to locate the Synaphex package.json version");
}

async function readVersion(path: string): Promise<string | null> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const parsed: unknown = JSON.parse(contents);
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    (parsed as { name?: unknown }).name === "synaphex" &&
    typeof (parsed as { version?: unknown }).version === "string"
  ) {
    return (parsed as { version: string }).version;
  }
  return null;
}
