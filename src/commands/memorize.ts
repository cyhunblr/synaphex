import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

import {
  internalMemoryDir,
  metaPath,
  projectExists,
  readJsonFile,
  writeJsonFile,
  type ProjectMeta,
} from "../lib/project-store.js";
import { TOPIC_FILES, isScaffoldOnly } from "../lib/memory-scaffold.js";

const execFileAsync = promisify(execFile);

interface FileEntry {
  relPath: string;
  size: number;
  mtime: number; // timestamp
}

/**
 * List files in the source directory, respecting .gitignore if in a git repo,
 * or a hardcoded ignore list otherwise. Returns at most 500 entries.
 */
async function listSourceFiles(sourcePath: string): Promise<FileEntry[]> {
  const isGitRepo = await isGitRepository(sourcePath);
  let files: FileEntry[];

  if (isGitRepo) {
    // Use git ls-files to respect .gitignore
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["ls-files", "--others", "--cached"],
        {
          cwd: sourcePath,
        },
      );
      const paths = stdout
        .trim()
        .split("\n")
        .filter((p) => p.length > 0);
      const results = await Promise.all(
        paths.map(async (relPath) => {
          const fullPath = path.join(sourcePath, relPath);
          try {
            const stat = await fs.stat(fullPath);
            return {
              relPath,
              size: stat.size,
              mtime: stat.mtimeMs,
            } as FileEntry;
          } catch {
            return null;
          }
        }),
      );
      files = results.filter((f): f is FileEntry => f !== null);
    } catch {
      // git ls-files failed; fall back to hardcoded ignore
      files = await scanWithIgnore(sourcePath);
    }
  } else {
    files = await scanWithIgnore(sourcePath);
  }

  // Sort by mtime desc, then cap at 500
  files.sort((a, b) => b.mtime - a.mtime);
  if (files.length > 500) {
    files = files.slice(0, 500);
  }

  return files;
}

async function isGitRepository(sourcePath: string): Promise<boolean> {
  try {
    await fs.stat(path.join(sourcePath, ".git"));
    return true;
  } catch {
    return false;
  }
}

const IGNORE_PATTERNS = [
  "node_modules",
  "build",
  "dist",
  ".git",
  "__pycache__",
  ".venv",
  ".env",
];

async function scanWithIgnore(sourcePath: string): Promise<FileEntry[]> {
  const files: FileEntry[] = [];

  const scan = async (dir: string, relBase: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = path.join(relBase, entry.name);

      // Skip ignored patterns
      if (IGNORE_PATTERNS.some((p) => relPath.includes(p))) {
        continue;
      }

      if (entry.isFile()) {
        const fullPath = path.join(dir, entry.name);
        try {
          const stat = await fs.stat(fullPath);
          files.push({
            relPath,
            size: stat.size,
            mtime: stat.mtimeMs,
          });
        } catch {
          // skip files we can't stat
        }
      } else if (entry.isDirectory()) {
        await scan(path.join(dir, entry.name), relPath);
      }
    }
  };

  await scan(sourcePath, "");
  return files;
}

/**
 * Compute SHA-256 hash of the file listing to detect changes between memorize runs.
 */
function hashFileList(files: FileEntry[]): string {
  const sorted = files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  const content = sorted
    .map((f) => `${f.relPath}|${f.size}|${f.mtime}`)
    .join("\n");
  return createHash("sha256").update(content).digest("hex");
}

