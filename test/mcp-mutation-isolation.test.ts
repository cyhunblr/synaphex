import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  SYNAPHEX_MCP_PHASE1_TOOLS,
  SYNAPHEX_MCP_RECOVERY_TOOLS,
  SYNAPHEX_MCP_SESSION_TOOLS,
} from "../src/mcp/create-synaphex-mcp-server.js";
import { connectedClient, fakeReadDependencies } from "./fixtures/mcp-read-fixtures.js";

const MCP_DIRECTORY = join(process.cwd(), "src", "mcp");

async function mcpSources(): Promise<readonly [string, string][]> {
  const names = (await readdir(MCP_DIRECTORY)).filter((n) => n.endsWith(".ts"));
  return Promise.all(
    names.map(
      async (name) =>
        [name, await readFile(join(MCP_DIRECTORY, name), "utf8")] as [string, string],
    ),
  );
}

function stripComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/.*$/gm, "");
}

test("MCP never imports a broad mutation, invocation or provider module", async () => {
  for (const [name, source] of await mcpSources()) {
    const code = stripComments(source);
    const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
    for (const specifier of imports) {
      // Provider executors are forbidden outright: MCP operates over
      // provider-independent Synaphex services.
      assert.equal(
        /providers\//.test(specifier),
        false,
        `${name} must not import a provider module (${specifier})`,
      );
      // Only the narrow session-command boundary may come from operations/;
      // the mixed read/write operations surface stays out.
      if (specifier.includes("operations/")) {
        assert.equal(
          specifier.endsWith("session-commands.js"),
          true,
          `${name} may only import operations/session-commands (${specifier})`,
        );
      }
      for (const forbiddenModule of [
        "agent-invocation-service",
        "plan-manager",
        "memory-manager",
        "artifact-manager",
        "result-processor",
        "agent-behavior-manager",
        "provider-router",
        "process-runner",
      ]) {
        assert.equal(
          specifier.includes(forbiddenModule),
          false,
          `${name} must not import ${forbiddenModule} (${specifier})`,
        );
      }
    }
  }
});

test("MCP never names a mutation, approval or host-action API directly", async () => {
  for (const [name, source] of await mcpSources()) {
    const code = stripComments(source);
    for (const forbidden of [
      // project/task mutation
      ".create(",
      ".markCompleted(",
      ".archive(",
      ".bindProject(",
      ".bindTask(",
      ".unbindTask(",
      ".unbindProject(",
      // rule/plan/memory/artifact mutation
      ".setRule(",
      ".removeRule(",
      ".setConfigured(",
      ".markUnconfigured(",
      ".removeProvider(",
      ".acceptPlan(",
      ".writeJson(",
      ".writeText(",
      ".removeFile(",
      // invocation, approvals, host actions
      "AgentInvocationService",
      "approveAction",
      "git_push",
      "executeHostAction",
      // shell / network primitives
      "child_process",
      "spawn(",
      "node:http",
      "fetch(",
    ]) {
      assert.equal(
        code.includes(forbidden),
        false,
        `${name} must not reference ${forbidden}`,
      );
    }
  }
});

test("the read ports expose read-only methods only", async () => {
  const source = stripComments(
    await readFile(join(MCP_DIRECTORY, "synaphex-read-ports.ts"), "utf8"),
  );
  const methods = [...source.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*)\s*\(/gm)].map(
    (match) => match[1]!,
  );
  assert.ok(methods.length > 0, "expected port methods");
  for (const method of methods) {
    assert.match(
      method,
      /^(get|find|list|read)/,
      `port method ${method} must be a read operation`,
    );
  }
});

test("only the two session-lifecycle commands are injected as mutations", async () => {
  const reads = fakeReadDependencies();
  assert.deepEqual(Object.keys(reads.sessionCommands).sort(), [
    "closeTaskSession",
    "openTaskSession",
  ]);
});

test("a handler cannot reach a broader mutation API because none is injected", async () => {
  // The injected dependency object carries exactly the read ports. Anything a
  // mutation would need is absent from the composition, so read-only is a
  // structural property rather than a convention.
  const reads = fakeReadDependencies();
  const injected = reads.ports as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(injected).sort(), [
    "agentConfigReads",
    "effectiveRuleReads",
    "projectReads",
    "sessionReads",
    "taskReads",
  ]);
  for (const [portName, port] of Object.entries(injected)) {
    for (const method of Object.keys(port as object)) {
      assert.match(
        method,
        /^(get|find|list|read)/,
        `${portName}.${method} must be a read operation`,
      );
    }
  }
});

test("the tool surface is exactly reads, session lifecycle and recovery", async () => {
  const { client, close } = await connectedClient();
  try {
    const tools = (await client.listTools()).tools;
    assert.equal(
      tools.length,
      SYNAPHEX_MCP_PHASE1_TOOLS.length +
        SYNAPHEX_MCP_SESSION_TOOLS.length +
        SYNAPHEX_MCP_RECOVERY_TOOLS.length,
    );
    const mutating = tools
      .filter((tool) => tool.annotations?.readOnlyHint !== true)
      .map((tool) => tool.name)
      .sort();
    // Exactly three mutating tools: open, close, and explicit force release.
    assert.deepEqual(mutating, [
      "synaphex_close_task_session",
      "synaphex_force_release_task_session",
      "synaphex_open_task_session",
    ]);
    // No session enumeration tool yet.
    assert.equal(
      tools.some((tool) => /list_sessions|get_current_session/.test(tool.name)),
      false,
    );
  } finally {
    await close();
  }
});

test("Synaphex implements no lease, heartbeat or PID-based session expiry", async () => {
  for (const [name, source] of await mcpSources()) {
    const code = stripComments(source);
    // Word-boundary matched so "release" does not trip the "lease" check.
    for (const forbidden of [
      /\bheartbeat\b/i,
      /\blease\b/i,
      /\bleaseExpiry\b/i,
      /process\.pid/,
      /\bstaleAfter\b/i,
      /\bttlMs\b/i,
      /\bsetInterval\b/,
    ]) {
      assert.equal(
        forbidden.test(code),
        false,
        `${name} must not implement ${forbidden.source}`,
      );
    }
  }
  const sessionCommands = stripComments(
    await readFile(
      join(process.cwd(), "src", "operations", "session-commands.ts"),
      "utf8",
    ),
  );
  for (const forbidden of [
    /\bheartbeat\b/i,
    /\blease\b/i,
    /process\.pid/,
    /\bsetInterval\b/,
    /\bstaleAfter\b/i,
  ]) {
    assert.equal(
      forbidden.test(sessionCommands),
      false,
      `session-commands must not implement ${forbidden.source}`,
    );
  }
});
