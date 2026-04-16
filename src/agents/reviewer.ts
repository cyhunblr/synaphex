/**
 * Reviewer agent — checks implementation quality and correctness.
 * Tools: read_file, list_files, search_code (for verification)
 */

import type { AgentToolDef } from "../lib/pipeline-types.js";

export const REVIEWER_SYSTEM_PROMPT = `You are the Reviewer agent in the synaphex pipeline. Your job is to verify that the Coder's implementation correctly and completely fulfills the task and plan.

## Your process
1. Read the implementation summary to understand what was done
2. Use read_file to inspect the actual code changes
3. Verify each step of the plan was addressed
4. Check for common issues: missing error handling at boundaries, incorrect imports, type mismatches, logic errors, security issues
5. Use search_code to verify consistency (e.g., all callers updated, no stale references)

## Output format

Your response must end with EXACTLY one of these verdicts:

### If approved:
VERDICT: APPROVED
The implementation correctly fulfills the task. [brief positive note]

### If changes needed:
VERDICT: NEEDS_CHANGES

**Issues found:**
1. [Specific issue with file path and description]
2. [Another issue]

**Feedback for Planner:**
[Specific guidance for the next iteration — what to fix, what to keep, what to reconsider]

## Rules
- Be thorough but fair — don't nitpick style if the code follows existing conventions
- Focus on correctness, completeness, and safety
- Every issue must reference a specific file and describe what's wrong
- Don't flag things that are outside the scope of the task
- If the implementation is substantially correct with only trivial issues, APPROVE it
- Provide actionable feedback — "fix X in Y" not "this could be better"
`;

export const REVIEWER_TOOLS: AgentToolDef[] = [
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
      "List files matching a glob pattern. Returns up to 200 results.",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern (e.g. '**/*.ts')",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "search_code",
    description:
      "Search for a regex pattern in files. Returns up to 50 matching lines.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for" },
        glob: { type: "string", description: "Optional glob to filter files" },
      },
      required: ["pattern"],
    },
  },
];

/**
 * Build the user message for the Reviewer.
 */
export function buildReviewerPrompt(
  task: string,
  plan: string,
  implementationSummary: string,
  examinerCompact: string,
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
    `## Implementation Summary`,
    implementationSummary,
    "",
    `## Examiner Analysis`,
    examinerCompact,
    "",
    `## Instructions`,
    `Review the implementation. Read the actual files to verify correctness.`,
    `End with your VERDICT (APPROVED or NEEDS_CHANGES).`,
  ].join("\n");
}

/**
 * Parse a Reviewer response to extract the verdict and feedback.
 */
export function parseReviewerResponse(text: string): {
  verdict: "approved" | "needs_changes";
  reviewText: string;
  feedbackForPlanner: string;
} {
  const verdictMatch = text.match(/VERDICT:\s*(APPROVED|NEEDS_CHANGES)/i);

  if (!verdictMatch) {
    // Default to needs_changes if we can't parse
    return {
      verdict: "needs_changes",
      reviewText: text,
      feedbackForPlanner:
        "Reviewer did not provide a clear verdict. Please review the output and address any concerns.",
    };
  }

  const verdict =
    verdictMatch[1].toUpperCase() === "APPROVED" ? "approved" : "needs_changes";

  // Extract feedback for planner (everything after "Feedback for Planner:")
  const feedbackMatch = text.match(
    /\*\*Feedback for Planner:\*\*\s*([\s\S]*?)(?:\n#{2,}|\n*$)/i,
  );
  const feedbackForPlanner = feedbackMatch
    ? feedbackMatch[1].trim()
    : verdict === "needs_changes"
      ? text // Pass the whole review as feedback if we can't find the section
      : "";

  return { verdict, reviewText: text, feedbackForPlanner };
}
