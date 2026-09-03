import type { RoleContractSnapshot } from "./agent-context.js";
import type {
  ActionName,
  EffectiveRuleSource,
  RuleDecision,
} from "./rule.js";

export const SOURCE_MODIFICATION_POLICIES = [
  "read_only",
  "workspace_write",
] as const;

export type SourceModificationPolicy =
  (typeof SOURCE_MODIFICATION_POLICIES)[number];

export interface ExecutionActionPolicy {
  readonly decision: RuleDecision;
  readonly source: EffectiveRuleSource;
  readonly approvedForInvocation: boolean;
}

export interface ExecutionPolicy {
  readonly sourceModification: SourceModificationPolicy;
  readonly actions: Readonly<Record<ActionName, ExecutionActionPolicy>>;
}

export function sourceModificationPolicy(
  contract: RoleContractSnapshot,
): SourceModificationPolicy {
  return contract.mayModifySourceCode ? "workspace_write" : "read_only";
}

export function isActionUsable(policy: ExecutionActionPolicy): boolean {
  return (
    policy.decision === "allow" ||
    (policy.decision === "ask" && policy.approvedForInvocation)
  );
}
