import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidSessionIdError,
  TaskAlreadyBoundError,
  TaskCompletedError,
} from "../src/domain/errors.js";
import type { TaskId } from "../src/domain/task.js";
import {
  FAKE_PROJECT,
  FAKE_TASK,
  connectedClient,
  fakeReadDependencies,
  type FakeReads,
} from "./fixtures/mcp-read-fixtures.js";

interface ToolOutcome {
  readonly structured: Record<string, unknown>;
  readonly isError: boolean;
  readonly text: string;
}

async function call(
  reads: FakeReads,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const { client, close } = await connectedClient(reads);
  try {
    const result = await client.callTool({ name, arguments: args });
    const content = (result.content ?? []) as { type: string; text?: string }[];
    return {
      structured: (result.structuredContent ?? {}) as Record<string, unknown>,
      isError: result.isError === true,
      text: content.map((block) => block.text ?? "").join("\n"),
    };
  } finally {
    await close();
  }
}

test("open_task_session delegates to the narrow command port and returns the binding", async () => {
  const reads = fakeReadDependencies();
  const outcome = await call(reads, "synaphex_open_task_session", {
    projectId: FAKE_PROJECT.id,
    taskId: FAKE_TASK.id,
  });
  assert.equal(outcome.isError, false);
  assert.deepEqual(outcome.structured, {
    sessionId: "ses_00000000000000000000000000000001",
    projectId: FAKE_PROJECT.id,
    taskId: FAKE_TASK.id,
    bound: true,
  });
  // Exactly one call, to the session command boundary -- not to a manager.
  assert.deepEqual(reads.calls, [
    {
      port: "sessionCommands.openTaskSession",
      args: [FAKE_PROJECT.id, FAKE_TASK.id],
    },
  ]);
});

test("close_task_session reports a real release and leaves no binding", async () => {
  const reads = fakeReadDependencies();
  const sessionId = "ses_00000000000000000000000000000001";
  const outcome = await call(reads, "synaphex_close_task_session", {
    sessionId,
  });
  assert.equal(outcome.isError, false);
  assert.deepEqual(outcome.structured, {
    sessionId,
    released: true,
    releasedTaskId: FAKE_TASK.id,
    bound: false,
  });
  assert.deepEqual(reads.calls, [
    { port: "sessionCommands.closeTaskSession", args: [sessionId] },
  ]);
});

test("close_task_session never fabricates a release when nothing changed", async () => {
  const reads = fakeReadDependencies();
  const sessionId = "ses_00000000000000000000000000000002";
  reads.closeResult = { sessionId, released: false, releasedTaskId: null };
  const outcome = await call(reads, "synaphex_close_task_session", {
    sessionId,
  });
  assert.equal(outcome.isError, false);
  assert.deepEqual(outcome.structured, {
    sessionId,
    released: false,
    releasedTaskId: null,
    bound: false,
  });
});

test("malformed session ids never reach the command service", async () => {
  for (const sessionId of [
    "",
    "../../etc/passwd",
    "has space",
    "semi;colon",
    "a".repeat(201),
  ]) {
    const reads = fakeReadDependencies();
    const outcome = await call(reads, "synaphex_close_task_session", {
      sessionId,
    });
    assert.equal(outcome.isError, true, JSON.stringify(sessionId));
    assert.equal(outcome.structured.code, "INVALID_SESSION_ID");
    assert.deepEqual(reads.calls, [], "no command may be reached");
  }
});

test("malformed project and task ids never reach the command service", async () => {
  const cases: readonly [Record<string, unknown>, string][] = [
    [{ projectId: "nope", taskId: FAKE_TASK.id }, "INVALID_PROJECT_ID"],
    [{ projectId: FAKE_PROJECT.id, taskId: "task_" }, "INVALID_TASK_ID"],
    [
      { projectId: "prj_../escape", taskId: FAKE_TASK.id },
      "INVALID_PROJECT_ID",
    ],
  ];
  for (const [args, expectedCode] of cases) {
    const reads = fakeReadDependencies();
    const outcome = await call(reads, "synaphex_open_task_session", args);
    assert.equal(outcome.isError, true, JSON.stringify(args));
    assert.equal(outcome.structured.code, expectedCode);
    assert.deepEqual(reads.calls, []);
  }
});

test("the one-writable-session conflict surfaces as TASK_ALREADY_BOUND", async () => {
  const reads = fakeReadDependencies();
  reads.openError = new TaskAlreadyBoundError(
    FAKE_TASK.id,
    "ses_00000000000000000000000000000009",
  );
  const outcome = await call(reads, "synaphex_open_task_session", {
    projectId: FAKE_PROJECT.id,
    taskId: FAKE_TASK.id,
  });
  assert.equal(outcome.isError, true);
  assert.deepEqual(outcome.structured, {
    code: "TASK_ALREADY_BOUND",
    message: "Task is already bound to another writable session.",
  });
  // The owning session id is an internal detail and must not be disclosed.
  assert.equal(outcome.text.includes("ses_00000000000000000000000000000009"), false);
});

