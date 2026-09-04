import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { ProjectManager } from "../src/core/project-manager.js";
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
    args: [ENTRYPOINT],
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
      "synaphex_close_task_session",
      "synaphex_force_release_task_session",
      "synaphex_get_agent_config",
      "synaphex_get_effective_rules",
      "synaphex_get_project",
      "synaphex_get_session",
      "synaphex_get_task",
      "synaphex_get_task_session_owner",
      "synaphex_open_task_session",
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
      name: "synaphex_close_task_session",
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
      name: "synaphex_close_task_session",
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
    args: [ENTRYPOINT],
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
      name: "synaphex_close_task_session",
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
  const child = spawn(process.execPath, [ENTRYPOINT], {
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
