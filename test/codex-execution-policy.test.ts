import assert from "node:assert/strict";
import test from "node:test";
import { ProviderExecutionPolicyUnsupportedError } from "../src/domain/errors.js";
import type {
  ExecutionPolicy,
  ProviderCapabilityPolicy,
  SourceModificationPolicy,
} from "../src/domain/execution-policy.js";
import {
  CODEX_WORKSPACE_WRITE_NETWORK_OVERRIDE,
  resolveCodexExecutionPolicy,
} from "../src/providers/codex-execution-policy-resolver.js";

const ruleSources = {
  allow: "global",
  ask: "project",
  deny: "task",
} as const;

test("Codex policy resolver maps the safe network capability matrix", () => {
  const cases = [
    {
      sourceModification: "read_only",
      network: network("deny", false),
      expected: disabled("read-only"),
    },
    {
      sourceModification: "read_only",
      network: network("ask", false),
      expected: disabled("read-only"),
    },
    {
      sourceModification: "workspace_write",
      network: network("deny", false),
      expected: disabled("workspace-write"),
    },
    {
      sourceModification: "workspace_write",
      network: network("ask", false),
      expected: disabled("workspace-write"),
    },
    {
      sourceModification: "workspace_write",
      network: network("allow", false),
      expected: enabledWorkspaceWrite(),
    },
    {
      sourceModification: "workspace_write",
      network: network("ask", true),
      expected: enabledWorkspaceWrite(),
    },
  ] as const;

  for (const scenario of cases) {
    assert.deepEqual(
      resolveCodexExecutionPolicy(
        policy(scenario.sourceModification, scenario.network),
      ),
      scenario.expected,
    );
  }
});

test("read-only enabled network is rejected with a stable safe reason", () => {
  for (const networkPolicy of [
    network("allow", false),
    network("ask", true),
  ]) {
    assert.throws(
      () =>
        resolveCodexExecutionPolicy(policy("read_only", networkPolicy)),
      (error: unknown) =>
        error instanceof ProviderExecutionPolicyUnsupportedError &&
        error.code === "PROVIDER_EXECUTION_POLICY_UNSUPPORTED" &&
        error.details?.reason === "read_only_network_not_supported" &&
        error.details.action === "network",
    );
  }
});

test("default deny and a stray approval flag cannot enable network", () => {
  assert.deepEqual(
    resolveCodexExecutionPolicy({
      sourceModification: "workspace_write",
      providerCapabilities: {
        network: {
          decision: "deny",
          source: "default_deny",
          approvedForInvocation: false,
        },
      },
    }),
    disabled("workspace-write"),
  );
  assert.deepEqual(
    resolveCodexExecutionPolicy(
      policy("workspace_write", network("deny", true)),
    ),
    disabled("workspace-write"),
  );
});

function network(
  decision: "allow" | "ask" | "deny",
  approvedForInvocation: boolean,
): ProviderCapabilityPolicy {
  return {
    decision,
    source: ruleSources[decision],
    approvedForInvocation,
  };
}

function policy(
  sourceModification: SourceModificationPolicy,
  networkPolicy: ProviderCapabilityPolicy,
): ExecutionPolicy {
  return {
    sourceModification,
    providerCapabilities: { network: networkPolicy },
  };
}

function disabled(sandbox: "read-only" | "workspace-write") {
  return {
    sandbox,
    network: "disabled",
    mechanism: "legacy_sandbox",
    configOverrides: [],
  } as const;
}

function enabledWorkspaceWrite() {
  return {
    sandbox: "workspace-write",
    network: "enabled",
    mechanism: "legacy_workspace_write_override",
    configOverrides: [CODEX_WORKSPACE_WRITE_NETWORK_OVERRIDE],
  } as const;
}
