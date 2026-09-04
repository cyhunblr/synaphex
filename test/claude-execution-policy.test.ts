import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExecutionPolicy,
  ProviderCapabilityPolicy,
  SourceModificationPolicy,
} from "../src/domain/execution-policy.js";
import { resolveClaudeExecutionPolicy } from "../src/providers/claude-execution-policy-resolver.js";

const source = { allow: "global", ask: "task", deny: "project" } as const;

test("Claude policy resolver maps the complete tool and network matrix", () => {
  const cases = [
    ["read_only", network("deny", false), readOnly(false)],
    ["read_only", network("ask", false), readOnly(false)],
    ["read_only", network("allow", false), readOnly(true)],
    ["read_only", network("ask", true), readOnly(true)],
    ["workspace_write", network("deny", false), workspaceWrite(false)],
    ["workspace_write", network("ask", false), workspaceWrite(false)],
    ["workspace_write", network("allow", false), workspaceWrite(true)],
    ["workspace_write", network("ask", true), workspaceWrite(true)],
  ] as const;

  for (const [sourceModification, networkPolicy, expected] of cases) {
    assert.deepEqual(
      resolveClaudeExecutionPolicy(
        policy(sourceModification, networkPolicy),
      ),
      expected,
    );
  }
});

test("Claude read-only and provider-orchestration boundaries are fail closed", () => {
  for (const enabled of [false, true]) {
    const resolved = resolveClaudeExecutionPolicy(
      policy("read_only", network(enabled ? "allow" : "deny", false)),
    );
    for (const forbidden of ["Edit", "Write", "Bash"] as const) {
      assert.equal(resolved.tools.includes(forbidden), false);
      assert.ok(resolved.disallowedTools.includes(forbidden));
    }
    for (const forbidden of ["mcp__*", "Agent", "Skill", "AskUserQuestion"])
      assert.ok(resolved.disallowedTools.includes(forbidden));
  }
});

test("Synaphex network enables only Claude hosted web tools and never Bash process network", () => {
  const disabled = resolveClaudeExecutionPolicy(
    policy("workspace_write", network("deny", true)),
  );
  const enabled = resolveClaudeExecutionPolicy(
    policy("workspace_write", network("allow", false)),
  );

  assert.equal(disabled.network.enabled, false);
  assert.equal(disabled.tools.includes("WebSearch"), false);
  assert.equal(disabled.tools.includes("WebFetch"), false);
  assert.ok(disabled.disallowedTools.includes("WebSearch"));
  assert.ok(disabled.disallowedTools.includes("WebFetch"));
  assert.equal(enabled.network.mechanism, "hosted_web_tools");
  assert.deepEqual(
    enabled.tools.filter((tool) => tool.startsWith("Web")),
    ["WebSearch", "WebFetch"],
  );
  assert.deepEqual(enabled.settings, workspaceSettings());
  assert.deepEqual(enabled.settings, disabled.settings);
  assert.deepEqual(enabled.settings?.sandbox.network.allowedDomains, []);
  assert.equal(enabled.settings?.sandbox.network.strictAllowlist, true);
  assert.equal(enabled.settings?.sandbox.allowUnsandboxedCommands, false);
  assert.equal(enabled.settings?.sandbox.failIfUnavailable, true);
});

test("Claude CODER policy carries defense-in-depth git-push denies", () => {
  const resolved = resolveClaudeExecutionPolicy(
    policy("workspace_write", network("allow", false)),
  );
  assert.ok(resolved.disallowedTools.includes("Bash(git push)"));
  assert.ok(resolved.disallowedTools.includes("Bash(git push *)"));
  assert.ok(resolved.tools.includes("Bash"));
});

function network(
  decision: "allow" | "ask" | "deny",
  approvedForInvocation: boolean,
): ProviderCapabilityPolicy {
  return {
    decision,
    source: source[decision],
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

function readOnly(networkEnabled: boolean) {
  const tools = [
    "Read",
    "Glob",
    "Grep",
    ...(networkEnabled ? ["WebSearch", "WebFetch"] : []),
  ];
  return {
    tools,
    allowedTools: tools,
    disallowedTools: [
      "mcp__*",
      "Agent",
      "Skill",
      "AskUserQuestion",
      "Edit",
      "Write",
      "Bash",
      ...(networkEnabled ? [] : ["WebSearch", "WebFetch"]),
      "Bash(git push)",
      "Bash(git push *)",
    ],
    network: {
      enabled: networkEnabled,
      mechanism: networkEnabled ? "hosted_web_tools" : "disabled",
    },
    settings: null,
  };
}

function workspaceWrite(networkEnabled: boolean) {
  const tools = [
    "Read",
    "Glob",
    "Grep",
    "Edit",
    "Write",
    "Bash",
    ...(networkEnabled ? ["WebSearch", "WebFetch"] : []),
  ];
  return {
    tools,
    allowedTools: tools,
    disallowedTools: [
      "mcp__*",
      "Agent",
      "Skill",
      "AskUserQuestion",
      ...(networkEnabled ? [] : ["WebSearch", "WebFetch"]),
      "Bash(git push)",
      "Bash(git push *)",
    ],
    network: {
      enabled: networkEnabled,
      mechanism: networkEnabled ? "hosted_web_tools" : "disabled",
    },
    settings: workspaceSettings(),
  };
}

function workspaceSettings() {
  return {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: [], strictAllowlist: true },
    },
  };
}
