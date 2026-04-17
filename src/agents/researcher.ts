/**
 * Researcher agent — performs internet research on knowledge gaps.
 * Tools: web_search, write_memory
 */

import type { AgentToolDef } from "../lib/pipeline-types.js";

export const RESEARCHER_SYSTEM_PROMPT = `You are the Researcher agent in the synaphex pipeline. Your job is to identify knowledge gaps in the project context and perform internet research to fill them.

## Your Process

1. Analyze the task and examiner output for knowledge gaps
2. Identify unfamiliar libraries, frameworks, patterns, or domains mentioned
3. Perform targeted web searches for each gap
4. Synthesize findings into coherent documentation
5. Save findings to project memory for the Planner and Coder to use

## Examples of Knowledge Gaps

- "We need to integrate with Triton library but I don't know its API"
- "Task mentions ROS 2 migration but codebase is ROS 1 Noetic"
- "Need to implement WebSocket but unsure of best practices"
- "Security requirement mentioned but unclear what compliance standard applies"

## Output Format

Provide a summary of:
1. **Knowledge Gaps Identified**: What you didn't know initially
2. **Research Performed**: Which searches you ran and why
3. **Findings Summary**: Key insights from research
4. **Memory Saved**: Which files were created/updated in memory/internal/research/

## Rules

- Only research topics relevant to the task
- Focus on practical implementation details, not theory
- Cite sources when possible
- Keep findings concise and actionable (2-4 pages max per topic)
- Save multiple topics if needed (e.g., library-api.md, security-framework.md)
`;

export const RESEARCHER_TOOLS: AgentToolDef[] = [
  {
    name: "web_search",
    description:
      "Search the web for information on a topic. Returns relevant snippets from search results.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query (e.g., 'Triton inference server API documentation')",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "write_memory",
    description:
      "Save research findings to a project memory file. Use this to persist findings for future reference.",
    input_schema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description:
            "Filename within memory/internal/research/ (e.g., 'triton-library.md')",
        },
        content: {
          type: "string",
          description: "Full markdown content with research findings",
        },
      },
      required: ["filename", "content"],
    },
  },
];

/**
 * Build the initial user message for the Researcher.
 */
export function buildResearcherPrompt(
  task: string,
  examinerCompact: string,
): string {
  return [
    `## Task`,
    task,
    "",
    `## Context from Examiner`,
    examinerCompact,
    "",
    `## Instructions`,
    `Analyze the task and context above. Identify any knowledge gaps (unfamiliar libraries, frameworks, `,
    `domains, compliance standards, etc.). Perform targeted web research to fill those gaps. Save your `,
    `findings to memory/internal/research/ files.`,
    "",
    `Provide a summary of what you researched and what you found.`,
  ].join("\n");
}
