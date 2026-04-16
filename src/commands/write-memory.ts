import { promises as fs } from "node:fs";
import * as path from "node:path";

import { internalMemoryDir, projectExists } from "../lib/project-store.js";

export async function handleWriteMemory(
  project: string,
  filename: string,
  content: string,
): Promise<string> {
  if (!(await projectExists(project))) {
    throw new Error(
      `Project '${project}' does not exist. ` +
        `Use /synaphex:create ${project} to create it first.`,
    );
  }

  // Sanitize filename: no path traversal
  const normalized = path.normalize(filename);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`Invalid filename: ${filename}. Must be a relative path within memory/internal/.`);
  }

  const internalDir = internalMemoryDir(project);
  const targetPath = path.join(internalDir, normalized);

  // Ensure the target is still within internalDir (defense in depth)
  if (!targetPath.startsWith(internalDir)) {
    throw new Error(`Path traversal detected: ${filename}`);
  }

  // Ensure parent directory exists (for packages/<pkg>.md etc.)
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  await fs.writeFile(targetPath, content, "utf-8");

  return `Wrote ${content.split("\n").length} lines to ${targetPath}`;
}
