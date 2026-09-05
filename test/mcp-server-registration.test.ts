import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import {
  SYNAPHEX_MCP_CONTINUATION_TOOLS,
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
    assert.equal(names.length, 31);
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
      // mutation (complete/archive became legitimate in Phase 6A and are
      // asserted separately by the lifecycle audit below)
      "synaphex_bind_task",
      "synaphex_delete_project",
      "synaphex_reopen_task",
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
      const mutates = tool.annotations?.readOnlyHint !== true;
      const continuationTool = (
        SYNAPHEX_MCP_CONTINUATION_TOOLS as readonly string[]
      ).includes(tool.name);
      const invocationLike = tool.name === "synaphex_invoke_agent" || continuationTool;
      // Read tools claim readOnlyHint; everything else must not. Reading a
      // change-set patch is a genuine read: it returns already-persisted
      // bytes and touches neither the source workspace nor task state.
      const readOnly =
        tool.name.startsWith("synaphex_get_") ||
        tool.name === "synaphex_read_change_set_patch";
      assert.equal(readOnly, !mutates, `${tool.name} readOnlyHint`);
      // Non-idempotent: open mints a new SessionId; invocation and every
      // continuation step consume provider quota and a one-time transition.
      // Non-idempotent: anything that mints a new id (project, task,
      // session) and anything that consumes provider quota or a one-time
      // continuation transition. Only reads and close_session are idempotent.
      const nonIdempotent = [
        "synaphex_accept_plan_draft",
        "synaphex_reject_plan_draft",
        "synaphex_register_project",
        "synaphex_create_task",
        "synaphex_open_project_session",
        "synaphex_open_task_session",
        // Applying mutates the source workspace; rejecting is a one-time
        // terminal decision for that exact change-set instance.
        "synaphex_apply_change_set",
        "synaphex_reject_change_set",
        // Reconciliation mints terminal applied authority or returns a change
        // set to pending; it is a one-time transition, not a repeatable read.
        "synaphex_reconcile_interrupted_apply",
        // A second call raises INVALID_TASK_TRANSITION rather than succeeding.
        "synaphex_complete_task",
        "synaphex_archive_task",
        // A repeated load raises MEMORY_ALREADY_LOADED and a repeated unload
        // raises MEMORY_NOT_LOADED, so neither is a repeatable no-op.
        "synaphex_load_memory",
        "synaphex_unload_memory",
      ];
      assert.equal(
        tool.annotations?.idempotentHint,
        !nonIdempotent.includes(tool.name) && !invocationLike,
        `${tool.name} idempotentHint`,
      );
      // Destructive: force release (terminates another session's ownership),
      // agent invocation (Reviewer completion / memory replacement), and the
      // two APPROVAL tools (they grant previously-unapproved execution).
      assert.equal(
        tool.annotations?.destructiveHint,
        [
          "synaphex_force_release_task_session",
          "synaphex_invoke_agent",
          "synaphex_approve_and_execute_helper",
          "synaphex_approve_network_action",
          // Plan decisions change authoritative plan state: acceptance
          // archives/replaces current, rejection deletes the draft.
          "synaphex_accept_plan_draft",
          "synaphex_reject_plan_draft",
          // Apply mutates the registered source workspace; reject is an
          // irreversible decision for that exact change set.
          "synaphex_apply_change_set",
          "synaphex_reject_change_set",
          "synaphex_reconcile_interrupted_apply",
          // Lifecycle transitions are irreversible: there is no reopen.
          "synaphex_complete_task",
          "synaphex_archive_task",
        ].includes(tool.name),
        `${tool.name} destructiveHint`,
      );
      // Agent invocation and every continuation step reach an external
      // provider/model.
      assert.equal(
        tool.annotations?.openWorldHint,
        invocationLike,
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
    memoryReferences: {
      loadMemory: async () => {
        throw new Error("memory references are not exercised in this fixture");
      },
      unloadMemory: async () => {
        throw new Error("memory references are not exercised in this fixture");
      },
      listLoadedMemory: async () => [],
    },
    sessionCommands: reads.sessionCommands,
    sessionRecovery: reads.sessionRecovery,
    agentInvocation: reads.agentInvocation,
    agentContinuation: reads.agentContinuation,
    planCommands: reads.planCommands,
    changeSetCommands: reads.changeSetCommands,
    taskLifecycleCommands: reads.taskLifecycleCommands,
    projectTaskCommands: reads.projectTaskCommands,
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


test("the task lifecycle is one-way: no reopen or un-archive tool exists", async () => {
  const { client, close } = await connectedClient();
  try {
    const tools = (await client.listTools()).tools;
    const names = new Set(tools.map((tool) => tool.name));
    // The two legitimate lifecycle transitions.
    assert.equal(names.has("synaphex_complete_task"), true);
    assert.equal(names.has("synaphex_archive_task"), true);
    // Nothing may move a task backwards.
    for (const forbidden of [
      "synaphex_reopen_task",
      "synaphex_unarchive_task",
      "synaphex_restore_task",
      "synaphex_activate_task",
      "synaphex_uncomplete_task",
      "synaphex_set_task_status",
      "synaphex_delete_task",
    ]) {
      assert.equal(names.has(forbidden), false, `${forbidden} must not exist`);
    }
    // And no tool accepts a status/force field that could smuggle a reversal.
    for (const tool of tools) {
      const properties = Object.keys(
        (tool.inputSchema as { properties?: Record<string, unknown> })
          .properties ?? {},
      );
      for (const forbidden of ["status", "force", "reopen", "archived", "completed"]) {
        assert.equal(
          properties.includes(forbidden),
          false,
          `${tool.name} must not accept a ${forbidden} field`,
        );
      }
    }
    // The completion tool's ONLY authority is the session id.
    const complete = tools.find((t) => t.name === "synaphex_complete_task");
    assert.deepEqual(
      Object.keys(
        (complete?.inputSchema as { properties?: Record<string, unknown> })
          .properties ?? {},
      ),
      ["sessionId"],
    );
    // Archive is addressed administratively, and cannot be handed a session to
    // force-close.
    const archive = tools.find((t) => t.name === "synaphex_archive_task");
    assert.deepEqual(
      Object.keys(
        (archive?.inputSchema as { properties?: Record<string, unknown> })
          .properties ?? {},
      ),
      ["projectId", "taskId"],
    );
  } finally {
    await close();
  }
});
