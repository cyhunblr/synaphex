import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
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
import { SessionManager } from "../src/core/session-manager.js";
import { TaskManager } from "../src/core/task-manager.js";
import type { AgentName } from "../src/domain/agent.js";
import type {
  AgentExecutionInput,
  AgentExecutor,
} from "../src/domain/agent-invocation.js";
import type { AgentCallPurpose } from "../src/domain/agent-context.js";
import type { AgentProvider, AgentSurface } from "../src/domain/agent-config.js";
import type { RequestedAgentCall } from "../src/domain/agent-result.js";
import type { TaskArtifactScope } from "../src/domain/artifact.js";
import {
  AgentConfigurationRemovedError,
  AgentExecutionFailedError,
  AgentUnconfiguredError,
  InvalidAgentModelError,
  InvalidAgentResultError,
  InvalidProviderRouteError,
  NoProjectBoundError,
  NoTaskBoundError,
  PlanDraftPendingError,
  ProviderCliUnavailableError,
  ReviewTargetNotAvailableError,
  TaskCompletedError,
} from "../src/domain/errors.js";
import type { RuntimeAvailability } from "../src/domain/provider-routing.js";
import type { Project } from "../src/domain/project.js";
import type { Task } from "../src/domain/task.js";
import { StateStore } from "../src/infrastructure/state-store.js";

class FakeAgentExecutor implements AgentExecutor {
  readonly calls: AgentExecutionInput[] = [];

  constructor(
    private readonly handler: (
      input: AgentExecutionInput,
    ) => unknown | Promise<unknown>,
  ) {}

  async execute(input: AgentExecutionInput): Promise<unknown> {
    this.calls.push(input);
    return this.handler(input);
  }
}

class FakeRuntimeAvailability implements RuntimeAvailability {
  readonly checks: Array<{
    readonly provider: AgentProvider;
    readonly surface: AgentSurface;
  }> = [];

  constructor(private readonly available: boolean = true) {}

  async isAvailable(
    provider: AgentProvider,
    surface: AgentSurface,
  ): Promise<boolean> {
    this.checks.push({ provider, surface });
    return this.available;
  }
}

interface Fixture {
  readonly root: string;
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
  readonly rules: RuleResolver;
  readonly project: Project;
  readonly task: Task;
  readonly otherTask: Task;
}

async function createFixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-invocation-test-"));
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
  const project = await projects.create("Invocation Project", sourcePath);
  const [task, otherTask] = await Promise.all([
    tasks.create(project.id, "Invoke the configured agent"),
    tasks.create(project.id, "Other invocation task"),
  ]);
  return {
    root,
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
    rules: new RuleResolver(store, projects, tasks),
    project,
    task,
    otherTask,
  };
}

function service(
  fixture: Fixture,
  executor: AgentExecutor,
  runtimeAvailability: RuntimeAvailability = new FakeRuntimeAvailability(),
): AgentInvocationService {
  return new AgentInvocationService({
    executor,
    runtimeAvailability,
    synaphexRoot: fixture.stateRoot,
    homeDirectory: fixture.homeDirectory,
  });
}

async function configure(
  fixture: Fixture,
  agent: AgentName,
  provider: AgentProvider = "openai",
  surface: AgentSurface = "vscode",
): Promise<void> {
  await fixture.configs.setConfigured(agent, {
    provider,
    surface,
    model: `${agent}-model`,
  });
}

async function bindProject(
  fixture: Fixture,
  sessionId: string,
): Promise<void> {
  await fixture.sessions.bindProject(sessionId, fixture.project.id);
}

async function bindTask(fixture: Fixture, sessionId: string): Promise<void> {
  await bindProject(fixture, sessionId);
  await fixture.sessions.bindTask(sessionId, fixture.task.id);
}

function taskScope(fixture: Fixture): TaskArtifactScope {
  return {
    kind: "task",
    projectId: fixture.project.id,
    taskId: fixture.task.id,
  };
}

function requestedCall(
  caller: AgentName,
  target: AgentName,
  purpose: AgentCallPurpose,
  summary = `${caller} requests ${target}`,
): RequestedAgentCall {
  return {
    target,
    purpose,
    handoff: { caller, target, purpose, summary },
  };
}

