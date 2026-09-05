import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { AgentConfigManager } from "../src/core/agent-config-manager.js";
import { AgentInvocationService } from "../src/core/agent-invocation-service.js";
import { ArtifactManager } from "../src/core/artifact-manager.js";
import { MemoryManager } from "../src/core/memory-manager.js";
import { PlanManager } from "../src/core/plan-manager.js";
import { ProjectManager } from "../src/core/project-manager.js";
import { RuleResolver } from "../src/core/rule-resolver.js";
import {
  SessionManager,
  type TaskOwnershipFence,
} from "../src/core/session-manager.js";
import { TaskManager } from "../src/core/task-manager.js";
import type { AgentName } from "../src/domain/agent.js";
import type { AgentProvider, AgentSurface } from "../src/domain/agent-config.js";
import type {
  AgentExecutionInput,
  AgentExecutor,
} from "../src/domain/agent-invocation.js";
import { TaskSessionOwnershipLostError } from "../src/domain/errors.js";
import type { Project } from "../src/domain/project.js";
import type { RuntimeAvailability } from "../src/domain/provider-routing.js";
import type { Task } from "../src/domain/task.js";
import { StateStore } from "../src/infrastructure/state-store.js";
import { SessionCommands } from "../src/operations/session-commands.js";

interface Fixture {
  readonly stateRoot: string;
  readonly homeDirectory: string;
  readonly store: StateStore;
  readonly projects: ProjectManager;
  readonly sessions: SessionManager;
  readonly tasks: TaskManager;
  readonly plans: PlanManager;
  readonly artifacts: ArtifactManager;
  readonly memory: MemoryManager;
  readonly configs: AgentConfigManager;
  readonly commands: SessionCommands;
  readonly project: Project;
  readonly task: Task;
}

async function createFixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-fencing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateRoot = join(root, "state-root");
  const homeDirectory = join(root, "home");
  const sourcePath = join(root, "source");
  await Promise.all([
    mkdir(homeDirectory, { recursive: true }),
    mkdir(sourcePath, { recursive: true }),
  ]);
  const store = new StateStore(stateRoot);
  const projects = new ProjectManager(store, { homeDirectory });
  const sessions = new SessionManager(store);
  const tasks = new TaskManager(store, projects);
  const project = await projects.create("Fencing Project", sourcePath);
  const task = await tasks.create(project.id, "Fence the invocation");
  return {
    stateRoot,
    homeDirectory,
    store,
    projects,
    sessions,
    tasks,
    plans: new PlanManager(store, tasks),
    artifacts: new ArtifactManager(store, projects, tasks),
    memory: new MemoryManager(store, projects, tasks),
    configs: new AgentConfigManager(store),
    commands: new SessionCommands({ projects, tasks, sessions }),
    project,
    task,
  };
}

class FakeRuntimeAvailability implements RuntimeAvailability {
  async isAvailable(): Promise<boolean> {
    return true;
  }
}

/**
 * Executor that blocks until the test releases it, with no sleeps: the test
 * awaits `started` to know the ownership fence has been captured and the
 * provider is "running", mutates ownership, then resolves `release`.
 */
class BarrierExecutor implements AgentExecutor {
  readonly calls: AgentExecutionInput[] = [];
  readonly started: Promise<void>;
  private announceStarted!: () => void;
  private release!: () => void;
  private readonly gate: Promise<void>;

