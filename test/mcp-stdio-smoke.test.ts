import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { AgentConfigManager } from "../src/core/agent-config-manager.js";
import { ProjectManager } from "../src/core/project-manager.js";
import { RuleResolver } from "../src/core/rule-resolver.js";
import { TaskManager } from "../src/core/task-manager.js";
import { StateStore } from "../src/infrastructure/state-store.js";

/**
 * Real stdio MCP protocol smoke test.
 *
 * A genuine child process is launched and driven with the official MCP client
 * SDK over stdio -- no hand-rolled JSON-RPC framing. The environment is a
 * controlled temporary Synaphex state root, and the test requires no Codex,
 * Claude, Antigravity runtime, network or authentication.
 */

const ENTRYPOINT = join(process.cwd(), ".test-dist", "src", "mcp", "stdio-main.js");

/**
 * Immutable host context supplied at process startup. The server refuses to
 * start without it, and no tool call can override it.
 */
const HOST_ARGS = [
  "--host-provider",
  "anthropic",
  "--host-surface",
  "vscode",
] as const;
const ENTRYPOINT_ARGS = [ENTRYPOINT, ...HOST_ARGS] as const;

async function temporaryStateRoot(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-mcp-stdio-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

/**
 * Builds project + task state directly through Core APIs (never through MCP,
 * which exposes no project/task creation) inside a temporary state root.
 */
async function fixtureProjectAndTask(home: string): Promise<{
  projectId: string;
  taskId: string;
}> {
  const stateRoot = join(home, ".synaphex");
  const sourcePath = join(home, "source");
  await mkdir(sourcePath, { recursive: true });
  const store = new StateStore(stateRoot);
  const projects = new ProjectManager(store, { homeDirectory: home });
  const tasks = new TaskManager(store, projects);
  const project = await projects.create("Stdio Smoke Project", sourcePath);
  const task = await tasks.create(project.id, "Session lifecycle smoke task");
  return { projectId: project.id, taskId: task.id };
}

test("Synaphex MCP serves session lifecycle and cross-process recovery over real stdio", async (t) => {
  const home = await temporaryStateRoot(t);
  const { projectId, taskId } = await fixtureProjectAndTask(home);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [...ENTRYPOINT_ARGS],
    // StateStore defaults to `${homedir()}/.synaphex`, so redirecting HOME
    // keeps the test entirely inside the temporary state root.
    env: { ...process.env, HOME: home },
    stderr: "pipe",
  });
  const client = new Client({ name: "synaphex-stdio-smoke", version: "0.0.0" });

  const stderrChunks: string[] = [];
  let sessionId: string;
  let abandonedSessionId = "";
  try {
    // 1: negotiate MCP.
    await client.connect(transport);
    transport.stderr?.on("data", (chunk: Buffer) =>
      stderrChunks.push(chunk.toString("utf8")),
    );

    const serverInfo = client.getServerVersion();
    assert.equal(serverInfo?.name, "synaphex");
    const packageVersion: string = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8"),
    ).version;
    assert.equal(serverInfo?.version, packageVersion);

    // Record the negotiated protocol revision. Using the v2 SDK does not by
    // itself opt a manually constructed Client/McpServer into the newest wire
    // era, and this slice deliberately does not force it: real Claude/Codex
    // host compatibility is to be tested before changing this.
    // The public `protocolVersion` getter is undefined for a manually
    // constructed Client on this SDK build; the revision is only observable on
    // the protected `_negotiatedProtocolVersion`. Reported, not asserted, so
    // this test does not pin an SDK internal.
    const negotiatedProtocol = (
      client as unknown as {
        protocolVersion?: string;
        _negotiatedProtocolVersion?: string;
      }
    );
    const revision =
      negotiatedProtocol.protocolVersion ??
      negotiatedProtocol._negotiatedProtocolVersion;
    t.diagnostic(`negotiated MCP protocol revision: ${revision}`);
    // What we do assert: this slice did not force the modern wire era.
    assert.notEqual(
      revision,
      "2026-07-28",
      "the modern protocol era must not be adopted without host compatibility testing",
    );

    const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
    assert.deepEqual(tools, [
      "synaphex_accept_plan_draft",
      "synaphex_approve_and_execute_helper",
      "synaphex_approve_network_action",
      "synaphex_close_session",
      "synaphex_continue_allowed_network",
      "synaphex_create_task",
      "synaphex_execute_helper",
      "synaphex_force_release_task_session",
      "synaphex_get_agent_config",
      "synaphex_get_effective_rules",
      "synaphex_get_project",
      "synaphex_get_session",
      "synaphex_get_task",
      "synaphex_get_plan_state",
      "synaphex_get_task_session_owner",
      "synaphex_invoke_agent",
      "synaphex_open_project_session",
      "synaphex_open_task_session",
      "synaphex_register_project",
      "synaphex_reject_plan_draft",
      "synaphex_resume_caller",
    ].sort());

    // CODER must be absent from the invocation enum at the schema level.
    const invokeTool = (await client.listTools()).tools.find(
      (candidate) => candidate.name === "synaphex_invoke_agent",
    );
    const agentEnum = (
      (invokeTool?.inputSchema as {
        properties?: { agent?: { enum?: string[] } };
      })?.properties?.agent?.enum ?? []
    ).slice().sort();
    // Phase 5B: CODER is present because every CODER path is staged.
    assert.deepEqual(agentEnum, [
      "coder",
      "examiner",
      "planner",
      "questioner",
      "researcher",
      "reviewer",
    ]);

    // 3 + 4: open a task session and capture the returned SessionId.
    const opened = await client.callTool({
      name: "synaphex_open_task_session",
      arguments: { projectId, taskId },
    });
    assert.notEqual(opened.isError, true, JSON.stringify(opened.content));
    const openedContent = opened.structuredContent as {
      sessionId: string;
      projectId: string;
      taskId: string;
      bound: boolean;
    };
    assert.equal(openedContent.projectId, projectId);
    assert.equal(openedContent.taskId, taskId);
    assert.equal(openedContent.bound, true);
    assert.match(openedContent.sessionId, /^ses_[0-9a-f]{32}$/);
    sessionId = openedContent.sessionId;

    // 5 + 6: the SessionId round-trips through get_session and shows the binding.
    const looked = await client.callTool({
      name: "synaphex_get_session",
      arguments: { sessionId },
    });
    assert.notEqual(looked.isError, true);
    assert.deepEqual(looked.structuredContent, {
      sessionId,
      bound: true,
      projectId,
      taskId,
    });

    // 3: owner lookup returns the SessionId we just received.
    const owner = await client.callTool({
      name: "synaphex_get_task_session_owner",
      arguments: { projectId, taskId },
    });
    assert.deepEqual(owner.structuredContent, {
      projectId,
      taskId,
      claimed: true,
      sessionId,
    });

    // The one-writable-session-per-task invariant holds over the wire.
    const second = await client.callTool({
      name: "synaphex_open_task_session",
      arguments: { projectId, taskId },
    });
    assert.equal(second.isError, true);
    assert.deepEqual(second.structuredContent, {
      code: "TASK_ALREADY_BOUND",
      message: "Task is already bound to another writable session.",
    });

    // 4: close normally -- a real release is reported.
    const closed = await client.callTool({
      name: "synaphex_close_session",
      arguments: { sessionId },
    });
    assert.notEqual(closed.isError, true);
    assert.deepEqual(closed.structuredContent, {
      sessionId,
      released: true,
      releasedTaskId: taskId,
      bound: false,
    });

    // 5: owner lookup now reports unclaimed.
    const afterCloseOwner = await client.callTool({
      name: "synaphex_get_task_session_owner",
      arguments: { projectId, taskId },
    });
    assert.deepEqual(afterCloseOwner.structuredContent, {
      projectId,
      taskId,
      claimed: false,
      sessionId: null,
    });

    // 6: a fully closed session retains no binding record.
    const afterClose = await client.callTool({
      name: "synaphex_get_session",
      arguments: { sessionId },
    });
    assert.deepEqual(afterClose.structuredContent, {
      sessionId,
      bound: false,
      projectId: null,
      taskId: null,
    });

    // Closing again is a deterministic no-op that claims nothing.
    const closedAgain = await client.callTool({
      name: "synaphex_close_session",
      arguments: { sessionId },
    });
    assert.deepEqual(closedAgain.structuredContent, {
      sessionId,
      released: false,
      releasedTaskId: null,
      bound: false,
    });

    // 7: reopen -- a new SessionId is minted, and this one is deliberately
    // NOT closed, simulating a client that disappears mid-session.
    const reopened = await client.callTool({
      name: "synaphex_open_task_session",
      arguments: { projectId, taskId },
    });
    assert.notEqual(reopened.isError, true);
    abandonedSessionId = (reopened.structuredContent as { sessionId: string })
      .sessionId;
    assert.notEqual(abandonedSessionId, sessionId, "a new session id is minted");

    // 10: no implicit lifecycle mutation -- the task is still active.
    const taskAfter = await client.callTool({
      name: "synaphex_get_task",
      arguments: { projectId, taskId },
    });
    const taskState = taskAfter.structuredContent as {
      status: string;
      completedAt: string | null;
      archivedAt: string | null;
    };
    assert.equal(taskState.status, "active");
    assert.equal(taskState.completedAt, null);
    assert.equal(taskState.archivedAt, null);
  } finally {
    // 8: simulate a lost client -- disconnect WITHOUT closing the session.
    await client.close();
  }

  const stderr = stderrChunks.join("");
  if (stderr !== "") {
    assert.match(stderr, /\[synaphex-mcp\]/);
  }

  // 9: start a completely new MCP process against the same state.
  const recoveryTransport = new StdioClientTransport({
    command: process.execPath,
    args: [...ENTRYPOINT_ARGS],
    env: { ...process.env, HOME: home },
    stderr: "pipe",
  });
  const recoveryClient = new Client({
    name: "synaphex-stdio-recovery",
    version: "0.0.0",
  });
  try {
    await recoveryClient.connect(recoveryTransport);

    // 10: the abandoned owner persisted across process loss. Disconnect is
    // NOT an authoritative unbind, by design.
    const persisted = await recoveryClient.callTool({
      name: "synaphex_get_task_session_owner",
      arguments: { projectId, taskId },
    });
    assert.deepEqual(persisted.structuredContent, {
      projectId,
      taskId,
      claimed: true,
      sessionId: abandonedSessionId,
    });

    // A normal open still refuses; it never auto-force-releases.
    const blocked = await recoveryClient.callTool({
      name: "synaphex_open_task_session",
      arguments: { projectId, taskId },
    });
    assert.equal(blocked.isError, true);
    assert.deepEqual(blocked.structuredContent, {
      code: "TASK_ALREADY_BOUND",
      message: "Task is already bound to another writable session.",
    });

    // 11: explicit user recovery -- no old SessionId required.
    const released = await recoveryClient.callTool({
      name: "synaphex_force_release_task_session",
      arguments: { projectId, taskId },
    });
    assert.notEqual(released.isError, true);
    assert.deepEqual(released.structuredContent, {
      projectId,
      taskId,
      released: true,
      previousSessionId: abandonedSessionId,
    });

    // 12: owner lookup reports unclaimed, and a repeat release is a no-op.
    const afterRelease = await recoveryClient.callTool({
      name: "synaphex_get_task_session_owner",
      arguments: { projectId, taskId },
    });
    assert.deepEqual(afterRelease.structuredContent, {
      projectId,
      taskId,
      claimed: false,
      sessionId: null,
    });
    const releasedAgain = await recoveryClient.callTool({
      name: "synaphex_force_release_task_session",
      arguments: { projectId, taskId },
    });
    assert.deepEqual(releasedAgain.structuredContent, {
      projectId,
      taskId,
      released: false,
      previousSessionId: null,
    });

    // 13: the task is reopenable after recovery.
    const recoveredOpen = await recoveryClient.callTool({
      name: "synaphex_open_task_session",
      arguments: { projectId, taskId },
    });
    assert.notEqual(recoveredOpen.isError, true);
    const recoveredId = (recoveredOpen.structuredContent as { sessionId: string })
      .sessionId;
    assert.match(recoveredId, /^ses_[0-9a-f]{32}$/);
    assert.notEqual(recoveredId, abandonedSessionId);
    await recoveryClient.callTool({
      name: "synaphex_close_session",
      arguments: { sessionId: recoveredId },
    });

    // 14: through all of that, no task lifecycle mutation occurred.
    const finalTask = await recoveryClient.callTool({
      name: "synaphex_get_task",
      arguments: { projectId, taskId },
    });
    const finalState = finalTask.structuredContent as {
      status: string;
      completedAt: string | null;
      archivedAt: string | null;
    };
    assert.equal(finalState.status, "active");
    assert.equal(finalState.completedAt, null);
    assert.equal(finalState.archivedAt, null);
  } finally {
    await recoveryClient.close();
  }
});