test("USER invokes QUESTIONER once with routed context and persisted working state", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "invoke-questioner";
  await bindTask(fixture, sessionId);
  await configure(fixture, "questioner");
  const executor = new FakeAgentExecutor(({ context }) => {
    assert.equal(context.agent, "questioner");
    assert.equal(context.task?.id, fixture.task.id);
    assert.equal(context.instruction, "Clarify this task.");
    return {
      agent: "questioner",
      outcome: "needs_user",
      summary: "One question remains.",
      state: "pending_question",
      question: "Which mode?",
      workingContext: { answers: [] },
    };
  });

  const result = await service(fixture, executor).invokeUserAgent({
    sessionId,
    agent: "questioner",
    instruction: "Clarify this task.",
    host: { provider: "openai", surface: "vscode" },
  });

  assert.equal(executor.calls.length, 1);
  assert.equal(result.route.routingReason, "same_provider_native");
  assert.equal(result.processedResult.state, "pending_question");
  assert.equal(
    (await fixture.artifacts.getQuestionerContext(taskScope(fixture)))
      .hasContext,
    true,
  );
});

test("USER invokes RESEARCHER project-only with cross-provider route and project artifact", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "invoke-research-project";
  await bindProject(fixture, sessionId);
  await configure(fixture, "researcher", "anthropic", "vscode");
  const availability = new FakeRuntimeAvailability(true);
  const executor = new FakeAgentExecutor(({ route, context }) => {
    assert.equal(context.task, null);
    assert.equal(route.provider, "anthropic");
    assert.equal(route.effectiveSurface, "cli");
    return {
      agent: "researcher",
      outcome: "success",
      summary: "Project research complete.",
      researchArtifact: { findings: ["project"] },
    };
  });

  const result = await service(fixture, executor, availability).invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai", surface: "vscode" },
  });

  assert.equal(executor.calls.length, 1);
  assert.equal(result.route.routingReason, "cross_provider_cli");
  assert.equal(result.processedResult.persistedArtifacts[0]?.scope.kind, "project");
});

test("USER invokes RESEARCHER task-bound and persists task evidence", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "invoke-research-task";
  await bindTask(fixture, sessionId);
  await configure(fixture, "researcher");
  const executor = new FakeAgentExecutor(({ context }) => {
    assert.equal(context.task?.id, fixture.task.id);
    return {
      agent: "researcher",
      outcome: "success",
      summary: "Task research complete.",
      researchArtifact: { evidence: ["task"] },
    };
  });

  await service(fixture, executor).invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai", surface: "vscode" },
  });

  assert.equal(executor.calls.length, 1);
  assert.equal(
    (await fixture.artifacts.listResearchArtifacts(taskScope(fixture))).length,
    1,
  );
});

test("USER invokes EXAMINER project-only and canonical memory changes only through ResultProcessor", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "invoke-examiner";
  await bindProject(fixture, sessionId);
  await configure(fixture, "examiner");
  const executor = new FakeAgentExecutor(({ context }) => {
    assert.equal(context.agent, "examiner");
    assert.equal(context.task, null);
    return {
      agent: "examiner",
      outcome: "success",
      summary: "Canonical project truth distilled.",
      memoryIntent: {
        kind: "replace_project",
        projectId: fixture.project.id,
        content: "# Invoked memory\n",
      },
    };
  });

  await service(fixture, executor).invokeUserAgent({
    sessionId,
    agent: "examiner",
    host: { provider: "openai", surface: "vscode" },
  });

  assert.equal(executor.calls.length, 1);
  assert.equal(
    (await fixture.memory.getProjectCanonicalMemory(fixture.project.id)).content,
    "# Invoked memory\n",
  );
});

test("completed bound task remains directly invocable by RESEARCHER and EXAMINER", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "invoke-completed-read-semantic";
  await bindTask(fixture, sessionId);
  await configure(fixture, "researcher");
  await configure(fixture, "examiner");
  await fixture.tasks.markCompleted(fixture.project.id, fixture.task.id);
  const executor = new FakeAgentExecutor(({ context }) =>
    context.agent === "researcher"
      ? {
          agent: "researcher",
          outcome: "success",
          summary: "Completed-task research.",
          researchArtifact: { findings: ["post-completion"] },
        }
      : {
          agent: "examiner",
          outcome: "success",
          summary: "Completed-task memory distilled.",
          memoryIntent: {
            kind: "replace_task",
            projectId: fixture.project.id,
            taskId: fixture.task.id,
            content: "completed task memory",
          },
        },
  );
  const invocation = service(fixture, executor);

  await invocation.invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai", surface: "vscode" },
  });
  await invocation.invokeUserAgent({
    sessionId,
    agent: "examiner",
    host: { provider: "openai", surface: "vscode" },
  });

  assert.equal(executor.calls.length, 2);
  assert.equal(
    (
      await fixture.memory.getTaskCanonicalMemory(
        fixture.project.id,
        fixture.task.id,
      )
    ).content,
    "completed task memory",
  );
});