  constructor(private readonly result: unknown) {
    this.started = new Promise<void>((resolve) => {
      this.announceStarted = resolve;
    });
    this.gate = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  async execute(input: AgentExecutionInput): Promise<unknown> {
    this.calls.push(input);
    this.announceStarted();
    await this.gate;
    return this.result;
  }

  finish(): void {
    this.release();
  }
}

function service(
  fixture: Fixture,
  executor: AgentExecutor,
): AgentInvocationService {
  return new AgentInvocationService({
    executor,
    runtimeAvailability: new FakeRuntimeAvailability(),
    synaphexRoot: fixture.stateRoot,
    homeDirectory: fixture.homeDirectory,
  });
}

async function configure(
  fixture: Fixture,
  agent: AgentName,
  provider: AgentProvider = "openai",
  // CLI is the only executable target surface in v0.1.
  surface: AgentSurface = "cli",
): Promise<void> {
  await fixture.configs.setConfigured(agent, {
    provider,
    surface,
    model: `${agent}-model`,
  });
}

// ---------------------------------------------------------------------------
// Ownership token + fence primitives
// ---------------------------------------------------------------------------

async function readClaim(
  fixture: Fixture,
): Promise<Record<string, unknown> | null> {
  return fixture.store.readJson<Record<string, unknown>>(
    `state/task-bindings/${fixture.task.id}.json`,
  );
}

test("every successful claim persists a unique opaque ownership token", async (t) => {
  const fixture = await createFixture(t);
  const tokens = new Set<string>();
  for (let round = 0; round < 5; round += 1) {
    const opened = await fixture.commands.openTaskSession(
      fixture.project.id,
      fixture.task.id,
    );
    const claim = await readClaim(fixture);
    const token = claim?.ownershipToken;
    assert.equal(typeof token, "string");
    assert.match(token as string, /^[0-9a-f]{32}$/);
    assert.equal(tokens.has(token as string), false, "tokens must be unique");
    tokens.add(token as string);
    await fixture.commands.closeSession(opened.sessionId);
  }
  assert.equal(tokens.size, 5);
});

test("the ownership token encodes no provider, process or session identity", async (t) => {
  const fixture = await createFixture(t);
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const token = (await readClaim(fixture))?.ownershipToken as string;
  for (const forbidden of [
    String(process.pid),
    opened.sessionId,
    opened.sessionId.replace("ses_", ""),
    fixture.task.id,
    fixture.project.id,
    "claude",
    "codex",
    "google",
    "mcp",
  ]) {
    assert.equal(token.includes(forbidden), false, `token leaks ${forbidden}`);
  }
});

test("captureTaskOwnership pins the current claim instance", async (t) => {
  const fixture = await createFixture(t);
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const fence = await fixture.sessions.captureTaskOwnership(opened.sessionId);
  assert.notEqual(fence, null);
  assert.equal(fence?.projectId, fixture.project.id);
  assert.equal(fence?.taskId, fixture.task.id);
  assert.equal(fence?.sessionId, opened.sessionId);
  assert.equal(
    fence?.ownershipToken,
    (await readClaim(fixture))?.ownershipToken,
  );
  assert.equal(await fixture.sessions.isTaskOwnershipCurrent(fence!), true);
});

test("captureTaskOwnership returns null when the session holds no task claim", async (t) => {
  const fixture = await createFixture(t);
  // Never opened.
  assert.equal(
    await fixture.sessions.captureTaskOwnership(
      "ses_00000000000000000000000000000000",
    ),
    null,
  );
  // Project-bound only.
  await fixture.sessions.bindProject("ses_projectonly", fixture.project.id);
  assert.equal(
    await fixture.sessions.captureTaskOwnership("ses_projectonly"),
    null,
  );
});

test("a legacy claim without a token is upgraded in place under the lock", async (t) => {
  const fixture = await createFixture(t);
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const claimPath = `state/task-bindings/${fixture.task.id}.json`;
  const claim = (await readClaim(fixture))!;
  // Rewrite the claim in the pre-fencing shape.
  const { ownershipToken: _dropped, ...legacy } = claim;
  await fixture.store.writeJson(claimPath, legacy);
  assert.equal((await readClaim(fixture))?.ownershipToken, undefined);

  // Legacy state stays readable: ownership still resolves.
  assert.equal(
    (await fixture.sessions.findTaskOwner(fixture.task.id))?.sessionId,
    opened.sessionId,
  );

  // Capture upgrades it rather than inventing a deterministic fallback.
  const fence = await fixture.sessions.captureTaskOwnership(opened.sessionId);
  assert.notEqual(fence, null);
  assert.match(fence!.ownershipToken, /^[0-9a-f]{32}$/);
  assert.equal(
    (await readClaim(fixture))?.ownershipToken,
    fence!.ownershipToken,
  );
  assert.equal(await fixture.sessions.isTaskOwnershipCurrent(fence!), true);
});

test("a corrupted ownership token invalidates the claim rather than passing", async (t) => {
  const fixture = await createFixture(t);
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const claim = (await readClaim(fixture))!;
  await fixture.store.writeJson(`state/task-bindings/${fixture.task.id}.json`, {
    ...claim,
    ownershipToken: "not-a-valid-token",
  });
  // Self-heals: the malformed claim is treated as no claim at all.
  assert.equal(await fixture.sessions.findTaskOwner(fixture.task.id), null);
  assert.equal(
    await fixture.sessions.captureTaskOwnership(opened.sessionId),
    null,
  );
});

// ---------------------------------------------------------------------------
// Fence invalidation
// ---------------------------------------------------------------------------

async function openAndCapture(
  fixture: Fixture,
): Promise<TaskOwnershipFence> {
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const fence = await fixture.sessions.captureTaskOwnership(opened.sessionId);
  assert.notEqual(fence, null);
  return fence!;
}

test("force release invalidates an existing fence", async (t) => {
  const fixture = await createFixture(t);
  const fence = await openAndCapture(fixture);
  await fixture.commands.forceReleaseTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  assert.equal(await fixture.sessions.isTaskOwnershipCurrent(fence), false);
});

test("normal close invalidates an existing fence", async (t) => {
  const fixture = await createFixture(t);
  const fence = await openAndCapture(fixture);
  await fixture.commands.closeSession(fence.sessionId);
  assert.equal(await fixture.sessions.isTaskOwnershipCurrent(fence), false);
});

test("a new owner invalidates the previous fence", async (t) => {
  const fixture = await createFixture(t);
  const oldFence = await openAndCapture(fixture);
  await fixture.commands.forceReleaseTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const newFence = await openAndCapture(fixture);
  assert.notEqual(newFence.sessionId, oldFence.sessionId);
  assert.equal(await fixture.sessions.isTaskOwnershipCurrent(oldFence), false);
  assert.equal(await fixture.sessions.isTaskOwnershipCurrent(newFence), true);
});

test("ABA: the same SessionId reclaiming produces a new token, invalidating the old fence", async (t) => {
  const fixture = await createFixture(t);
  // Use the low-level Core API, which is the legitimate layer where the same
  // SessionId can be rebound after a release. This is exactly the case the
  // token exists to defeat: SessionId alone would still "match".
  const sessionId = "ses_abaabaabaabaabaabaabaabaabaaba01";
  await fixture.sessions.bindProject(sessionId, fixture.project.id);
  await fixture.sessions.bindTask(sessionId, fixture.task.id);
  const fenceX = await fixture.sessions.captureTaskOwnership(sessionId);
  assert.notEqual(fenceX, null);

  // Release, then rebind the SAME SessionId to the SAME task.
  await fixture.sessions.unbindTask(sessionId);
  await fixture.sessions.bindTask(sessionId, fixture.task.id);
  const fenceY = await fixture.sessions.captureTaskOwnership(sessionId);
  assert.notEqual(fenceY, null);

  // Same session, same task -- but a different claim instance.
  assert.equal(fenceY!.sessionId, fenceX!.sessionId);
  assert.equal(fenceY!.taskId, fenceX!.taskId);
  assert.notEqual(fenceY!.ownershipToken, fenceX!.ownershipToken);
  assert.equal(await fixture.sessions.isTaskOwnershipCurrent(fenceX!), false);
  assert.equal(await fixture.sessions.isTaskOwnershipCurrent(fenceY!), true);
});

// ---------------------------------------------------------------------------
// AgentInvocationService fencing
// ---------------------------------------------------------------------------

function successResult(agent: AgentName, extra: Record<string, unknown> = {}) {
  return { agent, outcome: "success", summary: `${agent} finished.`, ...extra };
}

test("a normal task-bound invocation still succeeds with fencing in place", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher");
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const executor = new BarrierExecutor(
    successResult("researcher", { researchArtifact: { findings: ["ok"] } }),
  );
  executor.finish();
  const result = await service(fixture, executor).invokeUserAgent({
    sessionId: opened.sessionId,
    agent: "researcher",
    host: { provider: "openai" },
    instruction: "Research the fencing behavior.",
  });
  assert.equal(result.agent, "researcher");
  assert.equal(result.scope.taskId, fixture.task.id);
});