test("the stdio entrypoint writes no diagnostics to stdout", async (t) => {
  // Any non-protocol byte on stdout would corrupt the MCP stream, so the
  // entrypoint's own readiness notice must be on stderr.
  const source = await readFile(
    join(process.cwd(), "src", "mcp", "stdio-main.ts"),
    "utf8",
  );
  const code = source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/.*$/gm, "");
  for (const forbidden of [
    "process.stdout",
    "console.log",
    "console.info",
    "console.debug",
    "console.warn",
  ]) {
    assert.equal(code.includes(forbidden), false, `must not use ${forbidden}`);
  }
  assert.ok(code.includes("process.stderr.write"), "diagnostics go to stderr");
});

test("an unusable state root degrades to protocol errors, never corrupt stdout", async (t) => {
  // StateStore construction is lazy, so a broken state root surfaces per
  // request rather than at startup. What must hold either way: stdout carries
  // only JSON-RPC, and no internal detail reaches the protocol stream.
  const home = await temporaryStateRoot(t);
  // Make the state root unusable by planting a file where the directory goes.
  await writeFile(join(home, ".synaphex"), "not-a-directory\n");
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, [...ENTRYPOINT_ARGS], {
    env: { ...process.env, HOME: home },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));

  // Drive a real initialize request so the server reaches its first read.
  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "probe", version: "0" },
      },
    })}\n`,
  );
  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "synaphex_get_project", arguments: { projectId: "prj_x" } },
    })}\n`,
  );
  child.stdin.end();
  await new Promise<void>((resolve) => child.on("close", () => resolve()));

  // Whatever went wrong, stdout must contain only JSON-RPC lines.
  const lines = stdout.split("\n").filter((line) => line.trim() !== "");
  assert.ok(lines.length > 0, "expected protocol output");
  for (const line of lines) {
    const parsed: unknown = JSON.parse(line);
    assert.equal((parsed as { jsonrpc?: string }).jsonrpc, "2.0");
  }
  // And no internal detail leaked into the protocol stream.
  assert.equal(stdout.includes("not-a-directory"), false);
  assert.equal(/\n\s+at /.test(stdout), false, "no stack frames on stdout");
  assert.equal(stderr.includes("secret"), false);
});

// --- Phase 3A: host context startup validation -----------------------------

