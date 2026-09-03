import { PROVIDER_CAPABILITY_NAMES } from "../domain/action.js";
import { ProviderExecutionPolicyUnsupportedError } from "../domain/errors.js";
import type { ExecutionPolicy } from "../domain/execution-policy.js";
import { isProviderCapabilityUsable } from "../domain/execution-policy.js";
import { isRuleDecision } from "../domain/rule.js";

export type CodexSandbox = "read-only" | "workspace-write";
export type CodexNetworkState = "disabled" | "enabled";
export type CodexPolicyMechanism =
  | "legacy_sandbox"
  | "legacy_workspace_write_override";

export const CODEX_WORKSPACE_WRITE_NETWORK_OVERRIDE =
  "sandbox_workspace_write.network_access=true";

export interface ResolvedCodexExecutionPolicy {
  readonly sandbox: CodexSandbox;
  readonly network: CodexNetworkState;
  readonly mechanism: CodexPolicyMechanism;
  readonly configOverrides: readonly string[];
}

export function resolveCodexExecutionPolicy(
  policy: ExecutionPolicy,
): ResolvedCodexExecutionPolicy {
  assertProviderCapabilityShape(policy);
  const networkEnabled = isProviderCapabilityUsable(
    policy.providerCapabilities.network,
  );

  if (policy.sourceModification === "read_only") {
    if (networkEnabled) {
      throw new ProviderExecutionPolicyUnsupportedError(
        "openai",
        "read_only_network_not_supported",
        "network",
      );
    }
    return Object.freeze({
      sandbox: "read-only",
      network: "disabled",
      mechanism: "legacy_sandbox",
      configOverrides: Object.freeze([]),
    });
  }

  if (policy.sourceModification === "workspace_write") {
    if (networkEnabled) {
      return Object.freeze({
        sandbox: "workspace-write",
        network: "enabled",
        mechanism: "legacy_workspace_write_override",
        configOverrides: Object.freeze([
          CODEX_WORKSPACE_WRITE_NETWORK_OVERRIDE,
        ]),
      });
    }
    return Object.freeze({
      sandbox: "workspace-write",
      network: "disabled",
      mechanism: "legacy_sandbox",
      configOverrides: Object.freeze([]),
    });
  }

  throw new ProviderExecutionPolicyUnsupportedError(
    "openai",
    "invalid_source_modification_policy",
  );
}

export function resolveCodexSandbox(policy: ExecutionPolicy): CodexSandbox {
  return resolveCodexExecutionPolicy(policy).sandbox;
}

function assertProviderCapabilityShape(policy: ExecutionPolicy): void {
  const capabilities = policy?.providerCapabilities as unknown;
  if (capabilities === null || typeof capabilities !== "object") {
    throw malformedCapabilityPolicy();
  }
  const capabilityKeys = Object.keys(capabilities).sort();
  const expectedKeys = [...PROVIDER_CAPABILITY_NAMES].sort();
  if (
    capabilityKeys.length !== expectedKeys.length ||
    capabilityKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new ProviderExecutionPolicyUnsupportedError(
      "openai",
      "provider_capability_set_invalid",
    );
  }

  const network = policy.providerCapabilities.network;
  if (
    network === null ||
    typeof network !== "object" ||
    !isRuleDecision(network.decision) ||
    !["global", "project", "task", "default_deny"].includes(
      network.source,
    ) ||
    typeof network.approvedForInvocation !== "boolean"
  ) {
    throw malformedCapabilityPolicy();
  }
}

function malformedCapabilityPolicy(): ProviderExecutionPolicyUnsupportedError {
  return new ProviderExecutionPolicyUnsupportedError(
    "openai",
    "provider_capability_policy_malformed",
    "network",
  );
}