test("a project-only invocation needs no task fence", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher");
  // Project-bound only: no task authority exists to fence.
  await fixture.sessions.bindProject("ses_projectscope0000000000000001", fixture.project.id);
  const executor = new BarrierExecutor(
    successResult("researcher", { researchArtifact: { findings: ["ok"] } }),
  );
  executor.finish();
  const result = await service(fixture, executor).invokeUserAgent({
    sessionId: "ses_projectscope0000000000000001",
    agent: "researcher",
    host: { provider: "openai" },
    instruction: "Research without a task.",
  });
  assert.equal(result.scope.taskId, null);
});

/**
 * Drives the critical race deterministically: the invocation captures its
 * fence and blocks in the provider, the test revokes ownership, then the
 * provider returns a valid AgentResult and the service reaches revalidation.
 */
async function raceOwnershipRevocation(
  fixture: Fixture,
  agent: AgentName,
  providerResult: unknown,
  revoke: (sessionId: string) => Promise<void>,
): Promise<unknown> {
  await configure(fixture, agent);
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const executor = new BarrierExecutor(providerResult);
  const pending = service(fixture, executor).invokeUserAgent({
    sessionId: opened.sessionId,
    agent,
    host: { provider: "openai" },
    instruction: `Run ${agent} across a revocation.`,
  });
  // The fence is captured before execute(); waiting on `started` proves the
  // provider is running, with no sleeps involved.
  await executor.started;
  await revoke(opened.sessionId);
  executor.finish();
  return pending;
}

