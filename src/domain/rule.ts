import type { AgentName } from "./agent.js";

export const RULE_DECISIONS = ["allow", "ask", "deny"] as const;
export type RuleDecision = (typeof RULE_DECISIONS)[number];

export const RULE_SCOPES = ["global", "project", "task"] as const;
export type RuleScope = (typeof RULE_SCOPES)[number];
export type RuleViewScope = RuleScope | "effective";

export const ACTION_NAMES = ["git_push", "network", "ci"] as const;
export type ActionName = (typeof ACTION_NAMES)[number];

export interface AgentCallRuleKey {
  readonly kind: "agent_call";
  readonly caller: AgentName;
  readonly target: AgentName;
}

export interface ActionRuleKey {
  readonly kind: "action";
  readonly action: string;
}

export type RuleKey = AgentCallRuleKey | ActionRuleKey;

export interface ScopedRule {
  readonly key: RuleKey;
  readonly decision: RuleDecision;
}

export type EffectiveRuleSource = RuleScope | "default_deny";

export interface EffectiveRule extends ScopedRule {
  readonly source: EffectiveRuleSource;
}

export function isRuleDecision(value: unknown): value is RuleDecision {
  return value === "allow" || value === "ask" || value === "deny";
}

export function isActionName(value: unknown): value is ActionName {
  return (ACTION_NAMES as readonly unknown[]).includes(value);
}

export function formatRuleKey(key: RuleKey): string {
  return key.kind === "agent_call"
    ? `agent-call.${key.caller}.${key.target}`
    : `action.${key.action}`;
}