test("USER invokes PLANNER and persists only its draft result", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "invoke-planner";
  await bindTask(fixture, sessionId);
  await configure(fixture, "planner");
  const executor = new FakeAgentExecutor(({ context }) => {
    assert.equal(context.plan?.current, null);
    return {
      agent: "planner",
      outcome: "success",
      summary: "Draft ready.",
      draftPlanMarkdown: "# Invocation plan\n",
    };
  });

  await service(fixture, executor).invokeUserAgent({
    sessionId,
    agent: "planner",
    host: { provider: "openai", surface: "vscode" },
  });

  assert.equal(executor.calls.length, 1);
  assert.equal(
    (await fixture.plans.getDraft(fixture.task.id))?.content,
    "# Invocation plan\n",
  );
  assert.equal(await fixture.plans.getCurrent(fixture.task.id), null);
});

test("USER invokes CODER in autonomous mode with no plan", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "invoke-coder-autonomous";
  await bindTask(fixture, sessionId);
  await configure(fixture, "coder");
  const executor = new FakeAgentExecutor(({ context }) => {
    assert.equal(context.plan?.current, null);
    assert.equal(context.plan?.hasPendingDraft, false);
    return {
      agent: "coder",
      outcome: "success",
      summary: "Autonomous implementation complete.",
      workRecord: { files_changed: ["src/autonomous.ts"] },
    };
  });

  await service(fixture, executor).invokeUserAgent({
    sessionId,
    agent: "coder",
    host: { provider: "openai", surface: "vscode" },
  });

  assert.equal(executor.calls.length, 1);
  assert.equal(
    (await fixture.artifacts.listCoderWorkRecords(taskScope(fixture))).length,
    1,
  );
});

test("USER invokes CODER in accepted-plan mode", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "invoke-coder-planned";
  await bindTask(fixture, sessionId);
  await configure(fixture, "coder");
  await fixture.plans.saveDraft(fixture.task.id, "# Accepted\n");
  await fixture.plans.acceptDraft(fixture.task.id);
  const executor = new FakeAgentExecutor(({ context }) => {
    assert.equal(context.plan?.current?.content, "# Accepted\n");
    return {
      agent: "coder",
      outcome: "success",
      summary: "Plan implementation complete.",
      workRecord: { files_changed: ["src/planned.ts"] },
    };
  });

  await service(fixture, executor).invokeUserAgent({
    sessionId,
    agent: "coder",
    host: { provider: "openai", surface: "vscode" },
  });

  assert.equal(executor.calls.length, 1);
  assert.equal(
    (await fixture.plans.getCurrent(fixture.task.id))?.content,
    "# Accepted\n",
  );
});

test("USER invokes REVIEWER only with Coder evidence and persists complete review evidence", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "invoke-reviewer";
  await bindTask(fixture, sessionId);
  await configure(fixture, "reviewer");
  await fixture.artifacts.saveCoderWorkRecord(taskScope(fixture), {
    files_changed: ["src/review.ts"],
  });
  const executor = new FakeAgentExecutor(({ context }) => {
    assert.equal(context.artifacts.coderWorkRecords.length, 1);
    return {
      agent: "reviewer",
      outcome: "success",
      summary: "Review passed.",
      reviewStatus: "PASS",
      report: { requirement_compliance: true },
    };
  });

  const result = await service(fixture, executor).invokeUserAgent({
    sessionId,
    agent: "reviewer",
    host: { provider: "openai", surface: "vscode" },
  });

  assert.equal(executor.calls.length, 1);
  assert.equal(result.processedResult.reviewStatus, "PASS");
  assert.equal(
    (await fixture.tasks.get(fixture.project.id, fixture.task.id)).status,
    "completed",
  );
  assert.equal(
    (await fixture.artifacts.listReviewerReports(taskScope(fixture)))[0]?.review
      .status,
    "PASS",
  );
});

