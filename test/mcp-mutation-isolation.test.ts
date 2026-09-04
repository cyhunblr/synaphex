import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  SYNAPHEX_MCP_BOOTSTRAP_TOOLS,
  SYNAPHEX_MCP_CONTINUATION_TOOLS,
  SYNAPHEX_MCP_INVOCATION_TOOLS,
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

/**
 * `stdio-main.ts` is the composition root: it is the one module allowed to
 * construct Core services and wire them into narrow ports. Every OTHER mcp
 * module -- in particular anything holding tool handlers -- must stay isolated.
 */
const COMPOSITION_ROOT = "stdio-main.ts";

async function mcpHandlerSources(): Promise<readonly [string, string][]> {
  return (await mcpSources()).filter(([name]) => name !== COMPOSITION_ROOT);
}

function stripComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/.*$/gm, "");
}

test("MCP handler modules never import a broad mutation, invocation or provider module", async () => {
  for (const [name, source] of await mcpHandlerSources()) {
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
      // Only the narrow application ports may come from operations/; the
      // mixed read/write operations surface stays out.
      if (specifier.includes("operations/")) {
        assert.ok(
          specifier.endsWith("session-commands.js") ||
            specifier.endsWith("direct-agent-invocation.js") ||
            specifier.endsWith("invocation-continuation-commands.js") ||
            specifier.endsWith("project-task-commands.js"),
          `${name} may only import narrow operations ports (${specifier})`,
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

test("MCP handler modules never name a mutation, approval or host-action API", async () => {
  for (const [name, source] of await mcpHandlerSources()) {
    const code = stripComments(source);
    // Host actions must never be *invoked*; naming them in a description that
    // explains they cannot be approved is fine.
    for (const forbidden of [
      'action: "git_push"',
      "executeGitPush",
      'action: "ci"',
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
      "InvocationContinuationStore",
      "approveAction",
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
    "closeSession",
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

test("the tool surface is exactly reads, session lifecycle, recovery, invocation and continuation", async () => {
  const { client, close } = await connectedClient();
  try {
    const tools = (await client.listTools()).tools;
    assert.equal(
      tools.length,
      SYNAPHEX_MCP_PHASE1_TOOLS.length +
        SYNAPHEX_MCP_SESSION_TOOLS.length +
        SYNAPHEX_MCP_RECOVERY_TOOLS.length +
        SYNAPHEX_MCP_INVOCATION_TOOLS.length +
        SYNAPHEX_MCP_CONTINUATION_TOOLS.length +
        SYNAPHEX_MCP_BOOTSTRAP_TOOLS.length,
    );
    const mutating = tools
      .filter((tool) => tool.annotations?.readOnlyHint !== true)
      .map((tool) => tool.name)
      .sort();
    // Exactly four mutating tools. No helper-execution, action-approval,
    // cancellation or invocation-status tool exists yet.
    assert.deepEqual(mutating, [
      "synaphex_approve_and_execute_helper",
      "synaphex_approve_network_action",
      "synaphex_close_session",
      "synaphex_continue_allowed_network",
      "synaphex_create_task",
      "synaphex_execute_helper",
      "synaphex_force_release_task_session",
      "synaphex_invoke_agent",
      "synaphex_open_project_session",
      "synaphex_open_task_session",
      "synaphex_register_project",
      "synaphex_resume_caller",
    ]);
    // Host actions, cancellation, status and plan acceptance stay absent:
    // git_push/ci have no real executor, so an approval tool would be
    // meaningless.
    for (const absent of [
      "synaphex_approve_git_push",
      "synaphex_approve_ci",
      "synaphex_execute_host_action",
      "synaphex_abort_invocation",
      "synaphex_get_invocation",
      "synaphex_accept_plan",
    ]) {
      assert.equal(
        tools.some((tool) => tool.name === absent),
        false,
        `${absent} must not exist yet`,
      );
    }
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
  for (const [name, source] of await mcpHandlerSources()) {
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

test("bootstrap commands import no provider and perform no execution", async () => {
  const source = stripComments(
    await readFile(
      join(process.cwd(), "src", "operations", "project-task-commands.ts"),
      "utf8",
    ),
  );
  for (const forbidden of [
    "providers/",
    "CodexCliAgentExecutor",
    "ClaudeCliAgentExecutor",
    "AntigravityCliAgentExecutor",
    "ProviderDispatchingAgentExecutor",
    "AgentInvocationService",
    "invokeUserAgent",
    "ProviderRouter",
    "child_process",
    "spawn(",
    "fetch(",
    // No plan / lifecycle / host-action mutation from bootstrap.
    "acceptDraft",
    "saveDraft",
    "markCompleted",
    ".archive(",
    "executeHostAction",
    'action: "git_push"',
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `project-task-commands must not reference ${forbidden}`,
    );
  }
  // It only reaches the narrow Core operations it genuinely needs.
  assert.ok(source.includes("projects.create"));
  assert.ok(source.includes("tasks.create"));
  assert.ok(source.includes("sessions.bindProject"));
  // A project session must never acquire a task claim.
  assert.equal(source.includes("bindTask"), false);
  assert.equal(source.includes("captureTaskOwnership"), false);
  assert.equal(source.includes("ownershipToken"), false);
});

test("no MCP tool name still implies a task-only session close", async () => {
  // Assembled so this audit does not match its own source text.
  const staleName = ["synaphex_close", "task_session"].join("_");
  const { client, close } = await connectedClient();
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.equal(
      names.includes(staleName),
      false,
      "the misleading task-only close name must be gone",
    );
    assert.ok(names.includes("synaphex_close_session"));
  } finally {
    await close();
  }
  // And no stale name survives in source, docs or tests.
  const { readdir: readDir } = await import("node:fs/promises");
  for (const directory of ["src", "test", "docs"]) {
    const roots = [join(process.cwd(), directory)];
    while (roots.length > 0) {
      const current = roots.pop()!;
      for (const entry of await readDir(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) {
          roots.push(full);
          continue;
        }
        if (!/\.(ts|md)$/.test(entry.name)) {
          continue;
        }
        const contents = await readFile(full, "utf8");
        assert.equal(
          contents.includes(staleName),
          false,
          `${full} still references the stale close name`,
        );
      }
    }
  }
});

test("creating a project, task or session invokes no agent", async () => {
  const reads = fakeReadDependencies();
  const { client, close } = await connectedClient(reads);
  try {
    await client.callTool({
      name: "synaphex_register_project",
      arguments: { name: "N", sourcePath: "/tmp/x" },
    });
    await client.callTool({
      name: "synaphex_create_task",
      arguments: { projectId: "prj_fixture01", description: "d" },
    });
    await client.callTool({
      name: "synaphex_open_project_session",
      arguments: { projectId: "prj_fixture01" },
    });
  } finally {
    await close();
  }
  // Only bootstrap commands ran; no invocation or continuation port was touched.
  assert.deepEqual(
    reads.calls.map((call) => call.port),
    [
      "projectTaskCommands.registerProject",
      "projectTaskCommands.createTask",
      "projectTaskCommands.openProjectSession",
    ],
  );
});
