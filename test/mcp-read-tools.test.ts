import assert from "node:assert/strict";
import test from "node:test";
import { SynaphexError } from "../src/domain/errors.js";
import {
  FAKE_PROJECT,
  FAKE_TASK,
  connectedClient,
  fakeReadDependencies,
} from "./fixtures/mcp-read-fixtures.js";

interface ToolOutcome {
  readonly structured: Record<string, unknown>;
  readonly isError: boolean;
  readonly text: string;
}

async function call(
  reads: ReturnType<typeof fakeReadDependencies>,
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

test("project lookup delegates to the project read service and returns structured data", async () => {
  const reads = fakeReadDependencies();
  const outcome = await call(reads, "synaphex_get_project", {
    projectId: FAKE_PROJECT.id,
  });
  assert.equal(outcome.isError, false);
  assert.deepEqual(outcome.structured, {
    id: FAKE_PROJECT.id,
    name: FAKE_PROJECT.name,
    sourcePath: FAKE_PROJECT.sourcePath,
    createdAt: FAKE_PROJECT.createdAt,
  });
  assert.deepEqual(reads.calls, [
    { port: "projectReads.get", args: [FAKE_PROJECT.id] },
  ]);
});

test("task lookup delegates with both ids and reports lifecycle", async () => {
  const reads = fakeReadDependencies();
  const outcome = await call(reads, "synaphex_get_task", {
    projectId: FAKE_PROJECT.id,
    taskId: FAKE_TASK.id,
  });
  assert.equal(outcome.isError, false);
  assert.equal(outcome.structured.status, "active");
  assert.equal(outcome.structured.completedAt, null);
  assert.deepEqual(reads.calls, [
    { port: "taskReads.get", args: [FAKE_PROJECT.id, FAKE_TASK.id] },
  ]);
});

test("session lookup reports the binding, and an absent binding is not an error", async () => {
  const bound = fakeReadDependencies();
  const boundOutcome = await call(bound, "synaphex_get_session", {
    sessionId: "session-fixture",
  });
  assert.equal(boundOutcome.isError, false);
  assert.deepEqual(boundOutcome.structured, {
    sessionId: "session-fixture",
    bound: true,
    projectId: FAKE_PROJECT.id,
    taskId: FAKE_TASK.id,
  });

  const unbound = fakeReadDependencies();
  unbound.sessionBinding = null;
  const unboundOutcome = await call(unbound, "synaphex_get_session", {
    sessionId: "session-unknown",
  });
  assert.equal(unboundOutcome.isError, false);
  assert.deepEqual(unboundOutcome.structured, {
    sessionId: "session-unknown",
    bound: false,
    projectId: null,
    taskId: null,
  });
});

test("agent config exposes status and routing but never setting values", async () => {
  const reads = fakeReadDependencies();
  const outcome = await call(reads, "synaphex_get_agent_config", {
    agent: "planner",
  });
  assert.equal(outcome.isError, false);
  assert.equal(outcome.structured.status, "configured");
  assert.equal(outcome.structured.provider, "anthropic");
  assert.equal(outcome.structured.surface, "cli");
  assert.equal(outcome.structured.model, "fixture-model");
  // Only keys are reported; values could carry provider-specific data.
  assert.deepEqual(outcome.structured.settingKeys, ["effort", "secretish"]);
  assert.equal(outcome.text.includes("must-not-leak"), false);
  assert.equal(JSON.stringify(outcome.structured).includes("must-not-leak"), false);
});

test("agent config reports unconfigured and removed statuses faithfully", async () => {
  const unconfigured = fakeReadDependencies();
  unconfigured.agentConfig = { status: "unconfigured" };
  const first = await call(unconfigured, "synaphex_get_agent_config", {
    agent: "coder",
  });
  assert.deepEqual(first.structured, { agent: "coder", status: "unconfigured" });

  const removed = fakeReadDependencies();
  removed.agentConfig = {
    status: "removed",
    reason: "provider_removed",
    previousProvider: "google",
  };
  const second = await call(removed, "synaphex_get_agent_config", {
    agent: "reviewer",
  });
  assert.deepEqual(second.structured, {
    agent: "reviewer",
    status: "removed",
    reason: "provider_removed",
    previousProvider: "google",
  });
});

test("effective rules delegate to Core's read-only resolver and keep its precedence", async () => {
  const reads = fakeReadDependencies();
  const outcome = await call(reads, "synaphex_get_effective_rules", {
    projectId: FAKE_PROJECT.id,
    taskId: FAKE_TASK.id,
  });
  assert.equal(outcome.isError, false);
  assert.deepEqual(reads.calls, [
    {
      port: "effectiveRuleReads.listEffectiveRulesReadOnly",
      args: [{ projectId: FAKE_PROJECT.id, taskId: FAKE_TASK.id }],
    },
  ]);
  // MCP reports the source Core resolved; it never recomputes precedence.
  assert.deepEqual(outcome.structured.rules, [
    {
      key: "agent-call.planner.researcher",
      kind: "agent_call",
      decision: "allow",
      source: "task",
    },
    {
      key: "action.network",
      kind: "action",
      decision: "deny",
      source: "default_deny",
    },
  ]);
});

test("effective rules accept an empty scope context", async () => {
  const reads = fakeReadDependencies();
  const outcome = await call(reads, "synaphex_get_effective_rules", {});
  assert.equal(outcome.isError, false);
  assert.deepEqual(outcome.structured.scopeContext, {
    projectId: null,
    taskId: null,
  });
  assert.deepEqual(reads.calls[0], {
    port: "effectiveRuleReads.listEffectiveRulesReadOnly",
    args: [{}],
  });
});

test("malformed ids and agent names fail before any service call", async () => {
  const cases: readonly [string, Record<string, unknown>, string][] = [
    ["synaphex_get_project", { projectId: "nope_1" }, "INVALID_PROJECT_ID"],
    ["synaphex_get_project", { projectId: "prj_" }, "INVALID_PROJECT_ID"],
    ["synaphex_get_project", { projectId: "prj_../escape" }, "INVALID_PROJECT_ID"],
    [
      "synaphex_get_task",
      { projectId: FAKE_PROJECT.id, taskId: "task_" },
      "INVALID_TASK_ID",
    ],
    [
      "synaphex_get_task",
      { projectId: "bad", taskId: FAKE_TASK.id },
      "INVALID_PROJECT_ID",
    ],
    ["synaphex_get_session", { sessionId: "" }, "INVALID_SESSION_ID"],
    ["synaphex_get_session", { sessionId: "../../etc/passwd" }, "INVALID_SESSION_ID"],
    ["synaphex_get_effective_rules", { projectId: "oops" }, "INVALID_PROJECT_ID"],
  ];
  for (const [tool, args, expectedCode] of cases) {
    const reads = fakeReadDependencies();
    const outcome = await call(reads, tool, args);
    assert.equal(outcome.isError, true, `${tool} ${JSON.stringify(args)}`);
    assert.equal(outcome.structured.code, expectedCode);
    assert.deepEqual(reads.calls, [], `${tool} must not reach a service`);
  }
});

test("an out-of-enum agent name is rejected by the schema before the service", async () => {
  // The SDK enforces `inputSchema` before the handler runs, so this surfaces as
  // an error result rather than a thrown rejection. What matters for Phase 1 is
  // that no service is reached and the six logical agents are the only options.
  const reads = fakeReadDependencies();
  for (const agent of ["orchestrator", "", "PLANNER", "memory"]) {
    const outcome = await call(reads, "synaphex_get_agent_config", { agent });
    assert.equal(outcome.isError, true, `agent=${agent}`);
    assert.match(outcome.text, /Invalid option/);
  }
  assert.deepEqual(reads.calls, [], "no service may be reached");
});

test("known Synaphex errors map to stable domain codes with safe messages", async () => {
  const missingProject = fakeReadDependencies();
  const projectOutcome = await call(missingProject, "synaphex_get_project", {
    projectId: "prj_absent",
  });
  assert.equal(projectOutcome.isError, true);
  assert.deepEqual(projectOutcome.structured, {
    code: "PROJECT_NOT_FOUND",
    message: "Project not found.",
  });

  const missingTask = fakeReadDependencies();
  const taskOutcome = await call(missingTask, "synaphex_get_task", {
    projectId: FAKE_PROJECT.id,
    taskId: "task_absent",
  });
  assert.equal(taskOutcome.isError, true);
  assert.deepEqual(taskOutcome.structured, {
    code: "TASK_NOT_FOUND",
    message: "Task not found.",
  });
});

test("unexposed Synaphex codes and unexpected errors collapse to INTERNAL_ERROR", async () => {
  // A real domain error outside the Phase-1 exposed set must not leak the
  // existence of unrelated subsystems.
  const hostAction = fakeReadDependencies();
  hostAction.projectError = new SynaphexError(
    "HOST_ACTION_DENIED",
    "host action denied for git_push",
    { action: "git_push" },
  );
  const first = await call(hostAction, "synaphex_get_project", {
    projectId: FAKE_PROJECT.id,
  });
  assert.deepEqual(first.structured, {
    code: "INTERNAL_ERROR",
    message: "Internal Synaphex error.",
  });
  assert.equal(first.text.includes("git_push"), false);

  const unexpected = fakeReadDependencies();
  const leaky = new Error("ENOENT: /home/user/.synaphex/secret-state.json");
  unexpected.projectError = leaky;
  const second = await call(unexpected, "synaphex_get_project", {
    projectId: FAKE_PROJECT.id,
  });
  assert.deepEqual(second.structured, {
    code: "INTERNAL_ERROR",
    message: "Internal Synaphex error.",
  });
  const serialized = `${second.text}${JSON.stringify(second.structured)}`;
  assert.equal(serialized.includes("secret-state.json"), false);
  assert.equal(serialized.includes("ENOENT"), false);
  assert.equal(serialized.includes("at "), false, "no stack frames");
  // The full diagnostic is available on the diagnostics sink (stderr) only.
  assert.equal(unexpected.diagnostics.length, 1);
  assert.match(unexpected.diagnostics[0]!, /synaphex_get_project failed: INTERNAL_ERROR/);
});