test("configuration failures stop before executor invocation and remain agent-local", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "invoke-config-failures";
  await bindTask(fixture, sessionId);
  const executor = new FakeAgentExecutor(() => {
    throw new Error("must not execute");
  });
  const invocation = service(fixture, executor);

  await assert.rejects(
    invocation.invokeUserAgent({
      sessionId,
      agent: "researcher",
      host: { provider: "openai", surface: "vscode" },
    }),
    AgentUnconfiguredError,
  );

  await configure(fixture, "planner", "anthropic", "cli");
  await fixture.configs.removeProvider("anthropic");
  await assert.rejects(
    invocation.invokeUserAgent({
      sessionId,
      agent: "planner",
      host: { provider: "openai", surface: "vscode" },
    }),
    AgentConfigurationRemovedError,
  );

  await fixture.configs.getAllConfigs();
  const stored = await fixture.store.readJson<{
    version: 1;
    agents: Record<string, unknown>;
  }>("agent_config.jsonc");
  assert.ok(stored !== null);
  await fixture.store.writeJson("agent_config.jsonc", {
    ...stored,
    agents: {
      ...stored.agents,
      coder: {
        status: "configured",
        provider: "openai",
        surface: "vscode",
        model: "   ",
      },
    },
  });
  await assert.rejects(
    invocation.invokeUserAgent({
      sessionId,
      agent: "coder",
      host: { provider: "openai", surface: "vscode" },
    }),
    InvalidAgentModelError,
  );

  assert.equal(executor.calls.length, 0);
});

test("invalid and unavailable provider routes stop before execution", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "invoke-route-failures";
  await bindProject(fixture, sessionId);
  await configure(fixture, "researcher", "openai", "vscode");
  const executor = new FakeAgentExecutor(() => {
    throw new Error("must not execute");
  });
  const unavailable = new FakeRuntimeAvailability(false);
  const invocation = service(fixture, executor, unavailable);

  await assert.rejects(
    invocation.invokeUserAgent({
      sessionId,
      agent: "researcher",
      host: { provider: "openai", surface: "cli" },
    }),
    InvalidProviderRouteError,
  );

  await configure(fixture, "researcher", "anthropic", "vscode");
  await assert.rejects(
    invocation.invokeUserAgent({
      sessionId,
      agent: "researcher",
      host: { provider: "openai", surface: "vscode" },
    }),
    ProviderCliUnavailableError,
  );
  assert.equal(executor.calls.length, 0);
  assert.deepEqual(
    await fixture.artifacts.listResearchArtifacts({
      kind: "project",
      projectId: fixture.project.id,
    }),
    [],
  );
});

test("missing project or required task fails invocation preflight", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher");
  await configure(fixture, "planner");
  const executor = new FakeAgentExecutor(() => {
    throw new Error("must not execute");
  });
  const invocation = service(fixture, executor);

  await assert.rejects(
    invocation.invokeUserAgent({
      sessionId: "unbound",
      agent: "researcher",
      host: { provider: "openai", surface: "vscode" },
    }),
    NoProjectBoundError,
  );
  const sessionId = "project-only-planner";
  await bindProject(fixture, sessionId);
  await assert.rejects(
    invocation.invokeUserAgent({
      sessionId,
      agent: "planner",
      host: { provider: "openai", surface: "vscode" },
    }),
    NoTaskBoundError,
  );
  assert.equal(executor.calls.length, 0);
});

test("completed task rejects CODER before executor", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "invoke-completed-coder";
  await bindTask(fixture, sessionId);
  await configure(fixture, "coder");
  await fixture.tasks.markCompleted(fixture.project.id, fixture.task.id);
  const executor = new FakeAgentExecutor(() => ({ ignored: true }));

  await assert.rejects(
    service(fixture, executor).invokeUserAgent({
      sessionId,
      agent: "coder",
      host: { provider: "openai", surface: "vscode" },
    }),
    TaskCompletedError,
  );
  assert.equal(executor.calls.length, 0);
});

