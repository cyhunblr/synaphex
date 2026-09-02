export const AGENT_NAMES = [
  "questioner",
  "researcher",
  "examiner",
  "planner",
  "coder",
  "reviewer",
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

export function isAgentName(value: unknown): value is AgentName {
  return (
    typeof value === "string" &&
    (AGENT_NAMES as readonly string[]).includes(value)
  );
}
