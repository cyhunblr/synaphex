import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExecutionPolicy,
  ProviderCapabilityPolicy,
  SourceModificationPolicy,
} from "../src/domain/execution-policy.js";
import {
  CODEX_WEB_SEARCH_DISABLED_OVERRIDE,
  CODEX_WEB_SEARCH_LIVE_OVERRIDE,
  CODEX_WORKSPACE_WRITE_NETWORK_DISABLED_OVERRIDE,
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
      expected: disabledReadOnly(),
    },
    {
      sourceModification: "read_only",
      network: network("ask", false),
      expected: disabledReadOnly(),
    },
    {
      sourceModification: "read_only",
      network: network("allow", false),
      expected: enabledHostedSearch(),
    },
    {
      sourceModification: "read_only",
      network: network("ask", true),
      expected: enabledHostedSearch(),
    },
    {
      sourceModification: "workspace_write",
      network: network("deny", false),
      expected: disabledWorkspaceWrite(),
    },
    {
      sourceModification: "workspace_write",
      network: network("ask", false),
      expected: disabledWorkspaceWrite(),
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

test("explicit deny overrides cannot be widened by defaults or approval state", () => {
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
    disabledWorkspaceWrite(),
  );
  assert.deepEqual(
    resolveCodexExecutionPolicy(
      policy("workspace_write", network("deny", true)),
    ),
    disabledWorkspaceWrite(),
  );
  const readOnlyDeny = resolveCodexExecutionPolicy(
    policy("read_only", network("deny", true)),
  );
  assert.deepEqual(readOnlyDeny, disabledReadOnly());
  assert.deepEqual(readOnlyDeny.configOverrides, [
    CODEX_WEB_SEARCH_DISABLED_OVERRIDE,
  ]);
});

test("Synaphex network capability must not grant Codex local process network", () => {
  for (const sourceModification of [
    "read_only",
    "workspace_write",
  ] as const) {
    for (const networkPolicy of [
      network("allow", false),
      network("ask", true),
    ]) {
      const resolved = resolveCodexExecutionPolicy(
        policy(sourceModification, networkPolicy),
      );
      assert.equal(
        resolved.configOverrides.includes(
          "sandbox_workspace_write.network_access=true",
        ),
        false,
      );
      if (sourceModification === "workspace_write") {
        assert.deepEqual(resolved.configOverrides, [
          CODEX_WORKSPACE_WRITE_NETWORK_DISABLED_OVERRIDE,
          CODEX_WEB_SEARCH_LIVE_OVERRIDE,
        ]);
      }
    }
  }
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

function disabledReadOnly() {
  return {
    sandbox: "read-only",
    network: { enabled: false, mechanism: "disabled" },
    configOverrides: [CODEX_WEB_SEARCH_DISABLED_OVERRIDE],
  } as const;
}

function enabledHostedSearch() {
  return {
    sandbox: "read-only",
    network: { enabled: true, mechanism: "hosted_web_search" },
    configOverrides: [CODEX_WEB_SEARCH_LIVE_OVERRIDE],
  } as const;
}

function disabledWorkspaceWrite() {
  return {
    sandbox: "workspace-write",
    network: { enabled: false, mechanism: "disabled" },
    configOverrides: [
      CODEX_WORKSPACE_WRITE_NETWORK_DISABLED_OVERRIDE,
      CODEX_WEB_SEARCH_DISABLED_OVERRIDE,
    ],
  } as const;
}

function enabledWorkspaceWrite() {
  return {
    sandbox: "workspace-write",
    network: { enabled: true, mechanism: "hosted_web_search" },
    configOverrides: [
      CODEX_WORKSPACE_WRITE_NETWORK_DISABLED_OVERRIDE,
      CODEX_WEB_SEARCH_LIVE_OVERRIDE,
    ],
  } as const;
}
