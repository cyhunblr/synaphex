import type { AgentName } from "./agent.js";

export const BEHAVIOR_AGENT_NAMES = [
  "researcher",
  "coder",
  "reviewer",
] as const;

export type BehaviorAgentName = (typeof BEHAVIOR_AGENT_NAMES)[number];

export const DEFAULT_AGENT_BEHAVIOR_FIELDS = Object.freeze({
  researcher: Object.freeze([
    "findings",
    "sources",
    "evidence",
    "uncertainties",
    "conflicts",
    "open_questions",
  ]),
  coder: Object.freeze([
    "files_changed",
    "commands_run",
    "tests_run",
    "implementation_decisions",
    "plan_deviations",
    "errors",
    "remaining_concerns",
  ]),
  reviewer: Object.freeze([
    "requirement_compliance",
    "plan_compliance",
    "implementation_quality",
    "validation_results",
    "warnings",
    "recommendations",
    "technical_debt",
  ]),
} satisfies Readonly<Record<BehaviorAgentName, readonly string[]>>);

export interface AgentBehavior {
  readonly outputFields: readonly string[];
}

export type AgentBehaviorState = Readonly<
  Record<BehaviorAgentName, AgentBehavior>
>;

export function isBehaviorAgentName(
  agent: AgentName,
): agent is BehaviorAgentName {
  return (BEHAVIOR_AGENT_NAMES as readonly AgentName[]).includes(agent);
}