async function startupFailure(
  args: readonly string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, [ENTRYPOINT, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  child.stdin.end();
  const code = await new Promise<number | null>((resolve) =>
    child.on("close", (exitCode) => resolve(exitCode)),
  );
  return { code, stdout, stderr };
}

test("invalid or missing host context is a fatal startup error", async () => {
  const cases: readonly [string, readonly string[]][] = [
    ["missing both", []],
    ["missing surface", ["--host-provider", "anthropic"]],
    ["missing provider", ["--host-surface", "vscode"]],
    ["invalid provider", ["--host-provider", "acme", "--host-surface", "cli"]],
    ["invalid surface", ["--host-provider", "openai", "--host-surface", "emacs"]],
    // google + vscode is not a supported host: Antigravity IDE is not a
    // Synaphex host integration.
    [
      "unsupported combination",
      ["--host-provider", "google", "--host-surface", "vscode"],
    ],
    [
      "duplicate provider flag",
      [
        "--host-provider",
        "anthropic",
        "--host-provider",
        "openai",
        "--host-surface",
        "cli",
      ],
    ],
    [
      "provider flag without value",
      ["--host-provider", "--host-surface", "cli"],
    ],
  ];
  for (const [label, args] of cases) {
    const outcome = await startupFailure(args);
    assert.notEqual(outcome.code, 0, `${label} must exit non-zero`);
    // Diagnostics on stderr only; stdout must carry no protocol garbage.
    assert.equal(outcome.stdout, "", `${label} must not write to stdout`);
    assert.match(outcome.stderr, /\[synaphex-mcp\] fatal/, label);
  }
});

test("a supported host context starts successfully", async () => {
  const { spawn } = await import("node:child_process");
  const child = spawn(
    process.execPath,
    [ENTRYPOINT, "--host-provider", "openai", "--host-surface", "cli"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  child.stdin.end();
  await new Promise<void>((resolve) => child.on("close", () => resolve()));
  assert.match(stderr, /host context: openai\/cli/);
  assert.equal(stderr.includes("fatal"), false);
});

// --- Phase 3A: protocol-level agent invocation -----------------------------

const FAKE_PROVIDER_ENTRYPOINT = join(
  process.cwd(),
  ".test-dist",
  "test",
  "fixtures",
  "mcp-stdio-fake-provider.js",
);

test("Synaphex MCP invokes a source-read-only agent over real stdio", async (t) => {
  const home = await temporaryStateRoot(t);
  const { projectId, taskId } = await fixtureProjectAndTask(home);
  const routeSink = join(home, "route.json");

  // 1: launch with explicit immutable HostContext (anthropic/vscode).
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [FAKE_PROVIDER_ENTRYPOINT, ...HOST_ARGS],
    env: {
      ...process.env,
      HOME: home,
      SYNAPHEX_TEST_ROUTE_SINK: routeSink,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "synaphex-invoke-smoke", version: "0.0.0" });
  try {
    // 2: negotiate.
    await client.connect(transport);

    // 3 + 4: the invocation tool exists.
    const tools = (await client.listTools()).tools;
    const invokeTool = tools.find(
      (candidate) => candidate.name === "synaphex_invoke_agent",
    );
    assert.notEqual(invokeTool, undefined);
    assert.equal(tools.length, 21);

    // 5: the enum is exactly the six logical agents.
    const agentEnum =
      (invokeTool?.inputSchema as {
        properties?: { agent?: { enum?: string[] } };
      })?.properties?.agent?.enum ?? [];
    assert.equal(agentEnum.length, 6);
    assert.equal(agentEnum.includes("coder"), true);

    // 6 + 7: fixture project/task were created outside MCP; open a session.
    const opened = await client.callTool({
      name: "synaphex_open_task_session",
      arguments: { projectId, taskId },
    });
    const sessionId = (opened.structuredContent as { sessionId: string })
      .sessionId;

    // Configure the target agent through Core (not through MCP, which exposes
    // no configuration tool).
    const store = new StateStore(join(home, ".synaphex"));
    await new AgentConfigManager(store).setConfigured("researcher", {
      provider: "openai",
      surface: "cli",
      model: "researcher-model",
    });

    // 8 + 9: invoke and receive a structured InvocationResult.
    const invoked = await client.callTool({
      name: "synaphex_invoke_agent",
      arguments: {
        agent: "researcher",
        scope: { kind: "task_session", sessionId },
        instruction: "Research the fencing behavior over stdio.",
      },
    });
    assert.notEqual(invoked.isError, true, JSON.stringify(invoked.content));
    const invocation = invoked.structuredContent as Record<string, unknown>;
    assert.equal(invocation.agent, "researcher");
    assert.equal(invocation.outcome, "success");
    assert.deepEqual(invocation.scope, { sessionId, projectId, taskId });
    assert.deepEqual(invocation.executionPolicy, {
      sourceModification: "read_only",
    });

    // 10: the backend received the immutable process host context, and the
    // cross-provider CLI route was resolved from it.
    const observedRoute = JSON.parse(await readFile(routeSink, "utf8"));
    // The REAL ProviderDispatchingAgentExecutor selected the openai/cli
    // delegate from the resolved route: the full production dispatch path ran,
    // with only the leaf provider adapter faked.
    assert.equal(observedRoute.delegate, "codex");
    assert.deepEqual(observedRoute.host, {
      provider: "anthropic",
      surface: "vscode",
    });
    assert.equal(observedRoute.provider, "openai");
    assert.equal(observedRoute.effectiveSurface, "cli");
    assert.equal(observedRoute.routingReason, "cross_provider_cli");
    assert.equal(observedRoute.sourceModification, "read_only");

    // 11: classifications are returned, and nothing was executed.
    const calls = invocation.requestedCalls as { target: string; status: string }[];
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.target, "examiner");
    // The base scripted result requests a helper only; network is driven
    // separately by the Phase-3C network-approval flow test.
    assert.deepEqual(invocation.requestedActions, []);
    // Only ONE provider execution happened: no helper auto-ran.
    assert.equal(
      JSON.parse(await readFile(routeSink, "utf8")).agent,
      "researcher",
    );

    // No ownership token anywhere in the protocol payload.
    const serialized = JSON.stringify(invoked);
    assert.equal(serialized.includes("ownershipToken"), false);
    assert.equal(serialized.includes("ownershipFence"), false);

    // CODER is refused at the protocol level.
    const coder = await client.callTool({
      name: "synaphex_invoke_agent",
      arguments: {
        agent: "coder",
        scope: { kind: "task_session", sessionId },
        instruction: "Write the code.",
      },
    });
    assert.equal(coder.isError, true);
  } finally {
    // 12: shut down cleanly.
    await client.close();
  }
});

test("a native VS Code target fails closed through the production dispatch path", async (t) => {
  // host = anthropic/vscode, target = anthropic/vscode -> same_provider_native.
  // The dispatcher must refuse rather than silently running a provider CLI.
  const home = await temporaryStateRoot(t);
  const { projectId, taskId } = await fixtureProjectAndTask(home);
  const routeSink = join(home, "route.json");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [FAKE_PROVIDER_ENTRYPOINT, ...HOST_ARGS],
    env: { ...process.env, HOME: home, SYNAPHEX_TEST_ROUTE_SINK: routeSink },
    stderr: "pipe",
  });
  const client = new Client({ name: "synaphex-native-smoke", version: "0.0.0" });
  try {
    await client.connect(transport);
    const opened = await client.callTool({
      name: "synaphex_open_task_session",
      arguments: { projectId, taskId },
    });
    const sessionId = (opened.structuredContent as { sessionId: string })
      .sessionId;

    const store = new StateStore(join(home, ".synaphex"));
    // Same provider as the host, VS Code surface -> native route.
    await new AgentConfigManager(store).setConfigured("researcher", {
      provider: "anthropic",
      surface: "vscode",
      model: "researcher-model",
    });

    const invoked = await client.callTool({
      name: "synaphex_invoke_agent",
      arguments: {
        agent: "researcher",
        scope: { kind: "task_session", sessionId },
        instruction: "Research over a native route.",
      },
    });
    assert.equal(invoked.isError, true);
    // Safe mapping: a stable code, no stack traces or provider internals.
    const serialized = JSON.stringify(invoked);
    assert.equal(/\n\s+at /.test(serialized), false, "no stack frames");
    // No delegate ran, so no route was ever recorded.
    await assert.rejects(readFile(routeSink, "utf8"));
  } finally {
    await client.close();
  }
});

// --- Phase 3C: continuation flows over real stdio -------------------------

