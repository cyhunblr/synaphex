import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExecutionPolicy,
  ProviderCapabilityPolicy,
  SourceModificationPolicy,
} from "../src/domain/execution-policy.js";
import {
  GEMINI_BROAD_DENY_PRIORITY,
  GEMINI_MCP_DENY_PRIORITY,
  GEMINI_SELECTED_ALLOW_PRIORITY,
  resolveGeminiExecutionPolicy,
  serializeGeminiPolicy,
} from "../src/providers/gemini-execution-policy-resolver.js";

const readTools = [
  "read_file",
  "read_many_files",
  "list_directory",
  "glob",
  "grep_search",
] as const;

test("Gemini policy resolver maps the exact four-case tool matrix", () => {
  const cases = [
    ["read_only", network("deny", false), [...readTools]],
    ["read_only", network("ask", false), [...readTools]],
    ["read_only", network("allow", false), [...readTools, "google_web_search"]],
    ["read_only", network("ask", true), [...readTools, "google_web_search"]],
    ["workspace_write", network("deny", false), [...readTools, "write_file", "replace"]],
    ["workspace_write", network("ask", false), [...readTools, "write_file", "replace"]],
    ["workspace_write", network("allow", false), [...readTools, "write_file", "replace", "google_web_search"]],
    ["workspace_write", network("ask", true), [...readTools, "write_file", "replace", "google_web_search"]],
  ] as const;

  for (const [sourceModification, networkPolicy, tools] of cases) {
    const resolved = resolveGeminiExecutionPolicy(
      policy(sourceModification, networkPolicy),
    );
    assert.deepEqual(resolved.tools, tools);
    assert.equal(
      resolved.network.enabled,
      (tools as readonly string[]).includes("google_web_search"),
    );
  }
});

test("Gemini generated policy is fail closed with documented priority ordering", () => {
  const resolved = resolveGeminiExecutionPolicy(
    policy("workspace_write", network("allow", false)),
  );
  const output = serializeGeminiPolicy(resolved);

  assert.equal(GEMINI_BROAD_DENY_PRIORITY, 998);
  assert.equal(GEMINI_SELECTED_ALLOW_PRIORITY, 999);
  assert.equal(GEMINI_MCP_DENY_PRIORITY, 999);
  assert.match(output, /toolName = "\*"\ndecision = "deny"\npriority = 998/);
  for (const tool of resolved.tools) {
    assert.match(
      output,
      new RegExp(`toolName = "${tool}"\\ndecision = "allow"\\npriority = 999`),
    );
  }
  assert.match(
    output,
    /toolName = "\*"\nmcpName = "\*"\ndecision = "deny"\npriority = 999/,
  );
  assert.match(output, /replaces user-tier policy paths/);
  assert.match(output, /administrator policy remains a higher authority/);
});

test("Gemini policy never exposes shell, URL fetch, orchestration, or MCP tools", () => {
  for (const sourceModification of ["read_only", "workspace_write"] as const) {
    for (const enabled of [false, true]) {
      const resolved = resolveGeminiExecutionPolicy(
        policy(sourceModification, network(enabled ? "allow" : "deny", false)),
      );
      for (const forbidden of [
        "run_shell_command",
        "web_fetch",
        "ask_user",
        "activate_skill",
        "write_todos",
        "enter_plan_mode",
        "exit_plan_mode",
        "subagent",
        "browser",
        "mcp__tool",
      ]) {
        assert.equal(resolved.tools.includes(forbidden as never), false);
      }
      if (sourceModification === "read_only") {
        assert.equal(resolved.tools.includes("write_file"), false);
        assert.equal(resolved.tools.includes("replace"), false);
      }
    }
  }
});

test("Gemini policy rejects malformed capability and source-modification state", () => {
  assert.throws(() =>
    resolveGeminiExecutionPolicy({
      sourceModification: "invalid" as SourceModificationPolicy,
      providerCapabilities: { network: network("deny", false) },
    }),
  );
  assert.throws(() =>
    resolveGeminiExecutionPolicy({
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
