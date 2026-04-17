/**
 * Examiner agent — reads memory + source code, produces raw + compact analysis.
 * Tools: read_file, list_files, search_code, write_memory
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentToolDef } from "../lib/pipeline-types.js";

const execFileAsync = promisify(execFile);

const MAX_FILE_SIZE = 100 * 1024; // 100KB
const MAX_LIST_RESULTS = 200;
const MAX_SEARCH_RESULTS = 50;

/**
 * Resolve a relative path against CWD and verify it stays within CWD.
 * Throws if the path escapes.
 */
export async function safePath(cwd: string, relative: string): Promise<string> {
  const resolved = path.resolve(cwd, relative);
  const normalizedCwd = path.resolve(cwd);
  if (
    !resolved.startsWith(normalizedCwd + path.sep) &&
    resolved !== normalizedCwd
  ) {
    throw new Error(
      `Path '${relative}' resolves outside the working directory.`,
    );
  }

  try {
    const real = await fs.realpath(resolved);
    const realCwd = await fs.realpath(normalizedCwd);
    if (!real.startsWith(realCwd + path.sep) && real !== realCwd) {
      throw new Error(
        `Path '${relative}' resolves outside the working directory (via symlink).`,
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
    const parentDir = path.dirname(resolved);
    try {
      const realParent = await fs.realpath(parentDir);
      const realCwd = await fs.realpath(normalizedCwd);
      if (
        !realParent.startsWith(realCwd + path.sep) &&
        realParent !== realCwd
      ) {
        throw new Error(
          `Path '${relative}' parent resolves outside the working directory.`,
        );
      }
    } catch {
      // Parent doesn't exist — will be created by writeFile
    }
  }

  return resolved;
}

/** Read a file, capped at MAX_FILE_SIZE */
export async function readFile(
  cwd: string,
  relativePath: string,
): Promise<string> {
  const abs = await safePath(cwd, relativePath);
  const stat = await fs.stat(abs);
  if (stat.size > MAX_FILE_SIZE) {
    const content = await fs.readFile(abs, "utf-8");
    return (
      content.slice(0, MAX_FILE_SIZE) +
      `\n\n[... truncated at ${MAX_FILE_SIZE} bytes]`
    );
  }
  return await fs.readFile(abs, "utf-8");
}

/** Write a file, creating parent directories */
export async function writeFile(
  cwd: string,
  relativePath: string,
  content: string,
): Promise<void> {
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
    throw new Error(
      `old_text not found in '${relativePath}'. Make sure it matches exactly.`,
    );
  }
  const updated =
    content.slice(0, idx) + newText + content.slice(idx + oldText.length);
  await fs.writeFile(abs, updated, "utf-8");
}

/** List files matching a glob pattern using find */
export async function listFiles(
  cwd: string,
  pattern: string,
): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "find",
      [
        ".",
        "-type",
        "f",
        "-name",
        pattern || "*",
        "-not",
        "-path",
        "./.git/*",
        "-not",
        "-path",
        "./node_modules/*",
        "-not",
        "-path",
        "./__pycache__/*",
        "-not",
        "-path",
        "./dist/*",
        "-not",
        "-path",
        "./.venv/*",
        "-not",
        "-path",
        "./build/*",
      ],
      { cwd, maxBuffer: 1024 * 1024 },
    );

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
      return (
        lines.slice(0, MAX_SEARCH_RESULTS).join("\n") +
        `\n\n[... ${lines.length - MAX_SEARCH_RESULTS} more results truncated]`
      );
    }
    return lines.join("\n") || "No matches found.";
  } catch {
    return "No matches found.";
  }
}

export const EXAMINER_SYSTEM_PROMPT = `You are the Examiner agent in the synaphex pipeline. Your job is to analyze the user's codebase and project memory to produce a thorough understanding of the context needed for a given task.

## Your process

1. Parse the task sentence for entity names (functions, files, modules, endpoints, etc.)
2. Use list_files to survey the workspace structure
3. Use search_code to find entities mentioned in the task
4. Use read_file on the most relevant files (up to 20 files)
5. Read imports and dependencies of those files to understand the dependency chain
6. If you find outdated information in project memory, use write_memory to update it

## Output format

You must produce TWO sections in your final response, clearly separated:

### === RAW ANALYSIS ===
Full analysis with all code excerpts, dependency chains, full memory sections, architectural notes.
Be thorough — this is saved to disk for reference but not passed to other agents.

### === COMPACT ANALYSIS ===
Condensed summary (~4000 tokens max) containing:
- **Task summary**: What needs to be done, restated precisely
- **Files to touch**: Which files need creation/modification/deletion
- **Key interfaces**: Relevant types, function signatures, API contracts
- **Patterns to follow**: Coding conventions, naming patterns, error handling style observed in the codebase
- **Constraints**: Dependencies, compatibility requirements, edge cases to watch
- **Memory notes**: Relevant context from project memory

The compact section is what gets passed to the Planner and Coder agents, so make it information-dense and actionable.

## Rules
- Only read files within the provided CWD
- Be thorough but efficient — don't read every file, focus on what's relevant to the task
- If you update memory, explain what you changed and why in the raw section
`;

export const EXAMINER_TOOLS: AgentToolDef[] = [
  {
    name: "read_file",
    description:
      "Read the contents of a file. Path is relative to the working directory.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to the file" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_files",
    description:
      "List files matching a glob pattern in the working directory. Returns up to 200 results.",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            "Glob pattern (e.g. '**/*.ts', 'src/**/*.py'). Defaults to '**/*' if empty.",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "search_code",
    description:
      "Search for a regex pattern in files. Returns up to 50 matching lines with file paths and line numbers.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for" },
        glob: {
          type: "string",
          description: "Optional glob to filter files (e.g. '*.ts')",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "write_memory",
    description:
      "Update a project memory file. Use when you find outdated information in the memory digest.",
    input_schema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description:
            "Relative filename within memory/internal/ (e.g. 'overview.md')",
        },
        content: {
          type: "string",
          description: "Full markdown content to write",
        },
      },
      required: ["filename", "content"],
    },
  },
];

/**
 * Build the initial user message for the Examiner.
 */
export function buildExaminerPrompt(
  task: string,
  memoryDigest: string,
  cwd: string,
): string {
  return [
    `## Task`,
    task,
    "",
    `## Working Directory`,
    cwd,
    "",
    `## Project Memory`,
    memoryDigest,
    "",
    `## Instructions`,
    `Analyze the codebase and memory to understand what's needed for this task.`,
    `Produce your output in the two-section format (RAW ANALYSIS + COMPACT ANALYSIS).`,
  ].join("\n");
}