test("any pending draft blocks CODER with or without an accepted current plan", async (t) => {
  const noCurrent = await createFixture(t);
  const noCurrentSession = "pending-no-current";
  await bindTask(noCurrent, noCurrentSession);
  await configure(noCurrent, "coder");
  await noCurrent.plans.saveDraft(noCurrent.task.id, "# Pending\n");
  const firstExecutor = new FakeAgentExecutor(() => ({ ignored: true }));
  await assert.rejects(
    service(noCurrent, firstExecutor).invokeUserAgent({
      sessionId: noCurrentSession,
      agent: "coder",
      host: { provider: "openai", surface: "vscode" },
    }),
    (error: unknown) =>
      error instanceof PlanDraftPendingError &&
      error.code === "PLAN_DRAFT_PENDING",
  );

  const withCurrent = await createFixture(t);
  const withCurrentSession = "pending-with-current";
  await bindTask(withCurrent, withCurrentSession);
  await configure(withCurrent, "coder");
  await withCurrent.plans.saveDraft(withCurrent.task.id, "# Current\n");
  await withCurrent.plans.acceptDraft(withCurrent.task.id);
  await withCurrent.plans.saveDraft(withCurrent.task.id, "# Revision\n");
  const secondExecutor = new FakeAgentExecutor(() => ({ ignored: true }));
  await assert.rejects(
    service(withCurrent, secondExecutor).invokeUserAgent({
      sessionId: withCurrentSession,
      agent: "coder",
      host: { provider: "openai", surface: "vscode" },
    }),
    PlanDraftPendingError,
  );

  assert.equal(firstExecutor.calls.length, 0);
  assert.equal(secondExecutor.calls.length, 0);
  assert.equal(
    (await withCurrent.plans.getCurrent(withCurrent.task.id))?.content,
    "# Current\n",
  );
});

test("REVIEWER without persisted Coder evidence fails preflight", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "reviewer-no-target";
  await bindTask(fixture, sessionId);
  await configure(fixture, "reviewer");
  const executor = new FakeAgentExecutor(() => ({ ignored: true }));

  await assert.rejects(
    service(fixture, executor).invokeUserAgent({
      sessionId,
      agent: "reviewer",
      host: { provider: "openai", surface: "vscode" },
    }),
    (error: unknown) =>
      error instanceof ReviewTargetNotAvailableError &&
      error.code === "REVIEW_TARGET_NOT_AVAILABLE",
  );
  assert.equal(executor.calls.length, 0);
});

test("executor failure is wrapped and causes no ResultProcessor mutation", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "executor-failure";
  await bindTask(fixture, sessionId);
  await configure(fixture, "coder");
  const diagnostic = new Error("provider included a private diagnostic");
  const executor = new FakeAgentExecutor(() => {
    throw diagnostic;
  });

  await assert.rejects(
    service(fixture, executor).invokeUserAgent({
      sessionId,
      agent: "coder",
      host: { provider: "openai", surface: "vscode" },
    }),
    (error: unknown) =>
      error instanceof AgentExecutionFailedError &&
      error.code === "AGENT_EXECUTION_FAILED" &&
      error.cause === diagnostic &&
      !error.message.includes("private diagnostic"),
  );
  assert.equal(executor.calls.length, 1);
  assert.deepEqual(
    await fixture.artifacts.listCoderWorkRecords(taskScope(fixture)),
    [],
  );
});

test("malformed executor output fails read-only validation before mutation", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "malformed-executor-result";
  await bindTask(fixture, sessionId);
  await configure(fixture, "coder");
  const executor = new FakeAgentExecutor(() => ({
    agent: "reviewer",
    outcome: "success",
    summary: "Wrong discriminator.",
    workRecord: { files_changed: [] },
  }));

  await assert.rejects(
    service(fixture, executor).invokeUserAgent({
      sessionId,
      agent: "coder",
      host: { provider: "openai", surface: "vscode" },
    }),
    InvalidAgentResultError,
  );
  assert.equal(executor.calls.length, 1);
  assert.deepEqual(
    await fixture.artifacts.listCoderWorkRecords(taskScope(fixture)),
    [],
  );
});

test("malformed requested helper call fails read-only validation before main-result mutation", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "malformed-helper-request";
  await bindProject(fixture, sessionId);
  await configure(fixture, "researcher");
  const executor = new FakeAgentExecutor(() => ({
    agent: "researcher",
    outcome: "success",
    summary: "Main result is valid but helper caller is not.",
    researchArtifact: { findings: ["must not persist"] },
    requestedCalls: [
      {
        target: "examiner",
        purpose: "memory_update",
        handoff: {
          caller: "coder",
          target: "examiner",
          purpose: "memory_update",
          summary: "Caller mismatch.",
        },
      },
    ],
  }));

  await assert.rejects(
    service(fixture, executor).invokeUserAgent({
      sessionId,
      agent: "researcher",
      host: { provider: "openai", surface: "vscode" },
    }),
    InvalidAgentResultError,
  );
  assert.equal(executor.calls.length, 1);
  assert.deepEqual(
    await fixture.artifacts.listResearchArtifacts({
      kind: "project",
      projectId: fixture.project.id,
    }),
    [],
  );
});

