import { PROVIDER_CAPABILITY_NAMES } from "../domain/action.js";
import { ProviderExecutionPolicyUnsupportedError } from "../domain/errors.js";
import type { ExecutionPolicy } from "../domain/execution-policy.js";
import { isProviderCapabilityUsable } from "../domain/execution-policy.js";
import { isRuleDecision } from "../domain/rule.js";

/**
 * Antigravity CLI agent execution mode (`--mode`).
 *
 * SECURITY CLASSIFICATION: behavioral guard only.
 *
 * Verified against the installed runtime (`agy 1.1.26`):
 *
 * - `agy --help` documents `--mode` as "Set the agent execution mode for this
 *   session (accept-edits, plan)". The shipped mode descriptions are
 *   `'default': standard behavior. 'accept-edits': auto-approve file edits,
 *   prompt for commands. 'plan': research and plan without making changes`.
 *   Those describe agent behavior, not a permission boundary.
 * - `plan` is surfaced interactively as "Plan mode: research & plan only",
 *   i.e. an instruction to the agent about how to work.
 * - Tool authorization is evaluated separately, against persistent permission
 *   grants (`permissions.allow` / `ask` / `deny` and `toolPermission` in
 *   `~/.gemini/antigravity-cli/settings.json`) whose rule grammar is
 *   `^(command|read_file|write_file|read_url|mcp|execute_url|unsandboxed)\s*\(.*\)$`.
 *   Because `write_file(...)` is an ordinary grant, a persistent allow rule can
 *   authorize a write irrespective of `--mode`.
 *
 * `--mode` is therefore defense-in-depth only. It MUST NOT be treated as the
 * source-modification enforcement boundary.
 */
export type AntigravityExecutionMode = "plan" | "accept-edits";

/**
 * Why every Antigravity ExecutionPolicy combination is currently refused.
 *
 * Antigravity 1.1.26 exposes no invocation-scoped policy mechanism: the full
 * flag surface is fixed (the Go `flag` parser rejects everything absent from
 * `--help`), and every relevant control -- tool execution policy
 * (`always-proceed` / `request-review` / `strict` / `proceed-in-sandbox`),
 * non-workspace file access, internet access policy, permission grants,
 * command allow/denylist and sandbox mode -- is a persistent global or
 * project-level setting, outside Synaphex's invocation.
 *
 * Synaphex must not mutate or inspect those provider-owned settings, so it
 * cannot establish the immutable source-modification contract, command denial,
 * MCP denial or network denial for a single `agy` invocation. Synaphex fails
 * closed rather than presenting a provider limitation as a guarantee.
 */
export type AntigravityUnsupportedPolicyReason =
  | "read_only_not_enforceable_without_invocation_scoped_policy"
  | "workspace_write_not_enforceable_without_invocation_scoped_policy"
  | "network_capability_not_safely_enforceable";

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
      throw unsupported("network_capability_not_safely_enforceable", "network");
    }
    if (policy.sourceModification === "read_only") {
      // `--mode plan` plus `--sandbox` are behavioral/defence-in-depth only.
      // Neither denies `command(...)`, `mcp(...)`, `read_url(...)` or
      // `write_file(...)` when a persistent grant allows them, so the
      // immutable read-only contract cannot be enforced. Fail closed.
      throw unsupported(
        "read_only_not_enforceable_without_invocation_scoped_policy",
      );
    }
    if (policy.sourceModification === "workspace_write") {
      // `--mode accept-edits` auto-approves file edits but leaves command,
      // MCP and URL authorization to persistent grants. Those could silently
      // authorize execution paths that bypass Synaphex's `git_push` and `ci`
      // host actions and its separately controlled `network` capability.
      throw unsupported(
        "workspace_write_not_enforceable_without_invocation_scoped_policy",
      );
    }
    throw unsupported("invalid_source_modification_policy");
  }
}

export function resolveAntigravityExecutionPolicy(
  policy: ExecutionPolicy,
): ResolvedAntigravityExecutionPolicy {
  return new AntigravityExecutionPolicyResolver().resolve(policy);
}

function unsupported(
  reason: AntigravityUnsupportedPolicyReason | "invalid_source_modification_policy",
  action?: "network",
): ProviderExecutionPolicyUnsupportedError {
  return new ProviderExecutionPolicyUnsupportedError("google", reason, action);
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
