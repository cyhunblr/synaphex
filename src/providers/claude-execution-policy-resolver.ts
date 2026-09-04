import { PROVIDER_CAPABILITY_NAMES } from "../domain/action.js";
import { ProviderExecutionPolicyUnsupportedError } from "../domain/errors.js";
import type { ExecutionPolicy } from "../domain/execution-policy.js";
import { isProviderCapabilityUsable } from "../domain/execution-policy.js";
import { isRuleDecision } from "../domain/rule.js";

export type ClaudeBuiltInTool =
  | "Read"
  | "Glob"
  | "Grep"
  | "Edit"
  | "Write"
  | "Bash"
  | "WebSearch"
  | "WebFetch";

export type ClaudeNetworkMechanism = "disabled" | "hosted_web_tools";

export interface ClaudeSandboxSettings {
  readonly sandbox: {
    readonly enabled: true;
    readonly failIfUnavailable: true;
    readonly allowUnsandboxedCommands: false;
    readonly network: {
      readonly allowedDomains: readonly [];
      readonly strictAllowlist: true;
    };
  };
}

export interface ResolvedClaudeExecutionPolicy {
  readonly tools: readonly ClaudeBuiltInTool[];
  readonly allowedTools: readonly ClaudeBuiltInTool[];
  readonly disallowedTools: readonly string[];
  readonly network: {
    readonly enabled: boolean;
    readonly mechanism: ClaudeNetworkMechanism;
  };
  readonly settings: ClaudeSandboxSettings | null;
}

const READ_ONLY_TOOLS = ["Read", "Glob", "Grep"] as const;
const WRITE_TOOLS = ["Edit", "Write", "Bash"] as const;
const HOSTED_NETWORK_TOOLS = ["WebSearch", "WebFetch"] as const;
const PROVIDER_ORCHESTRATION_DENIES = [
  "mcp__*",
  "Agent",
  "Skill",
  "AskUserQuestion",
] as const;
const GIT_PUSH_DENIES = ["Bash(git push)", "Bash(git push *)"] as const;

export function resolveClaudeExecutionPolicy(
  policy: ExecutionPolicy,
): ResolvedClaudeExecutionPolicy {
  assertProviderCapabilityShape(policy);
  const networkEnabled = isProviderCapabilityUsable(
    policy.providerCapabilities.network,
  );
  const networkTools = networkEnabled ? HOSTED_NETWORK_TOOLS : [];

  if (policy.sourceModification === "read_only") {
    const tools = [...READ_ONLY_TOOLS, ...networkTools];
    return resolvedPolicy(
      tools,
      networkEnabled,
      [
        ...PROVIDER_ORCHESTRATION_DENIES,
        "Edit",
        "Write",
        "Bash",
        ...(networkEnabled ? [] : HOSTED_NETWORK_TOOLS),
        ...GIT_PUSH_DENIES,
      ],
      null,
    );
  }

  if (policy.sourceModification === "workspace_write") {
    const tools = [...READ_ONLY_TOOLS, ...WRITE_TOOLS, ...networkTools];
    return resolvedPolicy(
      tools,
      networkEnabled,
      [
        ...PROVIDER_ORCHESTRATION_DENIES,
        ...(networkEnabled ? [] : HOSTED_NETWORK_TOOLS),
        ...GIT_PUSH_DENIES,
      ],
      workspaceSandboxSettings(),
    );
  }

  throw new ProviderExecutionPolicyUnsupportedError(
    "anthropic",
    "invalid_source_modification_policy",
  );
}

function resolvedPolicy(
  tools: readonly ClaudeBuiltInTool[],
  networkEnabled: boolean,
  disallowedTools: readonly string[],
  settings: ClaudeSandboxSettings | null,
): ResolvedClaudeExecutionPolicy {
  const frozenTools = Object.freeze([...tools]);
  return Object.freeze({
    tools: frozenTools,
    allowedTools: frozenTools,
    disallowedTools: Object.freeze([...disallowedTools]),
    network: Object.freeze({
      enabled: networkEnabled,
      mechanism: networkEnabled ? "hosted_web_tools" : "disabled",
    }),
    settings,
  });
}

function workspaceSandboxSettings(): ClaudeSandboxSettings {
  return Object.freeze({
    sandbox: Object.freeze({
      enabled: true as const,
      failIfUnavailable: true as const,
      allowUnsandboxedCommands: false as const,
      network: Object.freeze({
        allowedDomains: Object.freeze([]) as readonly [],
        strictAllowlist: true as const,
      }),
    }),
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
      "anthropic",
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
    "anthropic",
    "provider_capability_policy_malformed",
    "network",
  );
}