interface ContinuationHarness {
  readonly client: Client;
  readonly sessionId: string;
  readonly projectId: string;
  readonly taskId: string;
  close(): Promise<void>;
}

async function continuationHarness(
  t: TestContext,
  options: {
    readonly helperRule?: "allow" | "ask";
    readonly wantNetwork?: boolean;
    readonly networkRule?: "ask";
  } = {},
): Promise<ContinuationHarness> {
  const home = await temporaryStateRoot(t);
  const { projectId, taskId } = await fixtureProjectAndTask(home);
  const store = new StateStore(join(home, ".synaphex"));
  const projects = new ProjectManager(store, { homeDirectory: home });
  const tasks = new TaskManager(store, projects);
  const configs = new AgentConfigManager(store);
  await configs.setConfigured("researcher", {
    provider: "openai",
    surface: "cli",
    model: "researcher-model",
  });
  await configs.setConfigured("examiner", {
    provider: "openai",
    surface: "cli",
    model: "examiner-model",
  });
  const rules = new RuleResolver(store, projects, tasks);
  if (options.helperRule !== undefined) {
    await rules.setRule(
      "global",
      { kind: "agent_call", caller: "researcher", target: "examiner" },
      options.helperRule,
    );
  }
  if (options.networkRule !== undefined) {
    await rules.setRule(
      "global",
      { kind: "action", action: "network" },
      options.networkRule,
    );
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [FAKE_PROVIDER_ENTRYPOINT, ...HOST_ARGS],
    env: {
      ...process.env,
      HOME: home,
      ...(options.wantNetwork === true
        ? { SYNAPHEX_TEST_WANT_NETWORK: "1" }
        : {}),
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "synaphex-cont-smoke", version: "0.0.0" });
  await client.connect(transport);
  const opened = await client.callTool({
    name: "synaphex_open_task_session",
    arguments: { projectId, taskId },
  });
  const sessionId = (opened.structuredContent as { sessionId: string })
    .sessionId;
  return {
    client,
    sessionId,
    projectId,
    taskId,
    close: () => client.close(),
  };
}

test("allowed helper: execute once, no auto-resume, then explicit resume", async (t) => {
  const h = await continuationHarness(t, { helperRule: "allow" });
  try {
    const invoked = await h.client.callTool({
      name: "synaphex_invoke_agent",
      arguments: {
        agent: "researcher",
        scope: { kind: "task_session", sessionId: h.sessionId },
        instruction: "Research it.",
      },
    });
    const result = invoked.structuredContent as Record<string, unknown>;
    const calls = result.requestedCalls as { status: string }[];
    assert.equal(calls[0]?.status, "allowed");
    const continuationId = result.continuationId as string;
    assert.match(continuationId, /^cont_[0-9a-f]{32}$/);

    // Execute the helper explicitly.
    const helper = await h.client.callTool({
      name: "synaphex_execute_helper",
      arguments: { continuationId, requestIndex: 0 },
    });
    assert.notEqual(helper.isError, true, JSON.stringify(helper.content));
    const helperOut = helper.structuredContent as Record<string, unknown>;
    assert.equal(helperOut.callerResumeReady, true);
    assert.equal(
      (helperOut.invocation as { agent: string }).agent,
      "examiner",
    );

    // Executing the same request again is refused.
    const twice = await h.client.callTool({
      name: "synaphex_execute_helper",
      arguments: { continuationId, requestIndex: 0 },
    });
    assert.equal(twice.isError, true);
    assert.equal(
      (twice.structuredContent as { code: string }).code,
      "INVALID_CONTINUATION_STATE",
    );

    // Explicit caller resume -> a fresh caller invocation.
    const resumed = await h.client.callTool({
      name: "synaphex_resume_caller",
      arguments: { continuationId },
    });
    assert.notEqual(resumed.isError, true, JSON.stringify(resumed.content));
    assert.equal(
      ((resumed.structuredContent as { invocation: { agent: string } })
        .invocation).agent,
      "researcher",
    );

    // Resuming twice is refused: the record was consumed.
    const resumedAgain = await h.client.callTool({
      name: "synaphex_resume_caller",
      arguments: { continuationId },
    });
    assert.equal(resumedAgain.isError, true);
  } finally {
    await h.close();
  }
});

test("asked helper: execute_helper refuses, approve_and_execute succeeds once, rule stays ask", async (t) => {
  const h = await continuationHarness(t, { helperRule: "ask" });
  try {
    const invoked = await h.client.callTool({
      name: "synaphex_invoke_agent",
      arguments: {
        agent: "researcher",
        scope: { kind: "task_session", sessionId: h.sessionId },
        instruction: "Research it.",
      },
    });
    const result = invoked.structuredContent as Record<string, unknown>;
    const calls = result.requestedCalls as { status: string }[];
    assert.equal(calls[0]?.status, "approval_required");
    const continuationId = result.continuationId as string;

    // Plain execution refuses an asked edge.
    const refused = await h.client.callTool({
      name: "synaphex_execute_helper",
      arguments: { continuationId, requestIndex: 0 },
    });
    assert.equal(refused.isError, true);

    // Explicit approval succeeds.
    const approved = await h.client.callTool({
      name: "synaphex_approve_and_execute_helper",
      arguments: { continuationId, requestIndex: 0 },
    });
    assert.notEqual(approved.isError, true, JSON.stringify(approved.content));

    // Approving again is refused.
    const twice = await h.client.callTool({
      name: "synaphex_approve_and_execute_helper",
      arguments: { continuationId, requestIndex: 0 },
    });
    assert.equal(twice.isError, true);

    // The rule remains `ask` -- approval was one-time and invocation-scoped.
    const rules = await h.client.callTool({
      name: "synaphex_get_effective_rules",
      arguments: {},
    });
    const effective = (
      rules.structuredContent as {
        rules: { key: string; decision: string }[];
      }
    ).rules;
    const edge = effective.find(
      (rule) => rule.key === "agent-call.researcher.examiner",
    );
    assert.equal(edge?.decision, "ask", "the ask rule must not be mutated");
  } finally {
    await h.close();
  }
});

test("network approval: one-time grant reaches a fresh caller execution, rule stays ask", async (t) => {
  const h = await continuationHarness(t, {
    wantNetwork: true,
    networkRule: "ask",
  });
  try {
    const invoked = await h.client.callTool({
      name: "synaphex_invoke_agent",
      arguments: {
        agent: "researcher",
        scope: { kind: "task_session", sessionId: h.sessionId },
        instruction: "Research it.",
      },
    });
    const result = invoked.structuredContent as Record<string, unknown>;
    const actions = result.requestedActions as {
      action: string;
      status: string;
    }[];
    assert.equal(actions[0]?.action, "network");
    assert.equal(actions[0]?.status, "approval_required");
    const continuationId = result.continuationId as string;

    const approved = await h.client.callTool({
      name: "synaphex_approve_network_action",
      arguments: { continuationId, requestIndex: 0 },
    });
    assert.notEqual(approved.isError, true, JSON.stringify(approved.content));
    // A fresh caller invocation ran under the one-time grant.
    assert.equal(
      ((approved.structuredContent as { invocation: { agent: string } })
        .invocation).agent,
      "researcher",
    );

    // Approving twice is refused: the record was consumed.
    const twice = await h.client.callTool({
      name: "synaphex_approve_network_action",
      arguments: { continuationId, requestIndex: 0 },
    });
    assert.equal(twice.isError, true);

    // The network rule remains `ask`.
    const rules = await h.client.callTool({
      name: "synaphex_get_effective_rules",
      arguments: {},
    });
    const effective = (
      rules.structuredContent as {
        rules: { key: string; decision: string }[];
      }
    ).rules;
    assert.equal(
      effective.find((rule) => rule.key === "action.network")?.decision,
      "ask",
    );
  } finally {
    await h.close();
  }
});

