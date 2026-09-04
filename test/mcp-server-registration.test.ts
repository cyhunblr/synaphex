import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import {
  SYNAPHEX_MCP_PHASE1_TOOLS,
  SYNAPHEX_MCP_SERVER_NAME,
  SYNAPHEX_MCP_SESSION_TOOLS,
  SYNAPHEX_MCP_TOOLS,
  createSynaphexMcpServer,
} from "../src/mcp/create-synaphex-mcp-server.js";
import {
  connectedClient,
  fakeReadDependencies,
  type FakeReads,
} from "./fixtures/mcp-read-fixtures.js";

test("the server registers exactly the accepted tool surface", async () => {
  const { client, close } = await connectedClient();
  try {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [...SYNAPHEX_MCP_TOOLS].sort());
    // Phase-1 read tools all remain operational.
    for (const phase1Tool of SYNAPHEX_MCP_PHASE1_TOOLS) {
      assert.ok(names.includes(phase1Tool), `${phase1Tool} must remain`);
    }
    assert.equal(names.length, 9);
  } finally {
    await close();
  }
});

test("no mutation, invocation, approval or filesystem tool is registered", async () => {
  const { client, close } = await connectedClient();
  try {
    const names = new Set((await client.listTools()).tools.map((t) => t.name));
    for (const forbidden of [
      // agent invocation (a later phase, deliberately not flattened here)
      "synaphex_invoke_questioner",
      "synaphex_invoke_researcher",
      "synaphex_invoke_examiner",
      "synaphex_invoke_planner",
      "synaphex_invoke_coder",
      "synaphex_invoke_reviewer",
      // mutation
      "synaphex_create_project",
      "synaphex_create_task",
      "synaphex_complete_task",
      "synaphex_archive_task",
      "synaphex_bind_task",
      "synaphex_unbind_task",
      "synaphex_set_rule",
      "synaphex_accept_plan",
      "synaphex_write_memory",
      "synaphex_create_artifact",
      // approvals and host actions
      "synaphex_approve_action",
      "synaphex_git_push",
      "synaphex_run_ci",
      // generic filesystem / shell
      "read_file",
      "list_directory",
      "read_synaphex_file",
      "read_provider_config",
    ]) {
      assert.equal(names.has(forbidden), false, `${forbidden} must not exist`);
    }
  } finally {
    await close();
  }
});

test("annotations describe each tool honestly and are closed-world throughout", async () => {
  const { client, close } = await connectedClient();
  try {
    for (const tool of (await client.listTools()).tools) {
      const mutates =
        tool.name === "synaphex_open_task_session" ||
        tool.name === "synaphex_close_task_session" ||
        tool.name === "synaphex_force_release_task_session";
      // Mutating tools must NOT claim readOnlyHint.
      assert.equal(
        tool.annotations?.readOnlyHint,
        !mutates,
        `${tool.name} readOnlyHint`,
      );
      // Only open is non-idempotent: it mints a new SessionId each call.
      assert.equal(
        tool.annotations?.idempotentHint,
        tool.name !== "synaphex_open_task_session",
        `${tool.name} idempotentHint`,
      );
      // Only force release is destructive: it terminates another session's
      // ownership and deletes that session's binding record.
      assert.equal(
        tool.annotations?.destructiveHint,
        tool.name === "synaphex_force_release_task_session",
        `${tool.name} destructiveHint`,
      );
      assert.equal(
        tool.annotations?.openWorldHint,
        false,
        `${tool.name} openWorldHint`,
      );
    }
  } finally {
    await close();
  }
});

test("server identity uses the package name and the injected package version", async () => {
  const reads: FakeReads = fakeReadDependencies();
  const server = createSynaphexMcpServer({
    ...reads.ports,
    sessionCommands: reads.sessionCommands,
    sessionRecovery: reads.sessionRecovery,
    version: "9.9.9-test",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const info = client.getServerVersion();
    assert.equal(info?.name, SYNAPHEX_MCP_SERVER_NAME);
    assert.equal(info?.name, "synaphex");
    assert.equal(info?.version, "9.9.9-test");
  } finally {
    await client.close();
    await server.close();
  }
});
