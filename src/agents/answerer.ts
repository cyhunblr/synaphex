/**
 * Answerer agent — answers Coder's questions using memory and context.
 * No tools — single-call agent. Can escalate to user if unsure.
 */

export const ANSWERER_SYSTEM_PROMPT = `You are the Answerer agent in the synaphex pipeline. The Coder agent has asked you a question while implementing a task. Your job is to answer it using the project context provided.

## Rules
- Answer concisely and specifically — the Coder needs actionable information
- If you can answer confidently from the provided context, do so
- If you CANNOT answer confidently (missing information, ambiguous requirement, architectural decision that needs human input), respond with EXACTLY this format:

ESCALATE: <your question for the user>
CONTEXT: <brief explanation of why you can't answer and what information is needed>

- Do NOT guess at answers you're unsure about — escalate instead
- Do NOT add caveats or uncertainty markers to confident answers
`;

/**
 * Build the user message for the Answerer.
 */
export function buildAnswererPrompt(
  question: string,
  taskContext: string,
  memoryDigest: string,
  questionContext?: string,
): string {
  const parts = [
    `## Question from Coder`,
    question,
  ];

  if (questionContext) {
    parts.push("", `## Additional Context`, questionContext);
  }

  parts.push(
    "",
    `## Task Context`,
    taskContext,
    "",
    `## Project Memory`,
    memoryDigest,
    "",
    `## Instructions`,
    `Answer the Coder's question. If you cannot answer confidently, escalate.`,
  );

  return parts.join("\n");
}

/**
 * Parse an Answerer response to detect escalation.
 */
export function parseAnswererResponse(
  text: string,
): { answer: string; escalation: null } | { answer: null; escalation: { question: string; context: string } } {
  const escalateMatch = text.match(/^ESCALATE:\s*(.+)/m);
  const contextMatch = text.match(/^CONTEXT:\s*(.+)/m);

  if (escalateMatch) {
    return {
      answer: null,
      escalation: {
        question: escalateMatch[1].trim(),
        context: contextMatch ? contextMatch[1].trim() : "No additional context provided.",
      },
    };
  }

  return { answer: text.trim(), escalation: null };
}