export async function handleMemorize(
  project: string,
  sourcePath: string,
): Promise<string> {
  if (!(await projectExists(project))) {
    throw new Error(
      `Project '${project}' does not exist. ` +
        `Use the 'create' tool ${project} to create it first.`,
    );
  }

  // Verify source path exists
  try {
    await fs.stat(sourcePath);
  } catch {
    throw new Error(`Source path does not exist: ${sourcePath}`);
  }

  const internalDir = internalMemoryDir(project);
  const metaPathFile = metaPath(project);

  // Load previous meta if it exists
  let previousMeta: ProjectMeta | undefined;
  try {
    previousMeta = await readJsonFile<ProjectMeta>(metaPathFile);
  } catch {
    // First run — no previous meta
  }

  // List files from source
  const currentFiles = await listSourceFiles(sourcePath);
  const currentHash = hashFileList(currentFiles);

  // Determine run type
  const isInitial = !previousMeta?.lastMemorizeAt;
  const runType = isInitial ? "initial" : "update";

  // If it's an update, compute diffs (simplified: only track by mtime)
  const diffs: { added: string[]; modified: string[]; removed: string[] } = {
    added: [],
    modified: [],
    removed: [],
  };
  if (!isInitial && previousMeta?.lastMemorizeAt) {
    // Simplified diff: files with mtime > lastMemorizeAt are considered modified
    const lastTime = new Date(previousMeta.lastMemorizeAt).getTime();
    diffs.modified = currentFiles
      .filter((f) => f.mtime > lastTime)
      .map((f) => f.relPath);
  }

  // Check current memory state
  const memoryState: Record<string, { status: string; preview: string }> = {};
  for (const file of TOPIC_FILES) {
    const filePath = path.join(internalDir, file.relPath);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const isEmpty = isScaffoldOnly(content, file.contents);
      const lineCount = content.split("\n").length;
      const preview = content.slice(0, 200).replace(/\n/g, " ");
      memoryState[file.relPath] = {
        status: isEmpty ? "empty" : `populated (${lineCount} lines)`,
        preview,
      };
    } catch {
      memoryState[file.relPath] = {
        status: "error reading",
        preview: "",
      };
    }
  }

  // Build file listing output
  const fileListing = currentFiles
    .map((f) => {
      const sizeKB = (f.size / 1024).toFixed(1);
      const date = new Date(f.mtime).toISOString().split("T")[0];
      return `${f.relPath} (${sizeKB} KB, ${date})`;
    })
    .join("\n");

  // Build response
  const lines: string[] = [];
  lines.push(`# Memorize: ${project} from ${sourcePath}`);
  lines.push("");
  lines.push("## Source File Listing");
  lines.push(fileListing || "(no files found)");
  lines.push("");

  lines.push("## Run Type");
  lines.push(runType);
  lines.push("");

  if (!isInitial) {
    lines.push("## Changes Since Last Memorize");
    if (diffs.added.length > 0) {
      lines.push(`- added: ${diffs.added.join(", ") || "(none)"}`);
    }
    if (diffs.modified.length > 0) {
      lines.push(`- modified: ${diffs.modified.join(", ") || "(none)"}`);
    }
    if (diffs.removed.length > 0) {
      lines.push(`- removed: ${diffs.removed.join(", ") || "(none)"}`);
    }
    lines.push("");
  }

  lines.push("## Current Memory State");
  for (const file of TOPIC_FILES) {
    const state = memoryState[file.relPath];
    lines.push(`### ${file.relPath}`);
    lines.push(`- Status: ${state.status}`);
    if (state.preview) {
      lines.push(`- Preview: ${state.preview.slice(0, 100)}…`);
    }
    lines.push("");
  }

  lines.push("## Memory Schema Instructions");
  lines.push("");
  lines.push(
    "You are analyzing the source code at `" +
      sourcePath +
      "` to populate synaphex memory files for project `" +
      project +
      "`. Use Read, Glob, and Grep tools to understand the codebase, " +
      "then use the `synaphex_write_memory` tool to save each file.",
  );
  lines.push("");
  lines.push(
    '**Use `synaphex_write_memory` with `project: "' +
      project +
      '"` and `filename` as shown below.** ' +
      "Do NOT use the Write tool directly.",
  );
  lines.push("");

  for (const file of TOPIC_FILES) {
    lines.push(`### ${file.relPath}`);
    lines.push(
      `\`synaphex_write_memory({ project: "${project}", filename: "${file.relPath}", content: "..." })\``,
    );
    lines.push(file.purpose);
    lines.push("");
  }

  lines.push("### packages/<pkg>.md");
  lines.push(
    `\`synaphex_write_memory({ project: "${project}", filename: "packages/<pkg>.md", content: "..." })\``,
  );
  lines.push(
    "For each catkin package found (directory with package.xml), create a file. " +
      "Document: purpose, nodes, topics, services, dependencies, launch files.",
  );
  lines.push("");

  lines.push(
    "On UPDATE runs: preserve existing structure, update facts, remove references to deleted files.",
  );
  lines.push("");

  // Update meta.json with new state
  const newMeta: ProjectMeta = {
    name: project,
    createdAt: previousMeta?.createdAt ?? new Date().toISOString(),
    lastMemorizeAt: new Date().toISOString(),
    lastMemorizeSourcePath: sourcePath,
    memorizeContentHash: currentHash,
  };
  await writeJsonFile(metaPathFile, newMeta);

  return lines.join("\n");
}