test("a stale invocation cannot commit after force release", async (t) => {
  const fixture = await createFixture(t);
  const before = await fixture.tasks.get(fixture.project.id, fixture.task.id);
  await assert.rejects(
    raceOwnershipRevocation(
      fixture,
      "researcher",
      successResult("researcher", { researchArtifact: { findings: ["stale"] } }),
      async () => {
        await fixture.commands.forceReleaseTaskSession(
          fixture.project.id,
          fixture.task.id,
        );
      },
    ),
    (error: unknown) =>
      error instanceof TaskSessionOwnershipLostError &&
      error.code === "TASK_SESSION_OWNERSHIP_LOST" &&
      error.details?.phase === "commit",
  );
  // No task-scoped mutation occurred.
  assert.deepEqual(
    await fixture.tasks.get(fixture.project.id, fixture.task.id),
    before,
  );
});

test("a stale invocation cannot commit after an explicit close", async (t) => {
  const fixture = await createFixture(t);
  await assert.rejects(
    raceOwnershipRevocation(
      fixture,
      "researcher",
      successResult("researcher", { researchArtifact: { findings: ["stale"] } }),
      async (sessionId) => {
        await fixture.commands.closeSession(sessionId);
      },
    ),
    (error: unknown) => error instanceof TaskSessionOwnershipLostError,
  );
});

test("the new owner's claim survives a stale invocation's failure", async (t) => {
  const fixture = await createFixture(t);
  let newOwnerSessionId = "";
  await assert.rejects(
    raceOwnershipRevocation(
      fixture,
      "researcher",
      successResult("researcher", { researchArtifact: { findings: ["stale"] } }),
      async () => {
        await fixture.commands.forceReleaseTaskSession(
          fixture.project.id,
          fixture.task.id,
        );
        const reopened = await fixture.commands.openTaskSession(
          fixture.project.id,
          fixture.task.id,
        );
        newOwnerSessionId = reopened.sessionId;
      },
    ),
    (error: unknown) => error instanceof TaskSessionOwnershipLostError,
  );
  // The replacement owner is untouched by the fenced invocation.
  assert.equal(
    (await fixture.sessions.findTaskOwner(fixture.task.id))?.sessionId,
    newOwnerSessionId,
  );
  const fence = await fixture.sessions.captureTaskOwnership(newOwnerSessionId);
  assert.equal(await fixture.sessions.isTaskOwnershipCurrent(fence!), true);
});