test("invalid rule state produces unavailable helper while valid main result still persists", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "helper-unavailable";
  await bindProject(fixture, sessionId);
  await configure(fixture, "researcher");
  const executor = new FakeAgentExecutor(async () => {
    // Context construction has completed; corrupt classification-only state.
    await fixture.store.writeJson("rules.jsonc", []);
    return {
      agent: "researcher",
      outcome: "success",
      summary: "Main research remains valid.",
      researchArtifact: { findings: ["persist after classification"] },
      requestedCalls: [
        requestedCall("researcher", "examiner", "memory_update"),
      ],
    };
  });

  const result = await service(fixture, executor).invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai", surface: "vscode" },
  });

  assert.deepEqual(result.helperCalls, [
    {
      status: "unavailable",
      request: requestedCall("researcher", "examiner", "memory_update"),
      immutableReason: "no_immutable_restriction",
      effectiveRule: null,
      errorCode: "INVALID_RULE",
    },
  ]);
  assert.equal(executor.calls.length, 1);
  assert.equal(
    (
      await fixture.artifacts.listResearchArtifacts({
        kind: "project",
        projectId: fixture.project.id,
      })
    ).length,
    1,
  );
});

test("unexpected helper-classification exception occurs before ResultProcessor mutation", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "helper-unexpected-failure";
  await bindProject(fixture, sessionId);
  await configure(fixture, "researcher");
  const executor = new FakeAgentExecutor(async () => {
    await fixture.store.removeFile("rules.jsonc");
    await mkdir(join(fixture.stateRoot, "rules.jsonc"));
    return {
      agent: "researcher",
      outcome: "success",
      summary: "Must not persist after unexpected classification failure.",
      researchArtifact: { findings: ["must not persist"] },
      requestedCalls: [
        requestedCall("researcher", "examiner", "memory_update"),
      ],
    };
  });

  await assert.rejects(
    service(fixture, executor).invokeUserAgent({
      sessionId,
      agent: "researcher",
      host: { provider: "openai", surface: "vscode" },
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "EISDIR",
  );
  assert.equal(executor.calls.length, 1);
  assert.deepEqual(
    await fixture.artifacts.listResearchArtifacts({
      kind: "project",
      projectId: fixture.project.id,
    }),
    [],
  );
});

test("ResultProcessor rechecks a lifecycle race after execution", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "invocation-race";
  await bindTask(fixture, sessionId);
  await configure(fixture, "coder");
  const executor = new FakeAgentExecutor(async () => {
    await fixture.tasks.markCompleted(fixture.project.id, fixture.task.id);
    return {
      agent: "coder",
      outcome: "success",
      summary: "Stale execution result.",
      workRecord: { files_changed: ["src/stale.ts"] },
    };
  });

  await assert.rejects(
    service(fixture, executor).invokeUserAgent({
      sessionId,
      agent: "coder",
      host: { provider: "openai", surface: "vscode" },
    }),
    TaskCompletedError,
  );
  assert.equal(executor.calls.length, 1);
  assert.deepEqual(
    await fixture.artifacts.listCoderWorkRecords(taskScope(fixture)),
    [],
  );
});

