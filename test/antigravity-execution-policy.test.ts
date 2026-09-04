import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExecutionPolicy,
  ProviderCapabilityPolicy,
  SourceModificationPolicy,
} from "../src/domain/execution-policy.js";
import { ProviderExecutionPolicyUnsupportedError } from "../src/domain/errors.js";
import {
  AntigravityExecutionPolicyResolver,
  resolveAntigravityExecutionPolicy,
} from "../src/providers/antigravity-execution-policy-resolver.js";

test("Antigravity maps read-only and workspace-write to mandatory sandbox modes", () => {
  assert.deepEqual(
    resolveAntigravityExecutionPolicy(policy("read_only", network("deny", false))),
    {
      mode: "plan",
      sandbox: true,
      network: { enabled: false, mechanism: "unsupported" },
    },
  );
  assert.deepEqual(
    new AntigravityExecutionPolicyResolver().resolve(
      policy("workspace_write", network("ask", false)),
    ),
    {
      mode: "accept-edits",
      sandbox: true,
      network: { enabled: false, mechanism: "unsupported" },
    },
  );
});

test("Antigravity fails closed for every usable network policy", () => {
  for (const networkPolicy of [network("allow", false), network("ask", true)]) {
    assert.throws(
      () => resolveAntigravityExecutionPolicy(policy("read_only", networkPolicy)),
      (error: unknown) =>
        error instanceof ProviderExecutionPolicyUnsupportedError &&
        error.details?.reason === "network_capability_not_safely_enforceable" &&
        error.details?.action === "network",
    );
  }
});

test("Antigravity rejects malformed and unknown execution policies", () => {
  assert.throws(() =>
    resolveAntigravityExecutionPolicy({
      sourceModification: "invalid" as SourceModificationPolicy,
      providerCapabilities: { network: network("deny", false) },
    }),
  );
  assert.throws(() =>
    resolveAntigravityExecutionPolicy({
      sourceModification: "read_only",
      providerCapabilities: {} as ExecutionPolicy["providerCapabilities"],
    }),
  );
});

function network(
  decision: "allow" | "ask" | "deny",
  approvedForInvocation: boolean,
): ProviderCapabilityPolicy {
  return {
    decision,
    source: decision === "deny" ? "default_deny" : "task",
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