test("Reviewer PASS cannot complete the task after ownership is revoked", async (t) => {
  const fixture = await createFixture(t);
  // Reviewer legitimately requires a persisted Coder work record to review.
  await fixture.artifacts.saveCoderWorkRecord(
    {
      kind: "task",
      projectId: fixture.project.id,
      taskId: fixture.task.id,
    },
    { files_changed: ["src/example.ts"], tests_run: ["npm test"] },
  );
  const before = await fixture.tasks.get(fixture.project.id, fixture.task.id);
  assert.equal(before.status, "active");

  await assert.rejects(
    raceOwnershipRevocation(
      fixture,
      "reviewer",
      {
        agent: "reviewer",
        outcome: "success",
        summary: "Review passed.",
        reviewStatus: "PASS",
        report: { requirement_compliance: "met", warnings: [] },
      },
      async () => {
        await fixture.commands.forceReleaseTaskSession(
          fixture.project.id,
          fixture.task.id,
        );
      },
    ),
    (error: unknown) => error instanceof TaskSessionOwnershipLostError,
  );

  // The task must remain in its previous lifecycle state.
  const after = await fixture.tasks.get(fixture.project.id, fixture.task.id);
  assert.equal(after.status, "active");
  assert.equal(after.completedAt, null);
  assert.deepEqual(after, before);
});

test("a Planner draft is not persisted after ownership is revoked", async (t) => {
  const fixture = await createFixture(t);
  await assert.rejects(
    raceOwnershipRevocation(
      fixture,
      "planner",
      {
        agent: "planner",
        outcome: "success",
        summary: "Plan drafted.",
        draftPlanMarkdown: "# Stale plan\n\n1. Should never persist.\n",
      },
      async () => {
        await fixture.commands.forceReleaseTaskSession(
          fixture.project.id,
          fixture.task.id,
        );
      },
    ),
    (error: unknown) => error instanceof TaskSessionOwnershipLostError,
  );
  // No plan draft reached storage.
  assert.equal(await fixture.plans.getDraft(fixture.task.id), null);
  assert.equal(await fixture.plans.hasDraft(fixture.task.id), false);
});

test("a revoked invocation writes no task artifact", async (t) => {
  const fixture = await createFixture(t);
  const scope = {
    kind: "task" as const,
    projectId: fixture.project.id,
    taskId: fixture.task.id,
  };
  const before = await fixture.artifacts.listResearchArtifacts(scope);
  await assert.rejects(
    raceOwnershipRevocation(
      fixture,
      "researcher",
      successResult("researcher", {
        researchArtifact: { findings: ["must not persist"] },
      }),
      async () => {
        await fixture.commands.forceReleaseTaskSession(
          fixture.project.id,
          fixture.task.id,
        );
      },
    ),
    (error: unknown) => error instanceof TaskSessionOwnershipLostError,
  );
  assert.deepEqual(
    await fixture.artifacts.listResearchArtifacts(scope),
    before,
  );
});

test("authority loss is not reported as a provider failure or internal error", async (t) => {
  const fixture = await createFixture(t);
  await assert.rejects(
    raceOwnershipRevocation(
      fixture,
      "researcher",
      successResult("researcher", { researchArtifact: { findings: ["x"] } }),
      async () => {
        await fixture.commands.forceReleaseTaskSession(
          fixture.project.id,
          fixture.task.id,
        );
      },
    ),
    (error: unknown) => {
      // The provider DID complete; this is authority revocation.
      assert.ok(error instanceof TaskSessionOwnershipLostError);
      assert.equal(error.code, "TASK_SESSION_OWNERSHIP_LOST");
      assert.notEqual(error.code, "AGENT_EXECUTION_FAILED");
      // The replacement owner's SessionId is never disclosed.
      assert.equal("ownerSessionId" in (error.details ?? {}), false);
      assert.equal("replacementSessionId" in (error.details ?? {}), false);
      return true;
    },
  );
});

