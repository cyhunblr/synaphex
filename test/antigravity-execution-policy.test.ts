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

// Antigravity 1.1.26 exposes no invocation-scoped policy mechanism: every
// relevant control (tool execution policy, file access, internet access,
// permission grants, sandbox mode) is a persistent provider-owned setting that
// Synaphex must not mutate or inspect. Synaphex therefore fails closed for
// every ExecutionPolicy rather than presenting `--mode`/`--sandbox` as an
// enforcement boundary they are not. See docs/architecture/0001-google-cli-runtime.md.

test("Antigravity refuses read_only because the immutable source contract is not enforceable", () => {
  for (const networkPolicy of [network("deny", false), network("ask", false)]) {
    assert.throws(
      () => resolveAntigravityExecutionPolicy(policy("read_only", networkPolicy)),
      (error: unknown) =>
        error instanceof ProviderExecutionPolicyUnsupportedError &&
        error.details?.provider === "google" &&
        error.details?.reason ===
          "read_only_not_enforceable_without_invocation_scoped_policy",
    );
  }
});

test("Antigravity refuses workspace_write because persistent grants can widen execution", () => {
  assert.throws(
    () =>
      new AntigravityExecutionPolicyResolver().resolve(
        policy("workspace_write", network("deny", false)),
      ),
    (error: unknown) =>
      error instanceof ProviderExecutionPolicyUnsupportedError &&
      error.details?.provider === "google" &&
      error.details?.reason ===
        "workspace_write_not_enforceable_without_invocation_scoped_policy",
  );
});

test("Antigravity never resolves a usable execution policy for any combination", () => {
  for (const sourceModification of [
    "read_only",
    "workspace_write",
  ] satisfies SourceModificationPolicy[]) {
    for (const networkPolicy of [
      network("deny", false),
      network("ask", false),
      network("ask", true),
      network("allow", false),
      network("allow", true),
    ]) {
      assert.throws(
        () =>
          resolveAntigravityExecutionPolicy(
            policy(sourceModification, networkPolicy),
          ),
        ProviderExecutionPolicyUnsupportedError,
        `${sourceModification} + ${networkPolicy.decision}/${networkPolicy.approvedForInvocation} must fail closed`,
      );
    }
  }
});

test("Antigravity fails closed on network before any source-modification decision", () => {
  // Network is refused first so an enabled network capability can never be
  // masked by a source-modification reason.
  for (const networkPolicy of [network("allow", false), network("ask", true)]) {
    for (const sourceModification of [
      "read_only",
      "workspace_write",
    ] satisfies SourceModificationPolicy[]) {
      assert.throws(
        () =>
          resolveAntigravityExecutionPolicy(
            policy(sourceModification, networkPolicy),
          ),
        (error: unknown) =>
          error instanceof ProviderExecutionPolicyUnsupportedError &&
          error.details?.reason === "network_capability_not_safely_enforceable" &&
          error.details?.action === "network",
      );
    }
  }
});

test("Antigravity rejects malformed and unknown execution policies", () => {
  assert.throws(
    () =>
      resolveAntigravityExecutionPolicy({
        sourceModification: "invalid" as SourceModificationPolicy,
        providerCapabilities: { network: network("deny", false) },
      }),
    (error: unknown) =>
      error instanceof ProviderExecutionPolicyUnsupportedError &&
      error.details?.reason === "invalid_source_modification_policy",
  );
  assert.throws(
    () =>
      resolveAntigravityExecutionPolicy({
        sourceModification: "read_only",
        providerCapabilities: {} as ExecutionPolicy["providerCapabilities"],
      }),
    (error: unknown) =>
      error instanceof ProviderExecutionPolicyUnsupportedError &&
      error.details?.reason === "provider_capability_set_invalid",
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
