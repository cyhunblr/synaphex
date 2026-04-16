/**
 * Examiner agent — reads memory + source code, produces raw + compact analysis.
 * Tools: read_file, list_files, search_code, write_memory
 */

import type { AgentToolDef, ToolCallHandler } from "../lib/pipeline-types.js";

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
    description: "Read the contents of a file. Path is relative to the working directory.",
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
    description: "List files matching a glob pattern in the working directory. Returns up to 200 results.",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern (e.g. '**/*.ts', 'src/**/*.py'). Defaults to '**/*' if empty.",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "search_code",
    description: "Search for a regex pattern in files. Returns up to 50 matching lines with file paths and line numbers.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for" },
        glob: { type: "string", description: "Optional glob to filter files (e.g. '*.ts')" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "write_memory",
    description: "Update a project memory file. Use when you find outdated information in the memory digest.",
    input_schema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "Relative filename within memory/internal/ (e.g. 'overview.md')",
        },
        content: { type: "string", description: "Full markdown content to write" },
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