test("a denied helper cannot be executed with a valid continuationId and index", async (t) => {
  const h = await continuationHarness(t, { helperRule: "deny" as "allow" });
  try {
    const invoked = await h.client.callTool({
      name: "synaphex_invoke_agent",
      arguments: {
        agent: "researcher",
        scope: { kind: "task_session", sessionId: h.sessionId },
        instruction: "Research it.",
      },
    });
    const result = invoked.structuredContent as Record<string, unknown>;
    assert.equal(
      (result.requestedCalls as { status: string }[])[0]?.status,
      "denied",
    );
    // Nothing is actionable, so no handle is issued at all.
    assert.equal(result.continuationId, null);

    // Even a well-formed guess cannot progress it.
    const attempted = await h.client.callTool({
      name: "synaphex_execute_helper",
      arguments: {
        continuationId: "cont_00000000000000000000000000000000",
        requestIndex: 0,
      },
    });
    assert.equal(attempted.isError, true);
    assert.equal(
      (attempted.structuredContent as { code: string }).code,
      "CONTINUATION_NOT_FOUND",
    );
  } finally {
    await h.close();
  }
});

test("a continuation handle does not survive an MCP process restart", async (t) => {
  const home = await temporaryStateRoot(t);
  const { projectId, taskId } = await fixtureProjectAndTask(home);
  const store = new StateStore(join(home, ".synaphex"));
  const projects = new ProjectManager(store, { homeDirectory: home });
  const tasks = new TaskManager(store, projects);
  await new AgentConfigManager(store).setConfigured("researcher", {
    provider: "openai",
    surface: "cli",
    model: "researcher-model",
  });
  await new AgentConfigManager(store).setConfigured("examiner", {
    provider: "openai",
    surface: "cli",
    model: "examiner-model",
  });
  await new RuleResolver(store, projects, tasks).setRule(
    "global",
    { kind: "agent_call", caller: "researcher", target: "examiner" },
    "allow",
  );

  const spawnClient = async (): Promise<Client> => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [FAKE_PROVIDER_ENTRYPOINT, ...HOST_ARGS],
      env: { ...process.env, HOME: home },
      stderr: "pipe",
    });
    const client = new Client({ name: "restart-probe", version: "0.0.0" });
    await client.connect(transport);
    return client;
  };

  const first = await spawnClient();
  let continuationId: string;
  let sessionId: string;
  try {
    const opened = await first.callTool({
      name: "synaphex_open_task_session",
      arguments: { projectId, taskId },
    });
    sessionId = (opened.structuredContent as { sessionId: string }).sessionId;
    const invoked = await first.callTool({
      name: "synaphex_invoke_agent",
      arguments: {
        agent: "researcher",
        scope: { kind: "task_session", sessionId },
        instruction: "Research it.",
      },
    });
    continuationId = (invoked.structuredContent as { continuationId: string })
      .continuationId;
    assert.match(continuationId, /^cont_/);
  } finally {
    await first.close();
  }

  // A brand-new process: continuation state was process-local and is gone.
  const second = await spawnClient();
  try {
    const attempted = await second.callTool({
      name: "synaphex_execute_helper",
      arguments: { continuationId, requestIndex: 0 },
    });
    assert.equal(attempted.isError, true);
    assert.equal(
      (attempted.structuredContent as { code: string }).code,
      "CONTINUATION_NOT_FOUND",
    );

    // The Synaphex SESSION, by contrast, survived the restart intact.
    const session = await second.callTool({
      name: "synaphex_get_session",
      arguments: { sessionId },
    });
    assert.deepEqual(session.structuredContent, {
      sessionId,
      bound: true,
      projectId,
      taskId,
    });
  } finally {
    await second.close();
  }
});

test("allowed network: no auto-resume, explicit continue, rule stays allow", async (t) => {
  const h = await continuationHarness(t, {
    wantNetwork: true,
    networkRule: "allow" as "ask",
  });
  try {
    const invoked = await h.client.callTool({
      name: "synaphex_invoke_agent",
      arguments: {
        agent: "researcher",
        scope: { kind: "task_session", sessionId: h.sessionId },
        instruction: "Research it.",
      },
    });
    const result = invoked.structuredContent as Record<string, unknown>;
    const actions = result.requestedActions as {
      action: string;
      status: string;
      ruleDecision: string;
    }[];
    assert.equal(actions[0]?.action, "network");
    // Already permitted by rule -- no approval is required.
    assert.equal(actions[0]?.status, "allowed");
    assert.equal(actions[0]?.ruleDecision, "allow");
    // Still actionable, so a handle exists: the caller did NOT auto-resume.
    const continuationId = result.continuationId as string;
    assert.match(continuationId, /^cont_[0-9a-f]{32}$/);

    // The approval tool must refuse an already-allowed action.
    const wrongTool = await h.client.callTool({
      name: "synaphex_approve_network_action",
      arguments: { continuationId, requestIndex: 0 },
    });
    assert.equal(wrongTool.isError, true);
    assert.equal(
      (wrongTool.structuredContent as { code: string }).code,
      "INVALID_CONTINUATION_STATE",
    );

    // Explicit continuation runs a fresh caller invocation.
    const continued = await h.client.callTool({
      name: "synaphex_continue_allowed_network",
      arguments: { continuationId, requestIndex: 0 },
    });
    assert.notEqual(continued.isError, true, JSON.stringify(continued.content));
    const continuedOut = continued.structuredContent as {
      invocation: {
        agent: string;
        executionPolicy: { sourceModification: string };
      };
    };
    assert.equal(continuedOut.invocation.agent, "researcher");
    assert.equal(
      continuedOut.invocation.executionPolicy.sourceModification,
      "read_only",
    );

    // The old handle was consumed.
    const twice = await h.client.callTool({
      name: "synaphex_continue_allowed_network",
      arguments: { continuationId, requestIndex: 0 },
    });
    assert.equal(twice.isError, true);
    assert.equal(
      (twice.structuredContent as { code: string }).code,
      "CONTINUATION_NOT_FOUND",
    );

    // No rule mutation: network is still `allow`.
    const rules = await h.client.callTool({
      name: "synaphex_get_effective_rules",
      arguments: {},
    });
    const effective = (
      rules.structuredContent as {
        rules: { key: string; decision: string }[];
      }
    ).rules;
    assert.equal(
      effective.find((rule) => rule.key === "action.network")?.decision,
      "allow",
    );
  } finally {
    await h.close();
  }
});

test("an approval_required network action cannot use the allowed-network tool", async (t) => {
  const h = await continuationHarness(t, {
    wantNetwork: true,
    networkRule: "ask",
  });
  try {
    const invoked = await h.client.callTool({
      name: "synaphex_invoke_agent",
      arguments: {
        agent: "researcher",
        scope: { kind: "task_session", sessionId: h.sessionId },
        instruction: "Research it.",
      },
    });
    const result = invoked.structuredContent as Record<string, unknown>;
    assert.equal(
      (result.requestedActions as { status: string }[])[0]?.status,
      "approval_required",
    );
    const continuationId = result.continuationId as string;

    // The allowed-network tool refuses; the approval tool is required.
    const refused = await h.client.callTool({
      name: "synaphex_continue_allowed_network",
      arguments: { continuationId, requestIndex: 0 },
    });
    assert.equal(refused.isError, true);
    assert.equal(
      (refused.structuredContent as { code: string }).code,
      "INVALID_CONTINUATION_STATE",
    );

    const approved = await h.client.callTool({
      name: "synaphex_approve_network_action",
      arguments: { continuationId, requestIndex: 0 },
    });
    assert.notEqual(approved.isError, true, JSON.stringify(approved.content));
  } finally {
    await h.close();
  }
});

// --- Phase 4A: project/task bootstrap over real stdio ---------------------

