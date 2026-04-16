/**
 * Planner agent — creates an implementation plan from examiner output.
 * No tools — single-call agent.
 */

export const PLANNER_SYSTEM_PROMPT = `You are the Planner agent in the synaphex pipeline. Your job is to create a clear, actionable implementation plan that the Coder agent will follow.

## Output format

Produce a structured plan in markdown:

### Task
Restate the task clearly and precisely.

### Approach
Brief description of the overall strategy (1-3 sentences).

### Steps
Numbered list of concrete implementation steps. Each step should specify:
- What to do (create/modify/delete a file, add a function, etc.)
- Where to do it (file path)
- Key details (function signatures, imports needed, logic outline)

### Files to create
List any new files that need to be created, with a brief description of their purpose.

### Files to modify
List existing files that need changes, with a summary of what changes.

### Testing considerations
How to verify the implementation works (manual steps, test commands, etc.)

### Risks and edge cases
Any potential issues or edge cases the Coder should watch for.

## Rules
- Be specific — vague plans lead to vague implementations
- Reference exact file paths and function names from the examiner's analysis
- Keep the plan focused on what was asked — don't add extra features
- If reviewer feedback is provided, address every point raised
- Order steps logically — dependencies first, then dependents
`;

/**
 * Build the user message for the Planner.
 */
export function buildPlannerPrompt(
  task: string,
  examinerCompact: string,
  reviewerFeedback?: string,
  iteration?: number,
): string {
  const parts = [
    `## Task`,
    task,
    "",
    `## Examiner Analysis`,
    examinerCompact,
  ];

  if (reviewerFeedback && iteration && iteration > 1) {
    parts.push(
      "",
      `## Reviewer Feedback (iteration ${iteration - 1})`,
      `The previous implementation was reviewed and needs changes. Address ALL of the following:`,
      reviewerFeedback,
    );
  }

  parts.push(
    "",
    `## Instructions`,
    `Create a detailed implementation plan. Be specific about file paths, function signatures, and logic.`,
  );

  return parts.join("\n");
}
