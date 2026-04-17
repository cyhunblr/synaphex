import { promises as fs } from "node:fs";
import * as path from "node:path";
import { internalMemoryDir, projectExists } from "../lib/project-store.js";

export async function handleReadMemory(
  project: string,
  filename: string,
): Promise<string> {
  if (!(await projectExists(project))) {
    throw new Error(
      `Project '${project}' does not exist. ` +
        `Use the 'create' tool to create it first.`,
    );
  }

  // Sanitize filename: no path traversal
  const normalized = path.normalize(filename);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(
      `Invalid filename: ${filename}. Must be a relative path within memory/internal/.`,
    );
  }

  const internalDir = internalMemoryDir(project);
  const internalPath = path.join(internalDir, normalized);

  if (!internalPath.startsWith(internalDir)) {
    throw new Error(`Path traversal detected: ${filename}`);
  }

  try {
    const content = await fs.readFile(internalPath, "utf-8");
    return content;
  } catch (err) {
    throw new Error(`Memory file not found: memory/internal/${normalized}`, {
      cause: err,
    });
  }
}
