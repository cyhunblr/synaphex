import { PROVIDER_CAPABILITY_NAMES } from "../domain/action.js";
import { ProviderExecutionPolicyUnsupportedError } from "../domain/errors.js";
import type { ExecutionPolicy } from "../domain/execution-policy.js";
import { isProviderCapabilityUsable } from "../domain/execution-policy.js";
import { isRuleDecision } from "../domain/rule.js";

export type CodexSandbox = "read-only" | "workspace-write";
export type CodexNetworkState = "disabled" | "enabled";
export type CodexNetworkMechanism =
  | "disabled"
  | "hosted_web_search";
export type CodexPolicyMechanism = CodexNetworkMechanism;

export const CODEX_WORKSPACE_WRITE_NETWORK_DISABLED_OVERRIDE =
  "sandbox_workspace_write.network_access=false";
export const CODEX_WEB_SEARCH_LIVE_OVERRIDE = 'web_search="live"';
export const CODEX_WEB_SEARCH_DISABLED_OVERRIDE = 'web_search="disabled"';

export interface ResolvedCodexNetworkPolicy {
  readonly enabled: boolean;
  readonly mechanism: CodexNetworkMechanism;
}

export interface ResolvedCodexExecutionPolicy {
  readonly sandbox: CodexSandbox;
  readonly network: ResolvedCodexNetworkPolicy;
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
      return resolvedPolicy(
        "read-only",
        true,
        "hosted_web_search",
        [CODEX_WEB_SEARCH_LIVE_OVERRIDE],
      );
    }
    return resolvedPolicy("read-only", false, "disabled", [
      CODEX_WEB_SEARCH_DISABLED_OVERRIDE,
    ]);
  }

  if (policy.sourceModification === "workspace_write") {
    if (networkEnabled) {
      return resolvedPolicy(
        "workspace-write",
        true,
        "hosted_web_search",
        [
          CODEX_WORKSPACE_WRITE_NETWORK_DISABLED_OVERRIDE,
          CODEX_WEB_SEARCH_LIVE_OVERRIDE,
        ],
      );
    }
    return resolvedPolicy("workspace-write", false, "disabled", [
      CODEX_WORKSPACE_WRITE_NETWORK_DISABLED_OVERRIDE,
      CODEX_WEB_SEARCH_DISABLED_OVERRIDE,
    ]);
  }

  throw new ProviderExecutionPolicyUnsupportedError(
    "openai",
    "invalid_source_modification_policy",
  );
}

export function resolveCodexSandbox(policy: ExecutionPolicy): CodexSandbox {
  return resolveCodexExecutionPolicy(policy).sandbox;
}

function resolvedPolicy(
  sandbox: CodexSandbox,
  enabled: boolean,
  mechanism: CodexNetworkMechanism,
  configOverrides: readonly string[],
): ResolvedCodexExecutionPolicy {
  return Object.freeze({
    sandbox,
    network: Object.freeze({ enabled, mechanism }),
    configOverrides: Object.freeze([...configOverrides]),
  });
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
