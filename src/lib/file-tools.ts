/**
 * Shared file-tool implementations for agent tool-use loops.
 * All path operations are sandboxed to a given CWD.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MAX_FILE_SIZE = 100 * 1024; // 100KB
const MAX_LIST_RESULTS = 200;
const MAX_SEARCH_RESULTS = 50;

/**
 * Resolve a relative path against CWD and verify it stays within CWD.
 * Throws if the path escapes.
 */
export async function safePath(cwd: string, relative: string): Promise<string> {
  // Resolve the path
  const resolved = path.resolve(cwd, relative);

  // Check it's within CWD (before realpath, to catch obvious escapes)
  const normalizedCwd = path.resolve(cwd);
  if (!resolved.startsWith(normalizedCwd + path.sep) && resolved !== normalizedCwd) {
    throw new Error(`Path '${relative}' resolves outside the working directory.`);
  }

  // If the file exists, also check realpath (catches symlink escapes)
  try {
    const real = await fs.realpath(resolved);
    const realCwd = await fs.realpath(normalizedCwd);
    if (!real.startsWith(realCwd + path.sep) && real !== realCwd) {
      throw new Error(`Path '${relative}' resolves outside the working directory (via symlink).`);
    }
  } catch (err) {
    // File doesn't exist yet — that's OK for write operations
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
    // For new files, verify the parent directory is within CWD
    const parentDir = path.dirname(resolved);
    try {
      const realParent = await fs.realpath(parentDir);
      const realCwd = await fs.realpath(normalizedCwd);
      if (!realParent.startsWith(realCwd + path.sep) && realParent !== realCwd) {
        throw new Error(`Path '${relative}' parent resolves outside the working directory.`);
      }
    } catch {
      // Parent doesn't exist either — will be created by write_file
    }
  }

  return resolved;
}

/** Read a file, capped at MAX_FILE_SIZE */
export async function readFile(cwd: string, relativePath: string): Promise<string> {
  const abs = await safePath(cwd, relativePath);
  const stat = await fs.stat(abs);
  if (stat.size > MAX_FILE_SIZE) {
    const content = await fs.readFile(abs, "utf-8");
    return content.slice(0, MAX_FILE_SIZE) + `\n\n[... truncated at ${MAX_FILE_SIZE} bytes]`;
  }
  return await fs.readFile(abs, "utf-8");
}

/** Write a file, creating parent directories */
export async function writeFile(cwd: string, relativePath: string, content: string): Promise<void> {
  const abs = await safePath(cwd, relativePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
}

/** Edit a file by replacing old_text with new_text */
export async function editFile(
  cwd: string,
  relativePath: string,
  oldText: string,
  newText: string,
): Promise<void> {
  const abs = await safePath(cwd, relativePath);
  const content = await fs.readFile(abs, "utf-8");
  const idx = content.indexOf(oldText);
  if (idx === -1) {
    throw new Error(`old_text not found in '${relativePath}'. Make sure it matches exactly.`);
  }
  const updated = content.slice(0, idx) + newText + content.slice(idx + oldText.length);
  await fs.writeFile(abs, updated, "utf-8");
}

/** List files matching a glob pattern using find */
export async function listFiles(cwd: string, pattern: string): Promise<string[]> {
  try {
    // Use find for simple patterns, or rely on shell glob
    const { stdout } = await execFileAsync("find", [
      ".", "-type", "f", "-name", pattern || "*",
      "-not", "-path", "./.git/*",
      "-not", "-path", "./node_modules/*",
      "-not", "-path", "./__pycache__/*",
      "-not", "-path", "./dist/*",
      "-not", "-path", "./.venv/*",
      "-not", "-path", "./build/*",
    ], { cwd, maxBuffer: 1024 * 1024 });

    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .slice(0, MAX_LIST_RESULTS);
  } catch {
    return [];
  }
}

/** Search for a regex pattern in files using grep */
export async function searchCode(
  cwd: string,
  pattern: string,
  glob?: string,
): Promise<string> {
  try {
    const args = ["-rnP", "--include", glob || "*", "-m", "3", pattern, "."];
    const { stdout } = await execFileAsync("grep", args, {
      cwd,
      maxBuffer: 512 * 1024,
    });

    const lines = stdout.split("\n").filter((l) => l.length > 0);
    if (lines.length > MAX_SEARCH_RESULTS) {
      return lines.slice(0, MAX_SEARCH_RESULTS).join("\n") +
        `\n\n[... ${lines.length - MAX_SEARCH_RESULTS} more results truncated]`;
    }
    return lines.join("\n") || "No matches found.";
  } catch {
    return "No matches found.";
  }
}