/** Launches the fake-provider MCP server with an empty temporary state root. */
async function bootstrapClient(
  t: TestContext,
  configureAgents = false,
): Promise<{ client: Client; home: string; sourcePath: string }> {
  const home = await temporaryStateRoot(t);
  const sourcePath = join(home, "workspace");
  await mkdir(sourcePath, { recursive: true });
  if (configureAgents) {
    const store = new StateStore(join(home, ".synaphex"));
    const configs = new AgentConfigManager(store);
    for (const agent of ["researcher", "examiner", "planner"] as const) {
      await configs.setConfigured(agent, {
        provider: "openai",
        surface: "cli",
        model: `${agent}-model`,
      });
    }
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [FAKE_PROVIDER_ENTRYPOINT, ...HOST_ARGS],
    env: { ...process.env, HOME: home },
    stderr: "pipe",
  });
  const client = new Client({ name: "bootstrap-smoke", version: "0.0.0" });
  await client.connect(transport);
  return { client, home, sourcePath };
}

test("A: a project can be bootstrapped end to end through MCP alone", async (t) => {
  const { client, sourcePath } = await bootstrapClient(t);
  try {
    // register
    const registered = await client.callTool({
      name: "synaphex_register_project",
      arguments: { name: "Bootstrap Demo", sourcePath },
    });
    assert.notEqual(registered.isError, true, JSON.stringify(registered.content));
    const project = registered.structuredContent as {
      id: string;
      name: string;
      sourcePath: string;
    };
    assert.match(project.id, /^prj_[0-9a-f]{32}$/);
    assert.equal(project.name, "Bootstrap Demo");

    // read back
    const fetched = await client.callTool({
      name: "synaphex_get_project",
      arguments: { projectId: project.id },
    });
    assert.deepEqual(fetched.structuredContent, project);

    // create task
    const created = await client.callTool({
      name: "synaphex_create_task",
      arguments: { projectId: project.id, description: "Add JWT auth" },
    });
    assert.notEqual(created.isError, true, JSON.stringify(created.content));
    const task = created.structuredContent as { id: string; status: string };
    assert.match(task.id, /^task_[0-9a-f]{32}$/);
    assert.equal(task.status, "active");

    // creating a task did NOT open a session or claim ownership
    const ownerAfterCreate = await client.callTool({
      name: "synaphex_get_task_session_owner",
      arguments: { projectId: project.id, taskId: task.id },
    });
    assert.deepEqual(ownerAfterCreate.structuredContent, {
      projectId: project.id,
      taskId: task.id,
      claimed: false,
      sessionId: null,
    });

    // open a task session
    const opened = await client.callTool({
      name: "synaphex_open_task_session",
      arguments: { projectId: project.id, taskId: task.id },
    });
    const sessionId = (opened.structuredContent as { sessionId: string })
      .sessionId;
    const session = await client.callTool({
      name: "synaphex_get_session",
      arguments: { sessionId },
    });
    assert.deepEqual(session.structuredContent, {
      sessionId,
      bound: true,
      projectId: project.id,
      taskId: task.id,
    });

    // close it
    const closed = await client.callTool({
      name: "synaphex_close_session",
      arguments: { sessionId },
    });
    assert.deepEqual(closed.structuredContent, {
      sessionId,
      released: true,
      releasedTaskId: task.id,
      bound: false,
    });

    // registering the same path again is refused, not deduplicated
    const duplicate = await client.callTool({
      name: "synaphex_register_project",
      arguments: { name: "Duplicate", sourcePath },
    });
    assert.equal(duplicate.isError, true);
  } finally {
    await client.close();
  }
});

test("B: a project-only session is self-service and supports project invocation", async (t) => {
  const { client, sourcePath } = await bootstrapClient(t, true);
  try {
    const project = (
      await client.callTool({
        name: "synaphex_register_project",
        arguments: { name: "Project Scope", sourcePath },
      })
    ).structuredContent as { id: string };

    const opened = await client.callTool({
      name: "synaphex_open_project_session",
      arguments: { projectId: project.id },
    });
    assert.notEqual(opened.isError, true, JSON.stringify(opened.content));
    const projectSession = opened.structuredContent as {
      sessionId: string;
      taskId: null;
      bound: boolean;
    };
    assert.match(projectSession.sessionId, /^ses_[0-9a-f]{32}$/);
    assert.equal(projectSession.taskId, null);

    // get_session shows a project-only binding.
    const session = await client.callTool({
      name: "synaphex_get_session",
      arguments: { sessionId: projectSession.sessionId },
    });
    assert.deepEqual(session.structuredContent, {
      sessionId: projectSession.sessionId,
      bound: true,
      projectId: project.id,
      taskId: null,
    });

    // RESEARCHER project-scope invocation now works self-service.
    const researcher = await client.callTool({
      name: "synaphex_invoke_agent",
      arguments: {
        agent: "researcher",
        scope: { kind: "project", sessionId: projectSession.sessionId },
        instruction: "Research the project.",
      },
    });
    assert.notEqual(researcher.isError, true, JSON.stringify(researcher.content));
    const invocation = researcher.structuredContent as {
      scope: { taskId: string | null };
      executionPolicy: { sourceModification: string };
    };
    assert.equal(invocation.scope.taskId, null);
    assert.equal(invocation.executionPolicy.sourceModification, "read_only");

    // Close, then the binding is gone.
    await client.callTool({
      name: "synaphex_close_session",
      arguments: { sessionId: projectSession.sessionId },
    });
    const afterClose = await client.callTool({
      name: "synaphex_get_session",
      arguments: { sessionId: projectSession.sessionId },
    });
    assert.deepEqual(afterClose.structuredContent, {
      sessionId: projectSession.sessionId,
      bound: false,
      projectId: null,
      taskId: null,
    });
  } finally {
    await client.close();
  }
});

test("C: PLANNER still cannot use project scope, and MCP does not broaden contracts", async (t) => {
  const { client, sourcePath } = await bootstrapClient(t, true);
  try {
    const project = (
      await client.callTool({
        name: "synaphex_register_project",
        arguments: { name: "Role Boundary", sourcePath },
      })
    ).structuredContent as { id: string };
    const sessionId = (
      (
        await client.callTool({
          name: "synaphex_open_project_session",
          arguments: { projectId: project.id },
        })
      ).structuredContent as { sessionId: string }
    ).sessionId;

    const planner = await client.callTool({
      name: "synaphex_invoke_agent",
      arguments: {
        agent: "planner",
        scope: { kind: "project", sessionId },
        instruction: "Plan it.",
      },
    });
    // Refused by Core's role contract (planner requires a task binding).
    assert.equal(planner.isError, true);
    assert.equal(
      (planner.structuredContent as { code: string }).code,
      "NO_TASK_BOUND",
    );
  } finally {
    await client.close();
  }
});

test("D: a project session leaves task ownership untouched", async (t) => {
  const { client, sourcePath } = await bootstrapClient(t);
  try {
    const project = (
      await client.callTool({
        name: "synaphex_register_project",
        arguments: { name: "No Claim", sourcePath },
      })
    ).structuredContent as { id: string };
    const task = (
      await client.callTool({
        name: "synaphex_create_task",
        arguments: { projectId: project.id, description: "Unclaimed task" },
      })
    ).structuredContent as { id: string };

    await client.callTool({
      name: "synaphex_open_project_session",
      arguments: { projectId: project.id },
    });

    // The task remains unclaimed: a project session holds no claim.
    const owner = await client.callTool({
      name: "synaphex_get_task_session_owner",
      arguments: { projectId: project.id, taskId: task.id },
    });
    assert.deepEqual(owner.structuredContent, {
      projectId: project.id,
      taskId: task.id,
      claimed: false,
      sessionId: null,
    });

    // And a task session can still be opened normally afterwards.
    const opened = await client.callTool({
      name: "synaphex_open_task_session",
      arguments: { projectId: project.id, taskId: task.id },
    });
    assert.notEqual(opened.isError, true);
  } finally {
    await client.close();
  }
});