test("lifecycle refusals and session id failures map to their Core codes", async () => {
  const completed = fakeReadDependencies();
  completed.openError = new TaskCompletedError(FAKE_TASK.id);
  const completedOutcome = await call(completed, "synaphex_open_task_session", {
    projectId: FAKE_PROJECT.id,
    taskId: FAKE_TASK.id,
  });
  assert.deepEqual(completedOutcome.structured, {
    code: "TASK_COMPLETED",
    message: "Task is completed and cannot be opened.",
  });

  const invalid = fakeReadDependencies();
  invalid.closeError = new InvalidSessionIdError("from core");
  const invalidOutcome = await call(invalid, "synaphex_close_task_session", {
    sessionId: "ses_00000000000000000000000000000001",
  });
  assert.deepEqual(invalidOutcome.structured, {
    code: "INVALID_SESSION_ID",
    message: "Invalid session id.",
  });
});

test("an unexpected command failure leaks no internals", async () => {
  const reads = fakeReadDependencies();
  reads.openError = new Error("ENOENT: /home/user/.synaphex/state/secret.json");
  const outcome = await call(reads, "synaphex_open_task_session", {
    projectId: FAKE_PROJECT.id,
    taskId: FAKE_TASK.id,
  });
  assert.deepEqual(outcome.structured, {
    code: "INTERNAL_ERROR",
    message: "Internal Synaphex error.",
  });
  const serialized = `${outcome.text}${JSON.stringify(outcome.structured)}`;
  assert.equal(serialized.includes("secret.json"), false);
  assert.equal(serialized.includes("ENOENT"), false);
  assert.equal(serialized.includes("at "), false, "no stack frames");
});

test("a half-open binding is refused rather than reported as bound", async () => {
  // Core guarantees a bound result on success; if that ever regressed, MCP must
  // not claim `bound: true` for a session with no task claim.
  const reads = fakeReadDependencies();
  reads.openResult = {
    sessionId: "ses_00000000000000000000000000000001",
    projectId: FAKE_PROJECT.id,
    taskId: null as unknown as TaskId,
  };
  const outcome = await call(reads, "synaphex_open_task_session", {
    projectId: FAKE_PROJECT.id,
    taskId: FAKE_TASK.id,
  });
  assert.equal(outcome.isError, true);
  assert.equal(outcome.structured.code, "INTERNAL_ERROR");
});

test("opening a session round-trips through get_session", async () => {
  const reads = fakeReadDependencies();
  const { client, close } = await connectedClient(reads);
  try {
    const opened = await client.callTool({
      name: "synaphex_open_task_session",
      arguments: { projectId: FAKE_PROJECT.id, taskId: FAKE_TASK.id },
    });
    const sessionId = (opened.structuredContent as { sessionId: string })
      .sessionId;
    // The read side observes the same binding for the returned id.
    reads.sessionBinding = {
      sessionId,
      projectId: FAKE_PROJECT.id,
      taskId: FAKE_TASK.id,
    };
    const looked = await client.callTool({
      name: "synaphex_get_session",
      arguments: { sessionId },
    });
    assert.deepEqual(looked.structuredContent, {
      sessionId,
      bound: true,
      projectId: FAKE_PROJECT.id,
      taskId: FAKE_TASK.id,
    });
  } finally {
    await close();
  }
});

test("an MCP disconnect never closes the logical Synaphex session", async () => {
  // Session lifetime is explicit and domain-owned. Transport teardown must not
  // call closeTaskSession, and must not mutate state in any way.
  const reads = fakeReadDependencies();
  const { client, close } = await connectedClient(reads);
  await client.callTool({
    name: "synaphex_open_task_session",
    arguments: { projectId: FAKE_PROJECT.id, taskId: FAKE_TASK.id },
  });
  const callsBeforeDisconnect = reads.calls.length;

  await close();

  assert.equal(
    reads.calls.length,
    callsBeforeDisconnect,
    "disconnect must issue no further commands",
  );
  assert.equal(
    reads.calls.some((c) => c.port === "sessionCommands.closeTaskSession"),
    false,
    "disconnect must not close the session",
  );
});

test("connecting and listing tools mutates nothing", async () => {
  // MCP initialization stays read-only: no session is created merely because a
  // provider host connected.
  const reads = fakeReadDependencies();
  const { client, close } = await connectedClient(reads);
  try {
    await client.listTools();
  } finally {
    await close();
  }
  assert.deepEqual(reads.calls, []);
});

// --- Phase 2B recovery tools ----------------------------------------------

