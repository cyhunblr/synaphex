import type { RoleContractSnapshot } from "./agent-context.js";
import type {
  EffectiveRuleSource,
  RuleDecision,
} from "./rule.js";
import type { ProviderCapabilityName } from "./action.js";

export const SOURCE_MODIFICATION_POLICIES = [
  "read_only",
  "workspace_write",
] as const;

export type SourceModificationPolicy =
  (typeof SOURCE_MODIFICATION_POLICIES)[number];

export interface ProviderCapabilityPolicy {
  readonly decision: RuleDecision;
  readonly source: EffectiveRuleSource;
  readonly approvedForInvocation: boolean;
}

export interface ExecutionPolicy {
  readonly sourceModification: SourceModificationPolicy;
  readonly providerCapabilities: Readonly<
    Record<ProviderCapabilityName, ProviderCapabilityPolicy>
  >;
}

export type ExecutionActionPolicy = ProviderCapabilityPolicy;

export function sourceModificationPolicy(
  contract: RoleContractSnapshot,
): SourceModificationPolicy {
  return contract.mayModifySourceCode ? "workspace_write" : "read_only";
}

export function isProviderCapabilityUsable(
  policy: ProviderCapabilityPolicy,
): boolean {
  return (
    policy.decision === "allow" ||
    (policy.decision === "ask" && policy.approvedForInvocation)
  );
}

export const isActionUsable = isProviderCapabilityUsable;