test("bootstrap tools grant no generic filesystem introspection", async (t) => {
  const { client, home } = await bootstrapClient(t);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const absent of [
      "read_file",
      "list_directory",
      "glob",
      "read_synaphex_file",
      "read_provider_config",
      "synaphex_read_file",
      "synaphex_list_directory",
    ]) {
      assert.equal(names.includes(absent), false, `${absent} must not exist`);
    }

    // A sourcePath pointing at a FILE is refused, and at a directory it only
    // ever yields project metadata -- never directory contents.
    const filePath = join(home, "secret.txt");
    await writeFile(filePath, "sensitive", "utf8");
    const asFile = await client.callTool({
      name: "synaphex_register_project",
      arguments: { name: "File", sourcePath: filePath },
    });
    assert.equal(asFile.isError, true);
    const serialized = JSON.stringify(asFile);
    assert.equal(serialized.includes("sensitive"), false);
  } finally {
    await client.close();
  }
});

// --- Phase 4B: plan review and deterministic decisions --------------------

interface PlanHarness {
  readonly client: Client;
  readonly projectId: string;
  readonly taskId: string;
  readonly sessionId: string;
  close(): Promise<void>;
}

async function planHarness(
  t: TestContext,
  planMarkdown?: string,
): Promise<PlanHarness> {
  const home = await temporaryStateRoot(t);
  const sourcePath = join(home, "workspace");
  await mkdir(sourcePath, { recursive: true });
  const store = new StateStore(join(home, ".synaphex"));
  const configs = new AgentConfigManager(store);
  await configs.setConfigured("planner", {
    provider: "openai",
    surface: "cli",
    model: "planner-model",
  });
  await configs.setConfigured("coder", {
    provider: "openai",
    surface: "cli",
    model: "coder-model",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [FAKE_PROVIDER_ENTRYPOINT, ...HOST_ARGS],
    env: {
      ...process.env,
      HOME: home,
      ...(planMarkdown === undefined
        ? {}
        : { SYNAPHEX_TEST_PLAN_MARKDOWN: planMarkdown }),
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "plan-smoke", version: "0.0.0" });
  await client.connect(transport);
  const projectId = (
    (
      await client.callTool({
        name: "synaphex_register_project",
        arguments: { name: "Plan Project", sourcePath },
      })
    ).structuredContent as { id: string }
  ).id;
  const taskId = (
    (
      await client.callTool({
        name: "synaphex_create_task",
        arguments: { projectId, description: "Plan the work" },
      })
    ).structuredContent as { id: string }
  ).id;
  const sessionId = (
    (
      await client.callTool({
        name: "synaphex_open_task_session",
        arguments: { projectId, taskId },
      })
    ).structuredContent as { sessionId: string }
  ).sessionId;
  return { client, projectId, taskId, sessionId, close: () => client.close() };
}

async function invokePlanner(h: PlanHarness): Promise<void> {
  const invoked = await h.client.callTool({
    name: "synaphex_invoke_agent",
    arguments: {
      agent: "planner",
      scope: { kind: "task_session", sessionId: h.sessionId },
      instruction: "Draft a plan.",
    },
  });
  assert.notEqual(invoked.isError, true, JSON.stringify(invoked.content));
}

async function planState(h: PlanHarness): Promise<{
  draft: { revisionId: string; content: string } | null;
  current: { content: string } | null;
}> {
  const state = await h.client.callTool({
    name: "synaphex_get_plan_state",
    arguments: { sessionId: h.sessionId },
  });
  assert.notEqual(state.isError, true, JSON.stringify(state.content));
  return state.structuredContent as never;
}

test("A: Planner draft can be read and accepted by exact revision", async (t) => {
  const h = await planHarness(t);
  try {
    await invokePlanner(h);
    const before = await planState(h);
    assert.notEqual(before.draft, null);
    assert.match(before.draft!.revisionId, /^planrev_[0-9a-f]{32}$/);
    assert.equal(before.current, null);
    // Natural-language "approval" in the Planner result promoted nothing.
    assert.match(before.draft!.content, /Approved: build it/);

    const accepted = await h.client.callTool({
      name: "synaphex_accept_plan_draft",
      arguments: {
        sessionId: h.sessionId,
        draftRevisionId: before.draft!.revisionId,
      },
    });
    assert.notEqual(accepted.isError, true, JSON.stringify(accepted.content));

    const after = await planState(h);
    assert.equal(after.draft, null);
    assert.equal(after.current?.content, before.draft!.content);
  } finally {
    await h.close();
  }
});

test("B: a stale revision is refused and the latest draft survives", async (t) => {
  const h = await planHarness(t);
  try {
    await invokePlanner(h);
    const first = await planState(h);
    const staleRevision = first.draft!.revisionId;

    // A second Planner invocation replaces the draft instance.
    await invokePlanner(h);
    const second = await planState(h);
    assert.notEqual(second.draft!.revisionId, staleRevision);

    const refused = await h.client.callTool({
      name: "synaphex_accept_plan_draft",
      arguments: { sessionId: h.sessionId, draftRevisionId: staleRevision },
    });
    assert.equal(refused.isError, true);
    assert.equal(
      (refused.structuredContent as { code: string }).code,
      "PLAN_DRAFT_REVISION_MISMATCH",
    );
    // The stale error must not carry the new draft content.
    assert.equal(JSON.stringify(refused).includes("Approved: build it"), false);

    // The latest draft remains, unpromoted.
    const unchanged = await planState(h);
    assert.equal(unchanged.draft!.revisionId, second.draft!.revisionId);
    assert.equal(unchanged.current, null);
  } finally {
    await h.close();
  }
});

test("C: two identical-content Planner drafts get different revisions", async (t) => {
  const h = await planHarness(t, "# Identical plan\n\n1. Same bytes.\n");
  try {
    await invokePlanner(h);
    const first = await planState(h);
    await invokePlanner(h);
    const second = await planState(h);

    // Byte-identical content, distinct instance identity: same-content ABA is
    // impossible over the wire too.
    assert.equal(second.draft!.content, first.draft!.content);
    assert.notEqual(second.draft!.revisionId, first.draft!.revisionId);

    const stale = await h.client.callTool({
      name: "synaphex_accept_plan_draft",
      arguments: {
        sessionId: h.sessionId,
        draftRevisionId: first.draft!.revisionId,
      },
    });
    assert.equal(stale.isError, true);
    assert.equal(
      (stale.structuredContent as { code: string }).code,
      "PLAN_DRAFT_REVISION_MISMATCH",
    );
  } finally {
    await h.close();
  }
});

test("D: rejecting an exact revision deletes the draft and leaves current alone", async (t) => {
  const h = await planHarness(t);
  try {
    // Establish an accepted current plan first.
    await invokePlanner(h);
    const accepted = await planState(h);
    await h.client.callTool({
      name: "synaphex_accept_plan_draft",
      arguments: {
        sessionId: h.sessionId,
        draftRevisionId: accepted.draft!.revisionId,
      },
    });
    const currentContent = (await planState(h)).current!.content;

    // A new proposal is rejected.
    await invokePlanner(h);
    const proposal = await planState(h);
    const rejected = await h.client.callTool({
      name: "synaphex_reject_plan_draft",
      arguments: {
        sessionId: h.sessionId,
        draftRevisionId: proposal.draft!.revisionId,
      },
    });
    assert.notEqual(rejected.isError, true, JSON.stringify(rejected.content));

    const after = await planState(h);
    assert.equal(after.draft, null);
    assert.equal(after.current?.content, currentContent);

    // Deciding the same revision again is refused.
    for (const tool of [
      "synaphex_accept_plan_draft",
      "synaphex_reject_plan_draft",
    ]) {
      const again = await h.client.callTool({
        name: tool,
        arguments: {
          sessionId: h.sessionId,
          draftRevisionId: proposal.draft!.revisionId,
        },
      });
      assert.equal(again.isError, true, tool);
    }

    // The task lifecycle never changed.
    const task = await h.client.callTool({
      name: "synaphex_get_task",
      arguments: { projectId: h.projectId, taskId: h.taskId },
    });
    assert.equal(
      (task.structuredContent as { status: string }).status,
      "active",
    );
  } finally {
    await h.close();
  }
});

test("E: a project-only session cannot use any plan tool", async (t) => {
  const h = await planHarness(t);
  try {
    const projectSession = (
      (
        await h.client.callTool({
          name: "synaphex_open_project_session",
          arguments: { projectId: h.projectId },
        })
      ).structuredContent as { sessionId: string }
    ).sessionId;

    for (const [tool, args] of [
      ["synaphex_get_plan_state", { sessionId: projectSession }],
      [
        "synaphex_accept_plan_draft",
        {
          sessionId: projectSession,
          draftRevisionId: "planrev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ],
      [
        "synaphex_reject_plan_draft",
        {
          sessionId: projectSession,
          draftRevisionId: "planrev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ],
    ] as const) {
      const outcome = await h.client.callTool({ name: tool, arguments: args });
      assert.equal(outcome.isError, true, tool);
      assert.equal(
        (outcome.structuredContent as { code: string }).code,
        "NO_TASK_BOUND",
        tool,
      );
    }
  } finally {
    await h.close();
  }
});

test("plan tools expose no ownership token, path or archive content", async (t) => {
  const h = await planHarness(t);
  try {
    await invokePlanner(h);
    const state = await h.client.callTool({
      name: "synaphex_get_plan_state",
      arguments: { sessionId: h.sessionId },
    });
    const serialized = JSON.stringify(state);
    for (const forbidden of [
      "ownershipToken",
      "TaskOwnershipFence",
      "draft.md",
      "draft.meta.json",
      "/plans",
      "archive",
      "contentHash",
    ]) {
      assert.equal(serialized.includes(forbidden), false, `leaked ${forbidden}`);
    }
  } finally {
    await h.close();
  }
});

test("CODER is invocable after a plan is accepted, and stages rather than writing source", async (t) => {
  const h = await planHarness(t);
  try {
    await invokePlanner(h);
    const state = await planState(h);
    await h.client.callTool({
      name: "synaphex_accept_plan_draft",
      arguments: {
        sessionId: h.sessionId,
        draftRevisionId: state.draft!.revisionId,
      },
    });
    // An accepted plan clears PLAN_DRAFT_PENDING, and CODER is now invocable.
    // The fixture project is not a Git repo, so staging fails closed with the
    // precise staging error -- proving the staged path runs and that no
    // provider executed against the real source. Config and lifecycle checks
    // still come first, so staging never pays for an obvious failure.
    const coder = await h.client.callTool({
      name: "synaphex_invoke_agent",
      arguments: {
        agent: "coder",
        scope: { kind: "task_session", sessionId: h.sessionId },
        instruction: "Implement the accepted plan.",
      },
    });
    assert.equal(coder.isError, true);
    const code = (coder.structuredContent as { code?: string }).code;
    assert.equal(code, "CODER_STAGING_REQUIRES_GIT");
    assert.notEqual(code, "AGENT_EXECUTION_FAILED");
  } finally {
    await h.close();
  }
});

test("staged CODER runs through MCP and leaves the real source unchanged", async (t) => {
  const home = await temporaryStateRoot(t);
  const sourcePath = join(home, "workspace");
  await mkdir(sourcePath, { recursive: true });
  // A clean Git source, required by staged CODER.
  const gitEnv = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: sourcePath,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@localhost",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@localhost",
    LC_ALL: "C",
  };
  const { spawnSync } = await import("node:child_process");
  await writeFile(join(sourcePath, "app.txt"), "original\n", "utf8");
  for (const args of [
    ["init", "--quiet"],
    ["add", "-A"],
    ["commit", "--quiet", "-m", "baseline"],
  ]) {
    const result = spawnSync("git", args, { cwd: sourcePath, env: gitEnv, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const headBefore = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: sourcePath,
    env: gitEnv,
    encoding: "utf8",
  }).stdout.trim();

  const store = new StateStore(join(home, ".synaphex"));
  await new AgentConfigManager(store).setConfigured("coder", {
    provider: "openai",
    surface: "cli",
    model: "coder-model",
  });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [FAKE_PROVIDER_ENTRYPOINT, ...HOST_ARGS],
    env: { ...process.env, HOME: home, SYNAPHEX_TEST_CODER_EDIT: "1" },
    stderr: "pipe",
  });
  const client = new Client({ name: "coder-smoke", version: "0.0.0" });
  try {
    await client.connect(transport);
    const projectId = (
      (
        await client.callTool({
          name: "synaphex_register_project",
          arguments: { name: "Coder Project", sourcePath },
        })
      ).structuredContent as { id: string }
    ).id;
    const taskId = (
      (
        await client.callTool({
          name: "synaphex_create_task",
          arguments: { projectId, description: "Implement the feature" },
        })
      ).structuredContent as { id: string }
    ).id;
    const sessionId = (
      (
        await client.callTool({
          name: "synaphex_open_task_session",
          arguments: { projectId, taskId },
        })
      ).structuredContent as { sessionId: string }
    ).sessionId;

    const invoked = await client.callTool({
      name: "synaphex_invoke_agent",
      arguments: {
        agent: "coder",
        scope: { kind: "task_session", sessionId },
        instruction: "Implement it.",
      },
    });
    assert.notEqual(invoked.isError, true, JSON.stringify(invoked.content));
    const payload = invoked.structuredContent as {
      agent: string;
      executionPolicy: { sourceModification: string };
      changeSet?: {
        id: string;
        baseCommit: string;
        patchHash: string;
        patchBytes: number;
        changedFiles: { path: string }[];
      } | null;
    };
    assert.equal(payload.agent, "coder");
    // CODER keeps workspace_write; it applies to the staging clone.
    assert.equal(payload.executionPolicy.sourceModification, "workspace_write");
    // The result carries the change-set SUMMARY, never the patch itself.
    assert.notEqual(payload.changeSet, null);
    assert.match(payload.changeSet!.id, /^changeset_/);
    assert.equal(payload.changeSet!.baseCommit, headBefore);
    assert.ok(payload.changeSet!.patchBytes > 0);
    assert.deepEqual(
      payload.changeSet!.changedFiles.map((file) => file.path).sort(),
      ["app.txt", "coder-new.txt"],
    );
    const serialized = JSON.stringify(invoked);
    for (const forbidden of [
      "synaphex-coder-staging",
      "ownershipToken",
      "isolatedHome",
      "GIT binary patch",
      "@@ -",
    ]) {
      assert.equal(serialized.includes(forbidden), false, `leaked ${forbidden}`);
    }

    // The REAL source is unchanged.
    assert.equal(
      spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: sourcePath,
        env: gitEnv,
        encoding: "utf8",
      }).stdout.trim(),
      headBefore,
    );
    assert.equal(
      spawnSync("git", ["status", "--porcelain"], {
        cwd: sourcePath,
        env: gitEnv,
        encoding: "utf8",
      }).stdout.trim(),
      "",
    );
    assert.equal(
      await readFile(join(sourcePath, "app.txt"), "utf8"),
      "original\n",
    );
    assert.equal((await readdir(sourcePath)).includes("coder-new.txt"), false);

    // REVIEWER is blocked while the change set is staged and unapplied.
    await new AgentConfigManager(store).setConfigured("reviewer", {
      provider: "openai",
      surface: "cli",
      model: "reviewer-model",
    });
    const reviewed = await client.callTool({
      name: "synaphex_invoke_agent",
      arguments: {
        agent: "reviewer",
        scope: { kind: "task_session", sessionId },
        instruction: "Review it.",
      },
    });
    assert.equal(reviewed.isError, true);
    assert.equal(
      (reviewed.structuredContent as { code: string }).code,
      "REVIEW_TARGET_NOT_APPLIED",
    );
    // The task stays active: no PASS could complete it on unchanged source.
    const task = await client.callTool({
      name: "synaphex_get_task",
      arguments: { projectId, taskId },
    });
    assert.equal(
      (task.structuredContent as { status: string }).status,
      "active",
    );
  } finally {
    await client.close();
  }
});