test("an invocation whose session lost its claim fails at preflight, before the provider runs", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher");
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  // Revoke the claim but leave the binding record naming the task, so the
  // invocation still resolves a task scope while holding no authority.
  await fixture.store.removeFile(
    `state/task-bindings/${fixture.task.id}.json`,
  );
  const executor = new BarrierExecutor(successResult("researcher"));
  executor.finish();
  await assert.rejects(
    service(fixture, executor).invokeUserAgent({
      sessionId: opened.sessionId,
      agent: "researcher",
      host: { provider: "openai" },
      instruction: "Should not reach the provider.",
    }),
    (error: unknown) =>
      error instanceof TaskSessionOwnershipLostError &&
      error.details?.phase === "preflight",
  );
  assert.equal(executor.calls.length, 0, "provider must not be invoked");
});

// ---------------------------------------------------------------------------
// Token secrecy
// ---------------------------------------------------------------------------

test("the ownership token is never exposed through AgentContext or provider input", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher");
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const token = (await readClaim(fixture))?.ownershipToken as string;
  const executor = new BarrierExecutor(
    successResult("researcher", { researchArtifact: { findings: ["ok"] } }),
  );
  executor.finish();
  await service(fixture, executor).invokeUserAgent({
    sessionId: opened.sessionId,
    agent: "researcher",
    host: { provider: "openai" },
    instruction: "Check token secrecy.",
  });
  const serializedInput = JSON.stringify(executor.calls[0]);
  assert.equal(
    serializedInput.includes(token),
    false,
    "the ownership token must never reach the provider",
  );
});

test("no MCP module reads or forwards the ownership token", async (t) => {
  const { readFile, readdir } = await import("node:fs/promises");
  const mcpDirectory = join(process.cwd(), "src", "mcp");
  for (const name of (await readdir(mcpDirectory)).filter((n) =>
    n.endsWith(".ts"),
  )) {
    const source = await readFile(join(mcpDirectory, name), "utf8");
    const code = source
      .replaceAll(/\/\*[\s\S]*?\*\//g, "")
      .replaceAll(/\/\/.*$/gm, "");
    for (const forbidden of [
      "ownershipToken",
      "captureTaskOwnership",
      "isTaskOwnershipCurrent",
      "TaskOwnershipFence",
    ]) {
      assert.equal(
        code.includes(forbidden),
        false,
        `${name} must not reference ${forbidden}`,
      );
    }
  }
});

test("the recovery ports expose no ownership token", async (t) => {
  const fixture = await createFixture(t);
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const token = (await readClaim(fixture))?.ownershipToken as string;
  const owner = await fixture.commands.getTaskSessionOwner(
    fixture.project.id,
    fixture.task.id,
  );
  assert.equal(JSON.stringify(owner).includes(token), false);
  const closed = await fixture.commands.closeSession(opened.sessionId);
  assert.equal(JSON.stringify(closed).includes(token), false);
});

// ---------------------------------------------------------------------------
// Helper and continuation paths
// ---------------------------------------------------------------------------

/**
 * Executor that answers the parent immediately, then blocks on the helper so
 * the test can revoke ownership while the helper's provider is "running".
 */
class ParentThenBlockingHelperExecutor implements AgentExecutor {
  readonly calls: AgentExecutionInput[] = [];
  readonly helperStarted: Promise<void>;
  private announceHelperStarted!: () => void;
  private releaseHelper!: () => void;
  private readonly helperGate: Promise<void>;

  constructor(
    private readonly parentResult: unknown,
    private readonly helperResult: unknown,
  ) {
    this.helperStarted = new Promise<void>((resolve) => {
      this.announceHelperStarted = resolve;
    });
    this.helperGate = new Promise<void>((resolve) => {
      this.releaseHelper = resolve;
    });
  }

  async execute(input: AgentExecutionInput): Promise<unknown> {
    this.calls.push(input);
    if (input.context.agent === "researcher") {
      return this.parentResult;
    }
    this.announceHelperStarted();
    await this.helperGate;
    return this.helperResult;
  }

  finishHelper(): void {
    this.releaseHelper();
  }
}

test("a task-bound helper captures its own fence and cannot commit after revocation", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher");
  await configure(fixture, "examiner");
  const rules = new RuleResolver(fixture.store, fixture.projects, fixture.tasks);
  await rules.setRule(
    "global",
    { kind: "agent_call", caller: "researcher", target: "examiner" },
    "allow",
  );
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );

  const executor = new ParentThenBlockingHelperExecutor(
    {
      agent: "researcher",
      outcome: "success",
      summary: "Parent needs the examiner.",
      researchArtifact: { findings: ["parent"] },
      requestedCalls: [
        {
          target: "examiner",
          purpose: "memory_update",
          handoff: {
            caller: "researcher",
            target: "examiner",
            purpose: "memory_update",
            summary: "Record the finding in memory.",
          },
        },
      ],
    },
    {
      agent: "examiner",
      outcome: "success",
      summary: "No memory change needed.",
      memoryIntent: { kind: "none" },
    },
  );
  const invocation = service(fixture, executor);
  const parent = await invocation.invokeUserAgent({
    sessionId: opened.sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });

  const pendingHelper = invocation.executeHelper({
    sessionId: opened.sessionId,
    parentInvocation: parent,
    helperClassification: parent.helperCalls[0]!,
    host: { provider: "openai" },
  });
  // The helper captured its OWN fence before executing; revoke it mid-run.
  await executor.helperStarted;
  await fixture.commands.forceReleaseTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  executor.finishHelper();

  await assert.rejects(
    pendingHelper,
    (error: unknown) =>
      error instanceof TaskSessionOwnershipLostError &&
      error.details?.phase === "commit",
  );
});