test("direct USER calls bypass unrelated agent-call deny rules", async (t) => {
  const coderFixture = await createFixture(t);
  const coderSession = "direct-coder-bypass";
  await bindTask(coderFixture, coderSession);
  await configure(coderFixture, "coder");
  await coderFixture.rules.setRule(
    "global",
    { kind: "agent_call", caller: "planner", target: "coder" },
    "deny",
  );
  const coderExecutor = new FakeAgentExecutor(() => ({
    agent: "coder",
    outcome: "success",
    summary: "Direct Coder invocation.",
    workRecord: { files_changed: [] },
  }));
  const coderResult = await service(
    coderFixture,
    coderExecutor,
  ).invokeUserAgent({
    sessionId: coderSession,
    agent: "coder",
    host: { provider: "openai", surface: "vscode" },
  });
  assert.deepEqual(coderResult.helperCalls, []);

  const reviewerFixture = await createFixture(t);
  const reviewerSession = "direct-reviewer-bypass";
  await bindTask(reviewerFixture, reviewerSession);
  await configure(reviewerFixture, "reviewer");
  await reviewerFixture.artifacts.saveCoderWorkRecord(
    taskScope(reviewerFixture),
    { files_changed: [] },
  );
  await reviewerFixture.rules.setRule(
    "global",
    { kind: "agent_call", caller: "coder", target: "reviewer" },
    "deny",
  );
  const reviewerExecutor = new FakeAgentExecutor(() => ({
    agent: "reviewer",
    outcome: "success",
    summary: "Direct Reviewer invocation.",
    reviewStatus: "FAIL",
    failureOrigin: "implementation",
    report: { requirement_compliance: false },
  }));
  const reviewerResult = await service(
    reviewerFixture,
    reviewerExecutor,
  ).invokeUserAgent({
    sessionId: reviewerSession,
    agent: "reviewer",
    host: { provider: "openai", surface: "vscode" },
  });

  assert.deepEqual(reviewerResult.helperCalls, []);
  assert.equal(coderExecutor.calls.length, 1);
  assert.equal(reviewerExecutor.calls.length, 1);
});

test("helper calls classify allow, ask, deny, and default deny independently in result order", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "helper-rule-matrix";
  await bindProject(fixture, sessionId);
  await configure(fixture, "researcher");
  await fixture.rules.setRule(
    "global",
    { kind: "agent_call", caller: "researcher", target: "examiner" },
    "allow",
  );
  await fixture.rules.setRule(
    "project",
    { kind: "agent_call", caller: "researcher", target: "questioner" },
    "ask",
    { projectId: fixture.project.id },
  );
  await fixture.rules.setRule(
    "global",
    { kind: "agent_call", caller: "researcher", target: "coder" },
    "deny",
  );
  const calls = [
    requestedCall("researcher", "examiner", "memory_update"),
    requestedCall("researcher", "questioner", "clarification"),
    requestedCall("researcher", "coder", "research"),
    requestedCall("researcher", "reviewer", "review_followup"),
  ];
  const executor = new FakeAgentExecutor(() => ({
    agent: "researcher",
    outcome: "success",
    summary: "Research and helper requests complete.",
    researchArtifact: { findings: ["main result"] },
    requestedCalls: calls,
  }));
  const rulesBefore = await fixture.store.readText("rules.jsonc");

  const result = await service(fixture, executor).invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai", surface: "vscode" },
  });

  assert.deepEqual(
    result.helperCalls.map(({ status }) => status),
    ["allowed", "approval_required", "denied", "denied"],
  );
  assert.deepEqual(
    result.helperCalls.map(({ effectiveRule }) => effectiveRule?.source),
    ["global", "project", "global", "default_deny"],
  );
  assert.deepEqual(
    result.helperCalls.map(({ request }) => request.target),
    ["examiner", "questioner", "coder", "reviewer"],
  );
  assert.equal(executor.calls.length, 1);
  assert.equal(await fixture.store.readText("rules.jsonc"), rulesBefore);
  assert.equal(
    (
      await fixture.artifacts.listResearchArtifacts({
        kind: "project",
        projectId: fixture.project.id,
      })
    ).length,
    1,
  );
  assert.deepEqual(
    await fixture.artifacts.listCoderWorkRecords(taskScope(fixture)),
    [],
  );
  assert.equal(await fixture.plans.getDraft(fixture.task.id), null);
});

test("task rule overrides project and global during helper classification", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "helper-rule-precedence";
  await bindTask(fixture, sessionId);
  await configure(fixture, "researcher");
  const key = {
    kind: "agent_call" as const,
    caller: "researcher" as const,
    target: "examiner" as const,
  };
  await fixture.rules.setRule("global", key, "deny");
  await fixture.rules.setRule("project", key, "ask", {
    projectId: fixture.project.id,
  });
  await fixture.rules.setRule("task", key, "allow", {
    projectId: fixture.project.id,
    taskId: fixture.task.id,
  });
  const executor = new FakeAgentExecutor(() => ({
    agent: "researcher",
    outcome: "success",
    summary: "Task-scoped helper request.",
    researchArtifact: { findings: [] },
    requestedCalls: [
      requestedCall("researcher", "examiner", "memory_update"),
    ],
  }));

  const result = await service(fixture, executor).invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai", surface: "vscode" },
  });

  assert.equal(result.helperCalls[0]?.status, "allowed");
  assert.equal(result.helperCalls[0]?.effectiveRule?.source, "task");
});

