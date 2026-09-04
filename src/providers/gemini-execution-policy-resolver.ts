import { PROVIDER_CAPABILITY_NAMES } from "../domain/action.js";
import { ProviderExecutionPolicyUnsupportedError } from "../domain/errors.js";
import type { ExecutionPolicy } from "../domain/execution-policy.js";
import { isProviderCapabilityUsable } from "../domain/execution-policy.js";
import { isRuleDecision } from "../domain/rule.js";

export type GeminiBuiltInTool =
  | "read_file"
  | "read_many_files"
  | "list_directory"
  | "glob"
  | "grep_search"
  | "write_file"
  | "replace"
  | "google_web_search";

export type GeminiNetworkMechanism = "disabled" | "hosted_web_search";

export interface ResolvedGeminiExecutionPolicy {
  readonly tools: readonly GeminiBuiltInTool[];
  readonly network: {
    readonly enabled: boolean;
    readonly mechanism: GeminiNetworkMechanism;
  };
}

export const GEMINI_READ_ONLY_TOOLS = Object.freeze([
  "read_file",
  "read_many_files",
  "list_directory",
  "glob",
  "grep_search",
] as const);

export const GEMINI_WRITE_TOOLS = Object.freeze([
  "write_file",
  "replace",
] as const);

export const GEMINI_NETWORK_TOOL = "google_web_search" as const;
export const GEMINI_BROAD_DENY_PRIORITY = 998 as const;
export const GEMINI_SELECTED_ALLOW_PRIORITY = 999 as const;
export const GEMINI_MCP_DENY_PRIORITY = 999 as const;

export function resolveGeminiExecutionPolicy(
  policy: ExecutionPolicy,
): ResolvedGeminiExecutionPolicy {
  assertProviderCapabilityShape(policy);
  const networkEnabled = isProviderCapabilityUsable(
    policy.providerCapabilities.network,
  );
  const networkTools = networkEnabled ? [GEMINI_NETWORK_TOOL] : [];

  if (policy.sourceModification === "read_only") {
    return resolvedPolicy([...GEMINI_READ_ONLY_TOOLS, ...networkTools], networkEnabled);
  }
  if (policy.sourceModification === "workspace_write") {
    return resolvedPolicy(
      [...GEMINI_READ_ONLY_TOOLS, ...GEMINI_WRITE_TOOLS, ...networkTools],
      networkEnabled,
    );
  }
  throw new ProviderExecutionPolicyUnsupportedError(
    "google",
    "invalid_source_modification_policy",
  );
}

export function serializeGeminiPolicy(
  policy: ResolvedGeminiExecutionPolicy,
): string {
  const rules = [
    rule(["toolName = \"*\"", "decision = \"deny\"", `priority = ${GEMINI_BROAD_DENY_PRIORITY}`]),
    ...policy.tools.map((tool) =>
      rule([
        `toolName = ${JSON.stringify(tool)}`,
        "decision = \"allow\"",
        `priority = ${GEMINI_SELECTED_ALLOW_PRIORITY}`,
      ]),
    ),
    rule([
      "toolName = \"*\"",
      "mcpName = \"*\"",
      "decision = \"deny\"",
      `priority = ${GEMINI_MCP_DENY_PRIORITY}`,
    ]),
  ];
  return [
    "# Synaphex invocation policy. CLI --policy replaces user-tier policy paths;",
    "# administrator policy remains a higher authority in Gemini CLI.",
    ...rules,
    "",
  ].join("\n");
}

function rule(lines: readonly string[]): string {
  return ["", "[[rule]]", ...lines].join("\n");
}

function resolvedPolicy(
  tools: readonly GeminiBuiltInTool[],
  networkEnabled: boolean,
): ResolvedGeminiExecutionPolicy {
  return Object.freeze({
    tools: Object.freeze([...tools]),
    network: Object.freeze({
      enabled: networkEnabled,
      mechanism: networkEnabled ? "hosted_web_search" : "disabled",
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