test("a continuation cannot resurrect authority from an old invocation lineage", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher");
  await configure(fixture, "examiner");
  const rules = new RuleResolver(fixture.store, fixture.projects, fixture.tasks);
  await rules.setRule(
    "global",
    { kind: "agent_call", caller: "researcher", target: "examiner" },
    "allow",
  );
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );

  const executor = new ParentThenBlockingHelperExecutor(
    {
      agent: "researcher",
      outcome: "success",
      summary: "Parent needs the examiner.",
      researchArtifact: { findings: ["parent"] },
      requestedCalls: [
        {
          target: "examiner",
          purpose: "memory_update",
          handoff: {
            caller: "researcher",
            target: "examiner",
            purpose: "memory_update",
            summary: "Record the finding in memory.",
          },
        },
      ],
    },
    {
      agent: "examiner",
      outcome: "success",
      summary: "No memory change needed.",
      memoryIntent: { kind: "none" },
    },
  );
  executor.finishHelper();
  const invocation = service(fixture, executor);
  const parent = await invocation.invokeUserAgent({
    sessionId: opened.sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });
  const helperExecution = await invocation.executeHelper({
    sessionId: opened.sessionId,
    parentInvocation: parent,
    helperClassification: parent.helperCalls[0]!,
    host: { provider: "openai" },
  });

  // The session loses its claim BEFORE the caller resumes. Lineage metadata
  // from the earlier invocation must not restore authority.
  await fixture.commands.forceReleaseTaskSession(
    fixture.project.id,
    fixture.task.id,
  );

  await assert.rejects(
    invocation.resumeCaller({
      sessionId: opened.sessionId,
      helperExecution,
      host: { provider: "openai" },
    }),
    (error: unknown) => error instanceof Error,
    "a continuation must not resurrect revoked authority",
  );

  // Nothing was silently reclaimed on the session's behalf.
  assert.equal(await fixture.sessions.findTaskOwner(fixture.task.id), null);
});
