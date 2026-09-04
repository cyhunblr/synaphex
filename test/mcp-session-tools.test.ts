import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentExecutionFailedError,
  InvalidSessionIdError,
  TaskAlreadyBoundError,
  ProjectPathAlreadyRegisteredError,
  TaskCompletedError,
  TaskSessionOwnershipLostError,
} from "../src/domain/errors.js";
import type { TaskId } from "../src/domain/task.js";
import {
  FAKE_PROJECT,
  FAKE_TASK,
  connectedClient,
  defaultInvocationResult,
  fakeReadDependencies,
  type FakeReads,
} from "./fixtures/mcp-read-fixtures.js";
import {
  ContinuationCapacityError,
  ContinuationNotFoundError,
  ContinuationStateError,
} from "../src/operations/invocation-continuation-store.js";

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

test("close_session reports a real release and leaves no binding", async () => {
  const reads = fakeReadDependencies();
  const sessionId = "ses_00000000000000000000000000000001";
  const outcome = await call(reads, "synaphex_close_session", {
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
    { port: "sessionCommands.closeSession", args: [sessionId] },
  ]);
});

test("close_session never fabricates a release when nothing changed", async () => {
  const reads = fakeReadDependencies();
  const sessionId = "ses_00000000000000000000000000000002";
  reads.closeResult = { sessionId, released: false, releasedTaskId: null };
  const outcome = await call(reads, "synaphex_close_session", {
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
    const outcome = await call(reads, "synaphex_close_session", {
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
  const invalidOutcome = await call(invalid, "synaphex_close_session", {
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
  // call closeSession, and must not mutate state in any way.
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
    reads.calls.some((c) => c.port === "sessionCommands.closeSession"),
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

// --- Phase 3A: agent invocation tool --------------------------------------

test("invoke_agent delegates to the narrow invocation port and returns a safe result", async () => {
  const reads = fakeReadDependencies();
  const outcome = await call(reads, "synaphex_invoke_agent", {
    agent: "researcher",
    scope: { kind: "task_session", sessionId: "ses_00000000000000000000000000000001" },
    instruction: "Research the fencing behavior.",
  });
  assert.equal(outcome.isError, false, outcome.text);
  assert.equal(outcome.structured.agent, "researcher");
  assert.equal(outcome.structured.outcome, "success");
  assert.deepEqual(outcome.structured.scope, {
    sessionId: "ses_00000000000000000000000000000001",
    projectId: FAKE_PROJECT.id,
    taskId: FAKE_TASK.id,
  });
  // No continuation handle when nothing is actionable.
  assert.equal(outcome.structured.continuationId, null);
  assert.deepEqual(reads.calls, [
    {
      port: "agentInvocation.invoke",
      args: [
        {
          agent: "researcher",
          scope: {
            kind: "task_session",
            sessionId: "ses_00000000000000000000000000000001",
          },
          instruction: "Research the fencing behavior.",
        },
      ],
    },
    {
      port: "agentContinuation.issueFor",
      args: ["ses_00000000000000000000000000000001", "researcher"],
    },
  ]);
});

test("CODER is now accepted by the wire schema and reaches the invocation port", async () => {
  // Phase 5B: staged CODER is a legitimate direct-user invocation.
  const reads = fakeReadDependencies();
  const outcome = await call(reads, "synaphex_invoke_agent", {
    agent: "coder",
    scope: { kind: "task_session", sessionId: "ses_00000000000000000000000000000001" },
    instruction: "Write the code.",
  });
  assert.equal(outcome.isError, false, outcome.text);
  assert.equal(reads.calls[0]?.port, "agentInvocation.invoke");
});

test("an agent outside the direct enum is still rejected by the schema", async () => {
  const reads = fakeReadDependencies();
  const outcome = await call(reads, "synaphex_invoke_agent", {
    agent: "orchestrator",
    scope: { kind: "task_session", sessionId: "ses_00000000000000000000000000000001" },
    instruction: "Not an agent.",
  });
  assert.equal(outcome.isError, true);
  assert.match(outcome.text, /Invalid option/);
  assert.deepEqual(reads.calls, []);
});

test("no hidden flag can enable an unknown agent or override the entrypoint", async () => {
  for (const extra of [
    { allowCoder: true },
    { unsafe: true },
    { force: true },
    { directUser: false },
    { caller: "planner" },
    { hostProvider: "google", hostSurface: "cli" },
  ]) {
    const reads = fakeReadDependencies();
    const outcome = await call(reads, "synaphex_invoke_agent", {
      agent: "orchestrator",
      scope: {
        kind: "task_session",
        sessionId: "ses_00000000000000000000000000000001",
      },
      instruction: "Not an agent.",
      ...extra,
    });
    assert.equal(outcome.isError, true, JSON.stringify(extra));
    assert.deepEqual(reads.calls, []);
  }
});

test("the invocation schema exposes no host or caller override field", async () => {
  const { client, close } = await connectedClient();
  try {
    const tool = (await client.listTools()).tools.find(
      (candidate) => candidate.name === "synaphex_invoke_agent",
    );
    const properties = Object.keys(
      (tool?.inputSchema as { properties?: Record<string, unknown> })
        ?.properties ?? {},
    ).sort();
    assert.deepEqual(properties, ["agent", "instruction", "scope"]);
  } finally {
    await close();
  }
});

test("malformed invocation input never reaches the invocation port", async () => {
  const cases: readonly Record<string, unknown>[] = [
    { agent: "researcher", scope: { kind: "task_session", sessionId: "" }, instruction: "x" },
    {
      agent: "researcher",
      scope: { kind: "task_session", sessionId: "../../etc/passwd" },
      instruction: "x",
    },
    { agent: "researcher", scope: { kind: "bogus", sessionId: "ses_1" }, instruction: "x" },
    {
      agent: "researcher",
      scope: { kind: "task_session", sessionId: "ses_00000000000000000000000000000001" },
      instruction: "",
    },
    {
      agent: "researcher",
      scope: { kind: "task_session", sessionId: "ses_00000000000000000000000000000001" },
      instruction: "x".repeat(8_001),
    },
  ];
  for (const args of cases) {
    const reads = fakeReadDependencies();
    const outcome = await call(reads, "synaphex_invoke_agent", args);
    assert.equal(outcome.isError, true, JSON.stringify(args).slice(0, 80));
    assert.deepEqual(reads.calls, []);
  }
});

test("helper and action classifications are returned without execution", async () => {
  const reads = fakeReadDependencies();
  const base = defaultInvocationResult({
    agent: "researcher",
    scope: {
      kind: "task_session",
      sessionId: "ses_00000000000000000000000000000001",
    },
    instruction: "x",
  });
  reads.invokeResult = {
    ...base,
    helperCalls: [
      {
        status: "denied",
        request: {
          target: "examiner",
          purpose: "memory_update",
          handoff: {
            caller: "researcher",
            target: "examiner",
            purpose: "memory_update",
            summary: "Record it.",
          },
        },
        immutableReason: "no_immutable_restriction",
        effectiveRule: {
          key: { kind: "agent_call", caller: "researcher", target: "examiner" },
          decision: "deny",
          source: "global",
        },
      },
    ],
    actionClassifications: [
      {
        status: "approval_required",
        request: { action: "network", reason: "Needs research." },
        executionKind: "provider_capability",
        effectiveRule: {
          key: { kind: "action", action: "network" },
          decision: "ask",
          source: "project",
        },
      },
    ],
  };
  const outcome = await call(reads, "synaphex_invoke_agent", {
    agent: "researcher",
    scope: { kind: "task_session", sessionId: "ses_00000000000000000000000000000001" },
    instruction: "Research it.",
  });
  assert.equal(outcome.isError, false, outcome.text);
  assert.deepEqual(outcome.structured.requestedCalls, [
    {
      target: "examiner",
      purpose: "memory_update",
      status: "denied",
      immutableReason: "no_immutable_restriction",
      ruleDecision: "deny",
      ruleSource: "global",
      errorCode: null,
    },
  ]);
  assert.deepEqual(outcome.structured.requestedActions, [
    {
      action: "network",
      status: "approval_required",
      executionKind: "provider_capability",
      ruleDecision: "ask",
      ruleSource: "project",
      errorCode: null,
    },
  ]);
  // Only the invocation plus continuation issuance: nothing was auto-executed
  // or auto-approved.
  assert.deepEqual(
    reads.calls.map((call) => call.port),
    ["agentInvocation.invoke", "agentContinuation.issueFor"],
  );
});

test("ownership loss maps to its stable code without exposing the replacement owner", async () => {
  const reads = fakeReadDependencies();
  reads.invokeError = new TaskSessionOwnershipLostError(
    FAKE_TASK.id,
    "ses_00000000000000000000000000000009",
    "commit",
  );
  const outcome = await call(reads, "synaphex_invoke_agent", {
    agent: "researcher",
    scope: { kind: "task_session", sessionId: "ses_00000000000000000000000000000001" },
    instruction: "Research it.",
  });
  assert.equal(outcome.isError, true);
  assert.equal(outcome.structured.code, "TASK_SESSION_OWNERSHIP_LOST");
  assert.notEqual(outcome.structured.code, "INTERNAL_ERROR");
  const serialized = `${outcome.text}${JSON.stringify(outcome.structured)}`;
  assert.equal(serialized.includes("ses_00000000000000000000000000000009"), false);
});

test("a provider execution failure exposes no CLI internals", async () => {
  const reads = fakeReadDependencies();
  reads.invokeError = new AgentExecutionFailedError("researcher", "openai", "cli", {
    cause: new Error("codex exited 1: /home/user/.codex/auth.json unreadable"),
  });
  const outcome = await call(reads, "synaphex_invoke_agent", {
    agent: "researcher",
    scope: { kind: "task_session", sessionId: "ses_00000000000000000000000000000001" },
    instruction: "Research it.",
  });
  assert.equal(outcome.isError, true);
  const serialized = `${outcome.text}${JSON.stringify(outcome.structured)}`;
  for (const secret of ["auth.json", ".codex", "exited 1", "at "]) {
    assert.equal(serialized.includes(secret), false, `leaked ${secret}`);
  }
});

test("no invocation result or transcript carries an ownership token", async () => {
  const reads = fakeReadDependencies();
  const base = defaultInvocationResult({
    agent: "researcher",
    scope: {
      kind: "task_session",
      sessionId: "ses_00000000000000000000000000000001",
    },
    instruction: "x",
  });
  // Plant a token where a careless presenter might forward it.
  reads.invokeResult = {
    ...base,
    ownershipToken: "deadbeefdeadbeefdeadbeefdeadbeef",
    ownershipFence: {
      ownershipToken: "deadbeefdeadbeefdeadbeefdeadbeef",
    },
  };
  const outcome = await call(reads, "synaphex_invoke_agent", {
    agent: "researcher",
    scope: { kind: "task_session", sessionId: "ses_00000000000000000000000000000001" },
    instruction: "Research it.",
  });
  const serialized = `${outcome.text}${JSON.stringify(outcome.structured)}`;
  assert.equal(serialized.includes("deadbeef"), false);
  assert.equal(serialized.includes("ownershipToken"), false);
  assert.equal(serialized.includes("ownershipFence"), false);
});

// --- Phase 3C: continuation tools -----------------------------------------

test("continuation schemas expose no tamperable authority field", async () => {
  const { client, close } = await connectedClient();
  try {
    const tools = (await client.listTools()).tools;
    const expected: Record<string, string[]> = {
      synaphex_execute_helper: ["continuationId", "requestIndex"],
      synaphex_approve_and_execute_helper: ["continuationId", "requestIndex"],
      synaphex_resume_caller: ["continuationId"],
      synaphex_approve_network_action: ["continuationId", "requestIndex"],
      synaphex_continue_allowed_network: ["continuationId", "requestIndex"],
    };
    for (const [name, properties] of Object.entries(expected)) {
      const tool = tools.find((candidate) => candidate.name === name);
      assert.notEqual(tool, undefined, name);
      const actual = Object.keys(
        (tool?.inputSchema as { properties?: Record<string, unknown> })
          ?.properties ?? {},
      ).sort();
      assert.deepEqual(actual, [...properties].sort(), name);
    }
    // None of these authority fields exists as an INPUT PROPERTY on any tool.
    // (Descriptions may mention "classification" to explain that the
    // server-side classification governs; that is documentation, not a field.)
    const allProperties = new Set(
      tools.flatMap((tool) =>
        Object.keys(
          (tool.inputSchema as { properties?: Record<string, unknown> })
            ?.properties ?? {},
        ),
      ),
    );
    for (const forbidden of [
      "targetAgent",
      "callerAgent",
      "classification",
      "approvalGranted",
      "rememberApproval",
      "alwaysAllow",
      "changeRule",
      "hostProvider",
      "hostSurface",
      "lineage",
      "executionPolicy",
      "requestedCall",
      "requestedAction",
      "reason",
      "purpose",
      "route",
      "host",
      "caller",
      "directUser",
      "force",
      "unsafe",
      "allow",
      "approval",
      "kind",
    ]) {
      assert.equal(
        allProperties.has(forbidden),
        false,
        `${forbidden} must not be an input property on any tool`,
      );
    }
  } finally {
    await close();
  }
});

test("each continuation tool delegates one call to the continuation port", async () => {
  const cases: readonly [string, Record<string, unknown>, string][] = [
    [
      "synaphex_execute_helper",
      { continuationId: "cont_a", requestIndex: 0 },
      "agentContinuation.executeAllowedHelper",
    ],
    [
      "synaphex_approve_and_execute_helper",
      { continuationId: "cont_a", requestIndex: 1 },
      "agentContinuation.approveAndExecuteHelper",
    ],
    [
      "synaphex_resume_caller",
      { continuationId: "cont_a" },
      "agentContinuation.resumeCaller",
    ],
    [
      "synaphex_approve_network_action",
      { continuationId: "cont_a", requestIndex: 0 },
      "agentContinuation.approveNetworkAction",
    ],
    [
      "synaphex_continue_allowed_network",
      { continuationId: "cont_a", requestIndex: 0 },
      "agentContinuation.continueAllowedNetwork",
    ],
  ];
  for (const [tool, args, expectedPort] of cases) {
    const reads = fakeReadDependencies();
    const outcome = await call(reads, tool, args);
    assert.equal(outcome.isError, false, `${tool}: ${outcome.text}`);
    assert.equal(reads.calls.length, 1, tool);
    assert.equal(reads.calls[0]?.port, expectedPort, tool);
  }
});

test("continuation failures map to stable safe codes", async () => {
  const cases: readonly [Error, string][] = [
    [new ContinuationNotFoundError(), "CONTINUATION_NOT_FOUND"],
    [
      new ContinuationStateError("resume requires a completed helper"),
      "INVALID_CONTINUATION_STATE",
    ],
    [new ContinuationCapacityError(), "CONTINUATION_CAPACITY_EXHAUSTED"],
  ];
  for (const [error, expectedCode] of cases) {
    const reads = fakeReadDependencies();
    reads.continuationError = error;
    const outcome = await call(reads, "synaphex_execute_helper", {
      continuationId: "cont_a",
      requestIndex: 0,
    });
    assert.equal(outcome.isError, true);
    assert.equal(outcome.structured.code, expectedCode);
    assert.notEqual(outcome.structured.code, "INTERNAL_ERROR");
    assert.equal(/\n\s+at /.test(outcome.text), false, "no stack frames");
  }
});

test("malformed continuation input never reaches the continuation port", async () => {
  const cases: readonly Record<string, unknown>[] = [
    { continuationId: "", requestIndex: 0 },
    { continuationId: "cont_a", requestIndex: -1 },
    { continuationId: "cont_a", requestIndex: 1.5 },
    { continuationId: "cont_a", requestIndex: 999 },
    { continuationId: "cont_a" },
    { requestIndex: 0 },
  ];
  for (const args of cases) {
    const reads = fakeReadDependencies();
    const outcome = await call(reads, "synaphex_execute_helper", args);
    assert.equal(outcome.isError, true, JSON.stringify(args));
    assert.deepEqual(reads.calls, []);
  }
});

test("a continuation result exposes no ownership token or provider internals", async () => {
  const reads = fakeReadDependencies();
  reads.continuationOutcome = {
    invocation: {
      ...defaultInvocationResult({
        agent: "examiner",
        scope: { kind: "task_session", sessionId: "ses_x" },
        instruction: "x",
      }),
      ownershipToken: "deadbeefdeadbeefdeadbeefdeadbeef",
    },
    callerResumeReady: true,
    continuationId: "cont_next",
  };
  const outcome = await call(reads, "synaphex_execute_helper", {
    continuationId: "cont_a",
    requestIndex: 0,
  });
  const serialized = `${outcome.text}${JSON.stringify(outcome.structured)}`;
  assert.equal(serialized.includes("deadbeef"), false);
  assert.equal(serialized.includes("ownershipToken"), false);
  assert.equal(serialized.includes("TaskOwnershipFence"), false);
});

test("host actions have no approval tool", async () => {
  const { client, close } = await connectedClient();
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const absent of [
      "synaphex_approve_git_push",
      "synaphex_approve_ci",
      "synaphex_execute_host_action",
    ]) {
      assert.equal(names.includes(absent), false, `${absent} must not exist`);
    }
    assert.equal(names.length, 25);
  } finally {
    await close();
  }
});

// --- Phase 4A: bootstrap tools --------------------------------------------

test("bootstrap tools delegate to the narrow port with wire-validated input", async () => {
  const cases: readonly [string, Record<string, unknown>, string, unknown[]][] = [
    [
      "synaphex_register_project",
      { name: "Demo", sourcePath: "/tmp/demo" },
      "projectTaskCommands.registerProject",
      ["Demo", "/tmp/demo"],
    ],
    [
      "synaphex_create_task",
      { projectId: FAKE_PROJECT.id, description: "Do the thing" },
      "projectTaskCommands.createTask",
      [FAKE_PROJECT.id, "Do the thing"],
    ],
    [
      "synaphex_open_project_session",
      { projectId: FAKE_PROJECT.id },
      "projectTaskCommands.openProjectSession",
      [FAKE_PROJECT.id],
    ],
  ];
  for (const [tool, args, port, expectedArgs] of cases) {
    const reads = fakeReadDependencies();
    const outcome = await call(reads, tool, args);
    assert.equal(outcome.isError, false, `${tool}: ${outcome.text}`);
    assert.deepEqual(reads.calls, [{ port, args: expectedArgs }]);
  }
});

test("a project session result always reports taskId null", async () => {
  const reads = fakeReadDependencies();
  const outcome = await call(reads, "synaphex_open_project_session", {
    projectId: FAKE_PROJECT.id,
  });
  assert.deepEqual(outcome.structured, {
    sessionId: "ses_00000000000000000000000000000002",
    projectId: FAKE_PROJECT.id,
    taskId: null,
    bound: true,
  });
});

test("malformed bootstrap input never reaches the command port", async () => {
  const cases: readonly [string, Record<string, unknown>][] = [
    ["synaphex_register_project", { name: "", sourcePath: "/tmp/x" }],
    ["synaphex_register_project", { name: "N", sourcePath: "" }],
    ["synaphex_register_project", { sourcePath: "/tmp/x" }],
    ["synaphex_create_task", { projectId: "nope", description: "d" }],
    ["synaphex_create_task", { projectId: FAKE_PROJECT.id, description: "" }],
    ["synaphex_create_task", { projectId: FAKE_PROJECT.id }],
    ["synaphex_open_project_session", { projectId: "prj_../escape" }],
    ["synaphex_open_project_session", {}],
  ];
  for (const [tool, args] of cases) {
    const reads = fakeReadDependencies();
    const outcome = await call(reads, tool, args);
    assert.equal(outcome.isError, true, `${tool} ${JSON.stringify(args)}`);
    assert.deepEqual(reads.calls, []);
  }
});

test("bootstrap failures map to stable Core codes without leaking paths", async () => {
  const reads = fakeReadDependencies();
  reads.projectTaskError = new ProjectPathAlreadyRegisteredError(
    "/home/user/private/workspace",
    FAKE_PROJECT.id,
  );
  const outcome = await call(reads, "synaphex_register_project", {
    name: "Dup",
    sourcePath: "/home/user/private/workspace",
  });
  assert.equal(outcome.isError, true);
  assert.equal(
    outcome.structured.code,
    "PROJECT_PATH_ALREADY_REGISTERED",
  );
  assert.notEqual(outcome.structured.code, "INTERNAL_ERROR");
});

test("an unexpected bootstrap failure leaks no filesystem detail", async () => {
  const reads = fakeReadDependencies();
  reads.projectTaskError = new Error(
    "EACCES: /home/user/.ssh/id_rsa permission denied",
  );
  const outcome = await call(reads, "synaphex_register_project", {
    name: "Boom",
    sourcePath: "/tmp/x",
  });
  const serialized = `${outcome.text}${JSON.stringify(outcome.structured)}`;
  assert.equal(outcome.structured.code, "INTERNAL_ERROR");
  for (const secret of ["id_rsa", ".ssh", "EACCES", "at "]) {
    assert.equal(serialized.includes(secret), false, `leaked ${secret}`);
  }
});
