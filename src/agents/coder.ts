/**
 * Coder agent — implements the plan using file tools + ask_answerer.
 * Tools: read_file, write_file, edit_file, list_files, search_code, ask_answerer
 */

import type { AgentToolDef } from "../lib/pipeline-types.js";

export const CODER_SYSTEM_PROMPT = `You are the Coder agent in the synaphex pipeline. Your job is to implement a plan by reading, writing, and editing files in the user's workspace.

## Available tools
- read_file: Read a file's contents
- write_file: Create or overwrite a file
- edit_file: Replace a specific text snippet in a file
- list_files: List files matching a glob pattern
- search_code: Search for a regex pattern in files
- ask_answerer: Ask the Answerer agent a question about the project (use when you need clarification about requirements, conventions, or architecture)

## Rules
- Follow the plan closely — implement exactly what it specifies
- Do NOT add extra features, refactoring, or "improvements" beyond the plan
- Write clean, idiomatic code matching the existing codebase style
- Create parent directories implicitly when writing files (write_file handles this)
- If you're unsure about a requirement or convention, use ask_answerer
- If ask_answerer returns an escalation, STOP immediately and include the escalation in your final response
- After implementing all steps, produce a summary listing files created, modified, and deleted
- Do NOT add unnecessary comments, docstrings, or type annotations to code you didn't write
- Be careful about security: validate paths, sanitize inputs at boundaries

## Output format
After completing implementation, end your response with:

### === IMPLEMENTATION SUMMARY ===
- **Files created**: list of new files
- **Files modified**: list of modified files
- **Files deleted**: list of deleted files (if any)
- **Notes**: any important implementation notes

If an escalation occurred:
### === ESCALATION ===
- **Question**: the question for the user
- **Context**: why this needs human input
`;

export const CODER_TOOLS: AgentToolDef[] = [
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
    name: "write_file",
    description: "Create or overwrite a file. Creates parent directories automatically. Path is relative to the working directory.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to the file" },
        content: { type: "string", description: "Full file content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Replace a specific text snippet in a file. The old_text must match exactly (including whitespace).",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to the file" },
        old_text: { type: "string", description: "Exact text to find and replace" },
        new_text: { type: "string", description: "Replacement text" },
      },
      required: ["path", "old_text", "new_text"],
    },
  },
  {
    name: "list_files",
    description: "List files matching a glob pattern. Returns up to 200 results.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern (e.g. '**/*.ts')" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "search_code",
    description: "Search for a regex pattern in files. Returns up to 50 matching lines.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for" },
        glob: { type: "string", description: "Optional glob to filter files" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "ask_answerer",
    description: "Ask the Answerer agent a question about the project. Use when you need clarification about requirements, conventions, or architecture. If the Answerer can't answer, it will escalate to the user.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Your question" },
        context: { type: "string", description: "Optional context about what you're trying to do" },
      },
      required: ["question"],
    },
  },
];

/**
 * Build the initial user message for the Coder.
 */
export function buildCoderPrompt(
  task: string,
  plan: string,
  examinerCompact: string,
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
    `## Plan`,
    plan,
    "",
    `## Examiner Analysis`,
    examinerCompact,
    "",
    `## Project Memory`,
    memoryDigest,
    "",
    `## Instructions`,
    `Implement the plan above. Follow each step carefully. Use tools to read, write, and edit files.`,
    `If you need clarification, use ask_answerer. If ask_answerer escalates, stop and report.`,
  ].join("\n");
}