test("immutable PLANNER to CODER request is forbidden without rolling back main result", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "forbidden-planner-coder";
  await bindTask(fixture, sessionId);
  await configure(fixture, "planner");
  // Simulate persisted state that bypassed RuleResolver's write guard.
  await fixture.store.writeJson("rules.jsonc", {
    agent_calls: { planner: { coder: "allow" } },
    actions: {},
  });
  const executor = new FakeAgentExecutor(() => ({
    agent: "planner",
    outcome: "success",
    summary: "Draft and forbidden request returned.",
    draftPlanMarkdown: "# Persist despite forbidden helper\n",
    requestedCalls: [
      requestedCall("planner", "coder", "implementation_deviation"),
    ],
  }));

  const result = await service(fixture, executor).invokeUserAgent({
    sessionId,
    agent: "planner",
    host: { provider: "openai", surface: "vscode" },
  });

  assert.equal(result.helperCalls[0]?.status, "forbidden");
  assert.equal(result.helperCalls[0]?.immutableReason, "forbidden_edge");
  assert.equal(result.helperCalls[0]?.effectiveRule, null);
  assert.equal(
    (await fixture.plans.getDraft(fixture.task.id))?.content,
    "# Persist despite forbidden helper\n",
  );
  assert.equal(executor.calls.length, 1);
});

test("CODER to PLANNER uses persisted accepted plan and purpose before configurable rule", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "coder-planner-conditional";
  await bindTask(fixture, sessionId);
  await configure(fixture, "coder");
  await fixture.plans.saveDraft(fixture.task.id, "# Accepted\n");
  await fixture.plans.acceptDraft(fixture.task.id);
  await fixture.rules.setRule(
    "global",
    { kind: "agent_call", caller: "coder", target: "planner" },
    "allow",
  );
  const executor = new FakeAgentExecutor(() => ({
    agent: "coder",
    outcome: "success",
    summary: "Two Planner requests.",
    workRecord: { files_changed: [] },
    requestedCalls: [
      requestedCall("coder", "planner", "plan_clarification"),
      requestedCall("coder", "planner", "research"),
    ],
  }));

  const result = await service(fixture, executor).invokeUserAgent({
    sessionId,
    agent: "coder",
    host: { provider: "openai", surface: "vscode" },
  });

  assert.deepEqual(
    result.helperCalls.map(({ status }) => status),
    ["allowed", "forbidden"],
  );
  assert.equal(
    result.helperCalls[0]?.immutableReason,
    "conditional_contract_satisfied",
  );
  assert.equal(
    result.helperCalls[1]?.immutableReason,
    "unsupported_call_purpose",
  );
  assert.equal(executor.calls.length, 1);
});

test("CODER to PLANNER without accepted plan is immutable-forbidden even when rule allows", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "coder-planner-no-plan";
  await bindTask(fixture, sessionId);
  await configure(fixture, "coder");
  await fixture.rules.setRule(
    "global",
    { kind: "agent_call", caller: "coder", target: "planner" },
    "allow",
  );
  const executor = new FakeAgentExecutor(() => ({
    agent: "coder",
    outcome: "success",
    summary: "Planner request without accepted plan.",
    workRecord: { files_changed: [] },
    requestedCalls: [
      requestedCall("coder", "planner", "plan_clarification"),
    ],
  }));

  const result = await service(fixture, executor).invokeUserAgent({
    sessionId,
    agent: "coder",
    host: { provider: "openai", surface: "vscode" },
  });

  assert.equal(result.helperCalls[0]?.status, "forbidden");
  assert.equal(
    result.helperCalls[0]?.immutableReason,
    "accepted_plan_required",
  );
  assert.equal(result.helperCalls[0]?.effectiveRule, null);
  assert.equal(executor.calls.length, 1);
  assert.equal(
    (await fixture.artifacts.listCoderWorkRecords(taskScope(fixture))).length,
    1,
  );
});