test("get_task_session_owner delegates to the recovery port and reports the owner", async () => {
  const claimed = fakeReadDependencies();
  const claimedOutcome = await call(claimed, "synaphex_get_task_session_owner", {
    projectId: FAKE_PROJECT.id,
    taskId: FAKE_TASK.id,
  });
  assert.equal(claimedOutcome.isError, false);
  assert.deepEqual(claimedOutcome.structured, {
    projectId: FAKE_PROJECT.id,
    taskId: FAKE_TASK.id,
    claimed: true,
    sessionId: "ses_00000000000000000000000000000001",
  });
  assert.deepEqual(claimed.calls, [
    {
      port: "sessionRecovery.getTaskSessionOwner",
      args: [FAKE_PROJECT.id, FAKE_TASK.id],
    },
  ]);

  const unclaimed = fakeReadDependencies();
  unclaimed.ownerResult = {
    projectId: FAKE_PROJECT.id,
    taskId: FAKE_TASK.id,
    claimed: false,
  };
  const unclaimedOutcome = await call(
    unclaimed,
    "synaphex_get_task_session_owner",
    { projectId: FAKE_PROJECT.id, taskId: FAKE_TASK.id },
  );
  assert.deepEqual(unclaimedOutcome.structured, {
    projectId: FAKE_PROJECT.id,
    taskId: FAKE_TASK.id,
    claimed: false,
    sessionId: null,
  });
});

test("force_release_task_session needs no sessionId and reports honestly", async () => {
  const released = fakeReadDependencies();
  const releasedOutcome = await call(
    released,
    "synaphex_force_release_task_session",
    { projectId: FAKE_PROJECT.id, taskId: FAKE_TASK.id },
  );
  assert.equal(releasedOutcome.isError, false);
  assert.deepEqual(releasedOutcome.structured, {
    projectId: FAKE_PROJECT.id,
    taskId: FAKE_TASK.id,
    released: true,
    previousSessionId: "ses_00000000000000000000000000000001",
  });
  assert.deepEqual(released.calls, [
    {
      port: "sessionRecovery.forceReleaseTaskSession",
      args: [FAKE_PROJECT.id, FAKE_TASK.id],
    },
  ]);

  // An unclaimed task is a successful no-op, not an error.
  const noop = fakeReadDependencies();
  noop.forceReleaseResult = {
    taskId: FAKE_TASK.id,
    released: false,
    previousSessionId: null,
  };
  const noopOutcome = await call(noop, "synaphex_force_release_task_session", {
    projectId: FAKE_PROJECT.id,
    taskId: FAKE_TASK.id,
  });
  assert.equal(noopOutcome.isError, false);
  assert.deepEqual(noopOutcome.structured, {
    projectId: FAKE_PROJECT.id,
    taskId: FAKE_TASK.id,
    released: false,
    previousSessionId: null,
  });
});

test("the force-release tool takes no meaningless force flag", async () => {
  const { client, close } = await connectedClient();
  try {
    const tool = (await client.listTools()).tools.find(
      (candidate) => candidate.name === "synaphex_force_release_task_session",
    );
    const properties = Object.keys(
      (tool?.inputSchema as { properties?: Record<string, unknown> })
        ?.properties ?? {},
    ).sort();
    assert.deepEqual(properties, ["projectId", "taskId"]);
  } finally {
    await close();
  }
});

test("malformed ids never reach the recovery services", async () => {
  for (const toolName of [
    "synaphex_get_task_session_owner",
    "synaphex_force_release_task_session",
  ]) {
    for (const args of [
      { projectId: "nope", taskId: FAKE_TASK.id },
      { projectId: FAKE_PROJECT.id, taskId: "task_" },
      { projectId: "prj_../escape", taskId: FAKE_TASK.id },
    ]) {
      const reads = fakeReadDependencies();
      const outcome = await call(reads, toolName, args);
      assert.equal(outcome.isError, true, `${toolName} ${JSON.stringify(args)}`);
      assert.deepEqual(reads.calls, [], "no recovery service may be reached");
    }
  }
});

test("recovery failures map safely and leak no internals", async () => {
  const reads = fakeReadDependencies();
  reads.forceReleaseError = new Error(
    "EACCES: /home/user/.synaphex/state/task-bindings/secret.json",
  );
  const outcome = await call(reads, "synaphex_force_release_task_session", {
    projectId: FAKE_PROJECT.id,
    taskId: FAKE_TASK.id,
  });
  assert.deepEqual(outcome.structured, {
    code: "INTERNAL_ERROR",
    message: "Internal Synaphex error.",
  });
  const serialized = `${outcome.text}${JSON.stringify(outcome.structured)}`;
  assert.equal(serialized.includes("secret.json"), false);
  assert.equal(serialized.includes("EACCES"), false);
});

test("an MCP disconnect never force-releases a task claim", async () => {
  // Recovery is explicit and user-driven: transport teardown must never invoke
  // it, and must not touch the recovery port at all.
  const reads = fakeReadDependencies();
  const { client, close } = await connectedClient(reads);
  await client.callTool({
    name: "synaphex_open_task_session",
    arguments: { projectId: FAKE_PROJECT.id, taskId: FAKE_TASK.id },
  });
  const before = reads.calls.length;

  await close();

  assert.equal(reads.calls.length, before, "disconnect issues no commands");
  assert.equal(
    reads.calls.some((c) => c.port.startsWith("sessionRecovery.")),
    false,
    "disconnect must never reach recovery",
  );
});
