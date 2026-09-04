import { PROVIDER_CAPABILITY_NAMES } from "../domain/action.js";
import { ProviderExecutionPolicyUnsupportedError } from "../domain/errors.js";
import type { ExecutionPolicy } from "../domain/execution-policy.js";
import { isProviderCapabilityUsable } from "../domain/execution-policy.js";
import { isRuleDecision } from "../domain/rule.js";

export type AntigravityExecutionMode = "plan" | "accept-edits";

export interface ResolvedAntigravityExecutionPolicy {
  readonly mode: AntigravityExecutionMode;
  readonly sandbox: true;
  readonly network: {
    readonly enabled: false;
    readonly mechanism: "unsupported";
  };
}

export class AntigravityExecutionPolicyResolver {
  resolve(policy: ExecutionPolicy): ResolvedAntigravityExecutionPolicy {
    assertProviderCapabilityShape(policy);
    if (isProviderCapabilityUsable(policy.providerCapabilities.network)) {
      throw new ProviderExecutionPolicyUnsupportedError(
        "google",
        "network_capability_not_safely_enforceable",
        "network",
      );
    }
    if (policy.sourceModification === "read_only") {
      return resolved("plan");
    }
    if (policy.sourceModification === "workspace_write") {
      return resolved("accept-edits");
    }
    throw new ProviderExecutionPolicyUnsupportedError(
      "google",
      "invalid_source_modification_policy",
    );
  }
}

export function resolveAntigravityExecutionPolicy(
  policy: ExecutionPolicy,
): ResolvedAntigravityExecutionPolicy {
  return new AntigravityExecutionPolicyResolver().resolve(policy);
}

function resolved(
  mode: AntigravityExecutionMode,
): ResolvedAntigravityExecutionPolicy {
  return Object.freeze({
    mode,
    sandbox: true as const,
    network: Object.freeze({
      enabled: false as const,
      mechanism: "unsupported" as const,
    }),
  });
}

function assertProviderCapabilityShape(policy: ExecutionPolicy): void {
  const capabilities = policy?.providerCapabilities as unknown;
  if (capabilities === null || typeof capabilities !== "object") {
    throw malformedCapabilityPolicy();
  }
  const actual = Object.keys(capabilities).sort();
  const expected = [...PROVIDER_CAPABILITY_NAMES].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new ProviderExecutionPolicyUnsupportedError(
      "google",
      "provider_capability_set_invalid",
    );
  }
  const network = policy.providerCapabilities.network;
  if (
    network === null ||
    typeof network !== "object" ||
    !isRuleDecision(network.decision) ||
    !["global", "project", "task", "default_deny"].includes(network.source) ||
    typeof network.approvedForInvocation !== "boolean"
  ) {
    throw malformedCapabilityPolicy();
  }
}

function malformedCapabilityPolicy(): ProviderExecutionPolicyUnsupportedError {
  return new ProviderExecutionPolicyUnsupportedError(
    "google",
    "provider_capability_policy_malformed",
    "network",
  );
}
