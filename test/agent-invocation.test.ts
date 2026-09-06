import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
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
  AnyAgentInvocationResult,
} from "../src/domain/agent-invocation.js";
import type { AgentCallPurpose } from "../src/domain/agent-context.js";
import type { AgentProvider, AgentSurface } from "../src/domain/agent-config.js";
import type { RequestedAgentCall } from "../src/domain/agent-result.js";
import type { RequestedAction } from "../src/domain/agent-result.js";
import type { TaskArtifactScope } from "../src/domain/artifact.js";
import type {
  HostActionExecutionInput,
  HostActionExecutor,
  HostActionResult,
} from "../src/domain/host-action.js";
import {
  AgentCallApprovalRequiredError,
  AgentCallDeniedError,
  AgentCallForbiddenError,
  AgentCallUnavailableError,
  ActionApprovalRequiredError,
  ActionDeniedError,
  ActionUnavailableError,
  HostActionApprovalRequiredError,
  HostActionDeniedError,
  HostActionUnavailableError,
  AgentConfigurationRemovedError,
  AgentExecutionFailedError,
  AgentInvocationDepthExceededError,
  AgentUnconfiguredError,
  InvalidAgentModelError,
  InvalidAgentResultError,
  InvalidActionContinuationError,
  InvalidActionExecutionKindError,
  InvalidHostActionAuthorizationError,
  AgentTargetSurfaceUnsupportedError,
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
import {
  CODEX_WEB_SEARCH_DISABLED_OVERRIDE,
  CODEX_WEB_SEARCH_LIVE_OVERRIDE,
  CODEX_WORKSPACE_WRITE_NETWORK_DISABLED_OVERRIDE,
  resolveCodexExecutionPolicy,
} from "../src/providers/codex-execution-policy-resolver.js";

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

  constructor(public available: boolean = true) {}

  async isAvailable(
    provider: AgentProvider,
    surface: AgentSurface,
  ): Promise<boolean> {
    this.checks.push({ provider, surface });
    return this.available;
  }
}

class FakeHostActionExecutor implements HostActionExecutor {
  readonly calls: HostActionExecutionInput[] = [];

  async execute(input: HostActionExecutionInput): Promise<HostActionResult> {
    this.calls.push(input);
    return {
      action: input.authorization.action,
      outcome: "success",
      summary: "Fake host action executed.",
    };
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

/** Minimal clean Git repository for staged-CODER fixtures. */
function initGitFixture(sourcePath: string): void {
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: sourcePath,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@localhost",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@localhost",
    LC_ALL: "C",
  };
  writeFileSync(join(sourcePath, "source.txt"), "baseline\n", "utf8");
  for (const args of [
    ["init", "--quiet"],
    ["add", "-A"],
    ["commit", "--quiet", "-m", "baseline"],
  ]) {
    const result = spawnSync("git", args, { cwd: sourcePath, env, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
    }
  }
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
  // Staged CODER requires a clean Git worktree (Phase 5B hardening), so the
  // fixture source is a real committed repository.
  initGitFixture(sourcePath);
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
  // CLI is the only executable target surface in v0.1. This default used to be
  // `vscode`, which only ever ran because the router silently downgraded it.
  surface: AgentSurface = "cli",
): Promise<void> {
  await fixture.configs.setConfigured(agent, {
    provider,
    surface,
    model: provider === "anthropic" ? "claude-sonnet-4-5" : "gpt-5.6-sol",
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

function requestedAction(
  action: RequestedAction["action"],
  reason = `Permission is needed for ${action}`,
): RequestedAction {
  return { action, reason };
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
    host: { provider: "openai" },
  });

  assert.equal(executor.calls.length, 1);
  // Same provider now resolves to that provider's CLI: there is no native
  // VS Code route, because no VS Code host identity exists.
  assert.equal(result.route.routingReason, "same_provider_configured_cli");
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
  await configure(fixture, "researcher", "anthropic", "cli");
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
    host: { provider: "openai" },
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
    host: { provider: "openai" },
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
    host: { provider: "openai" },
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
    host: { provider: "openai" },
  });
  await invocation.invokeUserAgent({
    sessionId,
    agent: "examiner",
    host: { provider: "openai" },
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
    host: { provider: "openai" },
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
  const executor = new FakeAgentExecutor(({ context, executionPolicy }) => {
    assert.equal(context.plan?.current, null);
    assert.equal(context.plan?.hasPendingDraft, false);
    assert.equal(executionPolicy.sourceModification, "workspace_write");
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
    host: { provider: "openai" },
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
    host: { provider: "openai" },
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

  const invocation = service(fixture, executor);
  const result = await invocation.invokeUserAgent({
    sessionId,
    agent: "reviewer",
    host: { provider: "openai" },
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
      host: { provider: "openai" },
    }),
    AgentUnconfiguredError,
  );

  await configure(fixture, "planner", "anthropic", "cli");
  await fixture.configs.removeProvider("anthropic");
  await assert.rejects(
    invocation.invokeUserAgent({
      sessionId,
      agent: "planner",
      host: { provider: "openai" },
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
      host: { provider: "openai" },
    }),
    InvalidAgentModelError,
  );

  assert.equal(executor.calls.length, 0);
});

test("invalid and unavailable provider routes stop before execution", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "invoke-route-failures";
  await bindProject(fixture, sessionId);
  // An unsupported TARGET surface is refused before any availability lookup.
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
      host: { provider: "openai" },
    }),
    AgentTargetSurfaceUnsupportedError,
  );

  // A supported CLI target whose runtime is unavailable fails differently.
  await configure(fixture, "researcher", "anthropic", "cli");
  await assert.rejects(
    invocation.invokeUserAgent({
      sessionId,
      agent: "researcher",
      host: { provider: "openai" },
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
      host: { provider: "openai" },
    }),
    NoProjectBoundError,
  );
  const sessionId = "project-only-planner";
  await bindProject(fixture, sessionId);
  await assert.rejects(
    invocation.invokeUserAgent({
      sessionId,
      agent: "planner",
      host: { provider: "openai" },
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
      host: { provider: "openai" },
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
      host: { provider: "openai" },
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
      host: { provider: "openai" },
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
      host: { provider: "openai" },
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
      host: { provider: "openai" },
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
      host: { provider: "openai" },
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
      host: { provider: "openai" },
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
    host: { provider: "openai" },
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
      host: { provider: "openai" },
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
      host: { provider: "openai" },
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
    host: { provider: "openai" },
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
    host: { provider: "openai" },
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
    host: { provider: "openai" },
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
    host: { provider: "openai" },
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
    host: { provider: "openai" },
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
    host: { provider: "openai" },
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
    host: { provider: "openai" },
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

test("explicit helper execution enforces allowed and ephemeral ask approval", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "helper-approval";
  await bindTask(fixture, sessionId);
  await configure(fixture, "researcher");
  await configure(fixture, "examiner");
  await configure(fixture, "questioner");
  await fixture.rules.setRule(
    "global",
    { kind: "agent_call", caller: "researcher", target: "examiner" },
    "allow",
  );
  await fixture.rules.setRule(
    "global",
    { kind: "agent_call", caller: "researcher", target: "questioner" },
    "ask",
  );
  const calls = [
    requestedCall("researcher", "examiner", "memory_update"),
    requestedCall("researcher", "questioner", "clarification"),
  ];
  const executor = new FakeAgentExecutor(({ context }) => {
    if (context.agent === "researcher") {
      return {
        agent: "researcher",
        outcome: "success",
        summary: "Main research complete.",
        researchArtifact: { findings: [] },
        requestedCalls: calls,
      };
    }
    if (context.agent === "examiner") {
      assert.deepEqual(context.handoff, calls[0]?.handoff);
      return {
        agent: "examiner",
        outcome: "success",
        summary: "No memory change needed.",
        memoryIntent: { kind: "none" },
      };
    }
    assert.equal(context.agent, "questioner");
    assert.deepEqual(context.handoff, calls[1]?.handoff);
    return {
      agent: "questioner",
      outcome: "needs_user",
      summary: "A question remains.",
      state: "pending_question",
      question: "Please clarify the constraint.",
    };
  });
  const invocation = service(fixture, executor);
  const parent = await invocation.invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });
  const rulesBefore = await fixture.store.readText("rules.jsonc");

  const allowed = await invocation.executeHelper({
    sessionId,
    parentInvocation: parent,
    helperClassification: parent.helperCalls[0]!,
    host: { provider: "openai" },
  });
  assert.equal(allowed.helperInvocation.agent, "examiner");
  assert.equal(allowed.helperInvocation.lineage.depth, 1);
  assert.equal(executor.calls.length, 2);

  await assert.rejects(
    invocation.executeHelper({
      sessionId,
      parentInvocation: parent,
      helperClassification: parent.helperCalls[1]!,
      host: { provider: "openai" },
    }),
    AgentCallApprovalRequiredError,
  );
  assert.equal(executor.calls.length, 2);

  const approved = await invocation.executeHelper({
    sessionId,
    parentInvocation: parent,
    helperClassification: parent.helperCalls[1]!,
    approvalGranted: true,
    host: { provider: "openai" },
  });
  assert.equal(approved.helperInvocation.agent, "questioner");
  assert.equal(approved.continuation.message, "Please clarify the constraint.");
  assert.equal(executor.calls.length, 3);
  assert.equal(await fixture.store.readText("rules.jsonc"), rulesBefore);

  await assert.rejects(
    invocation.executeHelper({
      sessionId,
      parentInvocation: parent,
      helperClassification: parent.helperCalls[1]!,
      host: { provider: "openai" },
    }),
    AgentCallApprovalRequiredError,
  );
  assert.equal(executor.calls.length, 3);
});

test("denied and immutable-forbidden helpers cannot execute even with approval", async (t) => {
  const deniedFixture = await createFixture(t);
  const deniedSession = "helper-denied";
  await bindTask(deniedFixture, deniedSession);
  await configure(deniedFixture, "researcher");
  await deniedFixture.rules.setRule(
    "global",
    { kind: "agent_call", caller: "researcher", target: "examiner" },
    "deny",
  );
  const deniedExecutor = new FakeAgentExecutor(() => ({
    agent: "researcher",
    outcome: "success",
    summary: "Denied helper requested.",
    researchArtifact: { findings: [] },
    requestedCalls: [
      requestedCall("researcher", "examiner", "memory_update"),
    ],
  }));
  const deniedService = service(deniedFixture, deniedExecutor);
  const deniedParent = await deniedService.invokeUserAgent({
    sessionId: deniedSession,
    agent: "researcher",
    host: { provider: "openai" },
  });
  await assert.rejects(
    deniedService.executeHelper({
      sessionId: deniedSession,
      parentInvocation: deniedParent,
      helperClassification: deniedParent.helperCalls[0]!,
      approvalGranted: true,
      host: { provider: "openai" },
    }),
    AgentCallDeniedError,
  );
  assert.equal(deniedExecutor.calls.length, 1);

  const forbiddenFixture = await createFixture(t);
  const forbiddenSession = "helper-forbidden";
  await bindTask(forbiddenFixture, forbiddenSession);
  await configure(forbiddenFixture, "planner");
  const forbiddenExecutor = new FakeAgentExecutor(() => ({
    agent: "planner",
    outcome: "success",
    summary: "Forbidden helper requested.",
    requestedCalls: [
      requestedCall("planner", "coder", "implementation_deviation"),
    ],
  }));
  const forbiddenService = service(forbiddenFixture, forbiddenExecutor);
  const forbiddenParent = await forbiddenService.invokeUserAgent({
    sessionId: forbiddenSession,
    agent: "planner",
    host: { provider: "openai" },
  });
  await assert.rejects(
    forbiddenService.executeHelper({
      sessionId: forbiddenSession,
      parentInvocation: forbiddenParent,
      helperClassification: forbiddenParent.helperCalls[0]!,
      approvalGranted: true,
      host: { provider: "openai" },
    }),
    AgentCallForbiddenError,
  );
  assert.equal(forbiddenExecutor.calls.length, 1);
});

test("helper execution reclassifies current rule state and reports refusal audit details", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "helper-rule-drift";
  await bindTask(fixture, sessionId);
  await configure(fixture, "researcher");
  const key = {
    kind: "agent_call" as const,
    caller: "researcher" as const,
    target: "examiner" as const,
  };
  await fixture.rules.setRule("global", key, "allow");
  const executor = new FakeAgentExecutor(() => ({
    agent: "researcher",
    outcome: "success",
    summary: "Allowed helper requested.",
    researchArtifact: { findings: [] },
    requestedCalls: [
      requestedCall("researcher", "examiner", "memory_update"),
    ],
  }));
  const invocation = service(fixture, executor);
  const parent = await invocation.invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });
  await fixture.rules.setRule("task", key, "deny", {
    projectId: fixture.project.id,
    taskId: fixture.task.id,
  });

  await assert.rejects(
    invocation.executeHelper({
      sessionId,
      parentInvocation: parent,
      helperClassification: parent.helperCalls[0]!,
      host: { provider: "openai" },
    }),
    (error: unknown) =>
      error instanceof AgentCallDeniedError &&
      error.details?.previousStatus === "allowed" &&
      error.details.currentStatus === "denied" &&
      error.details.source === "task",
  );
  assert.equal(executor.calls.length, 1);
});

test("ask approval cannot override a current deny and unavailable is never executable", async (t) => {
  const deniedFixture = await createFixture(t);
  const deniedSession = "helper-ask-drift";
  await bindTask(deniedFixture, deniedSession);
  await configure(deniedFixture, "researcher");
  const key = {
    kind: "agent_call" as const,
    caller: "researcher" as const,
    target: "examiner" as const,
  };
  await deniedFixture.rules.setRule("global", key, "ask");
  const deniedExecutor = new FakeAgentExecutor(() => ({
    agent: "researcher",
    outcome: "success",
    summary: "Ask helper requested.",
    researchArtifact: { findings: [] },
    requestedCalls: [requestedCall("researcher", "examiner", "memory_update")],
  }));
  const deniedService = service(deniedFixture, deniedExecutor);
  const deniedParent = await deniedService.invokeUserAgent({
    sessionId: deniedSession,
    agent: "researcher",
    host: { provider: "openai" },
  });
  await deniedFixture.rules.setRule("global", key, "deny");
  await assert.rejects(
    deniedService.executeHelper({
      sessionId: deniedSession,
      parentInvocation: deniedParent,
      helperClassification: deniedParent.helperCalls[0]!,
      approvalGranted: true,
      host: { provider: "openai" },
    }),
    AgentCallDeniedError,
  );
  assert.equal(deniedExecutor.calls.length, 1);

  const unavailableFixture = await createFixture(t);
  const unavailableSession = "helper-unavailable-execution";
  await bindTask(unavailableFixture, unavailableSession);
  await configure(unavailableFixture, "researcher");
  const unavailableExecutor = new FakeAgentExecutor(async () => {
    await unavailableFixture.store.writeJson("rules.jsonc", []);
    return {
      agent: "researcher",
      outcome: "success",
      summary: "Unavailable helper requested.",
      researchArtifact: { findings: [] },
      requestedCalls: [
        requestedCall("researcher", "examiner", "memory_update"),
      ],
    };
  });
  const unavailableService = service(unavailableFixture, unavailableExecutor);
  const unavailableParent = await unavailableService.invokeUserAgent({
    sessionId: unavailableSession,
    agent: "researcher",
    host: { provider: "openai" },
  });
  await assert.rejects(
    unavailableService.executeHelper({
      sessionId: unavailableSession,
      parentInvocation: unavailableParent,
      helperClassification: unavailableParent.helperCalls[0]!,
      approvalGranted: true,
      host: { provider: "openai" },
    }),
    AgentCallUnavailableError,
  );
  assert.equal(unavailableExecutor.calls.length, 1);
});

test("helper target configuration and runtime availability are revalidated", async (t) => {
  const configFixture = await createFixture(t);
  const configSession = "helper-config-drift";
  await bindTask(configFixture, configSession);
  await configure(configFixture, "researcher");
  await configure(configFixture, "examiner");
  await configFixture.rules.setRule(
    "global",
    { kind: "agent_call", caller: "researcher", target: "examiner" },
    "allow",
  );
  const configExecutor = new FakeAgentExecutor(() => ({
    agent: "researcher",
    outcome: "success",
    summary: "Helper requested before config drift.",
    researchArtifact: { findings: [] },
    requestedCalls: [requestedCall("researcher", "examiner", "memory_update")],
  }));
  const configService = service(configFixture, configExecutor);
  const configParent = await configService.invokeUserAgent({
    sessionId: configSession,
    agent: "researcher",
    host: { provider: "openai" },
  });
  await configFixture.configs.markUnconfigured("examiner");
  await assert.rejects(
    configService.executeHelper({
      sessionId: configSession,
      parentInvocation: configParent,
      helperClassification: configParent.helperCalls[0]!,
      host: { provider: "openai" },
    }),
    AgentUnconfiguredError,
  );
  assert.equal(configExecutor.calls.length, 1);

  const runtimeFixture = await createFixture(t);
  const runtimeSession = "helper-runtime-drift";
  await bindTask(runtimeFixture, runtimeSession);
  await configure(runtimeFixture, "researcher");
  await configure(runtimeFixture, "examiner", "anthropic", "cli");
  await runtimeFixture.rules.setRule(
    "global",
    { kind: "agent_call", caller: "researcher", target: "examiner" },
    "allow",
  );
  const availability = new FakeRuntimeAvailability(true);
  const runtimeExecutor = new FakeAgentExecutor(() => ({
    agent: "researcher",
    outcome: "success",
    summary: "Helper requested before runtime drift.",
    researchArtifact: { findings: [] },
    requestedCalls: [requestedCall("researcher", "examiner", "memory_update")],
  }));
  const runtimeService = service(runtimeFixture, runtimeExecutor, availability);
  const runtimeParent = await runtimeService.invokeUserAgent({
    sessionId: runtimeSession,
    agent: "researcher",
    host: { provider: "openai" },
  });
  availability.available = false;
  await assert.rejects(
    runtimeService.executeHelper({
      sessionId: runtimeSession,
      parentInvocation: runtimeParent,
      helperClassification: runtimeParent.helperCalls[0]!,
      host: { provider: "openai" },
    }),
    ProviderCliUnavailableError,
  );
  assert.equal(runtimeExecutor.calls.length, 1);
});

test("CODER explicitly resumes after PLANNER confirms the accepted plan", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "coder-planner-clarification-resume";
  await bindTask(fixture, sessionId);
  await configure(fixture, "coder");
  await configure(fixture, "planner");
  await fixture.plans.saveDraft(fixture.task.id, "# Accepted plan\n");
  await fixture.plans.acceptDraft(fixture.task.id);
  await fixture.rules.setRule(
    "global",
    { kind: "agent_call", caller: "coder", target: "planner" },
    "allow",
  );
  const helperRequest = requestedCall(
    "coder",
    "planner",
    "plan_clarification",
    "Confirm whether the accepted plan still covers the implementation.",
  );
  const executor = new FakeAgentExecutor(({ context }) => {
    if (executor.calls.length === 1) {
      assert.equal(context.agent, "coder");
      assert.equal(context.memory.task?.hasContent, false);
      return {
        agent: "coder",
        outcome: "success",
        summary: "Implementation paused for clarification.",
        workRecord: { files_changed: ["src/first.ts"] },
        requestedCalls: [helperRequest],
      };
    }
    if (executor.calls.length === 2) {
      assert.equal(context.agent, "planner");
      assert.deepEqual(context.handoff, helperRequest.handoff);
      assert.equal(context.plan?.current?.content, "# Accepted plan\n");
      return {
        agent: "planner",
        outcome: "success",
        summary: "Plan clarification complete.",
        consultation: {
          disposition: "plan_still_valid",
          message: "The accepted plan already covers this implementation detail.",
        },
      };
    }
    assert.equal(context.agent, "coder");
    assert.equal(context.plan?.current?.content, "# Accepted plan\n");
    assert.equal(context.plan?.hasPendingDraft, false);
    assert.equal(context.memory.task?.content, "fresh resume memory");
    assert.equal(context.handoff?.caller, "planner");
    assert.equal(context.handoff?.target, "coder");
    assert.match(context.handoff?.summary ?? "", /already covers/);
    assert.equal(
      context.rules.outgoingAgentCalls.find(
        ({ key }) => key.kind === "agent_call" && key.target === "researcher",
      )?.source,
      "task",
    );
    return {
      agent: "coder",
      outcome: "success",
      summary: "Implementation resumed after clarification.",
      workRecord: { files_changed: ["src/resumed.ts"] },
    };
  });
  const invocation = service(fixture, executor);
  const parent = await invocation.invokeUserAgent({
    sessionId,
    agent: "coder",
    host: { provider: "openai" },
  });
  assert.equal(parent.lineage.depth, 0);
  assert.equal(executor.calls.length, 1);

  const helper = await invocation.executeHelper({
    sessionId,
    parentInvocation: parent,
    helperClassification: parent.helperCalls[0]!,
    host: { provider: "openai" },
  });
  assert.equal(executor.calls.length, 2);
  assert.equal(helper.continuation.status, "ready");
  assert.equal(helper.continuation.helperOutcome.agent, "planner");
  assert.equal(helper.helperInvocation.lineage.depth, 1);
  assert.equal(
    helper.helperInvocation.lineage.parentInvocationId,
    parent.lineage.currentInvocationId,
  );
  assert.equal(await fixture.plans.getDraft(fixture.task.id), null);

  await fixture.memory.replaceCanonicalMemory(
    taskScope(fixture),
    "fresh resume memory",
  );
  await fixture.rules.setRule(
    "task",
    { kind: "agent_call", caller: "coder", target: "researcher" },
    "allow",
    { projectId: fixture.project.id, taskId: fixture.task.id },
  );
  const resumed = await invocation.resumeCaller({
    sessionId,
    helperExecution: helper,
    host: { provider: "openai" },
  });

  assert.equal(executor.calls.length, 3);
  assert.equal(resumed.agent, "coder");
  assert.equal(resumed.lineage.depth, 2);
  assert.equal(
    resumed.lineage.parentInvocationId,
    helper.helperInvocation.lineage.currentInvocationId,
  );
  assert.equal(resumed.lineage.rootInvocationId, parent.lineage.rootInvocationId);
  assert.equal(
    (await fixture.plans.getCurrent(fixture.task.id))?.content,
    "# Accepted plan\n",
  );
});

test("PLANNER revision helper persists a draft and blocks CODER resumption", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "coder-planner-revision-block";
  await bindTask(fixture, sessionId);
  await configure(fixture, "coder");
  await configure(fixture, "planner");
  await fixture.plans.saveDraft(fixture.task.id, "# Accepted plan\n");
  await fixture.plans.acceptDraft(fixture.task.id);
  await fixture.rules.setRule(
    "global",
    { kind: "agent_call", caller: "coder", target: "planner" },
    "allow",
  );
  const executor = new FakeAgentExecutor(({ context }) =>
    context.agent === "coder"
      ? {
          agent: "coder",
          outcome: "success",
          summary: "A material deviation needs planning.",
          workRecord: { files_changed: [] },
          requestedCalls: [
            requestedCall("coder", "planner", "plan_revision"),
          ],
        }
      : {
          agent: "planner",
          outcome: "success",
          summary: "A revised plan is required.",
          consultation: {
            disposition: "revision_required",
            message: "Review and accept the revised plan before continuing.",
          },
          draftPlanMarkdown: "# Proposed revision\n",
        },
  );
  const invocation = service(fixture, executor);
  const parent = await invocation.invokeUserAgent({
    sessionId,
    agent: "coder",
    host: { provider: "openai" },
  });
  const helper = await invocation.executeHelper({
    sessionId,
    parentInvocation: parent,
    helperClassification: parent.helperCalls[0]!,
    host: { provider: "openai" },
  });

  assert.equal(executor.calls.length, 2);
  assert.equal(helper.continuation.status, "blocked_by_pending_plan");
  assert.equal(
    (await fixture.plans.getDraft(fixture.task.id))?.content,
    "# Proposed revision\n",
  );
  assert.equal(
    (await fixture.plans.getCurrent(fixture.task.id))?.content,
    "# Accepted plan\n",
  );
  await assert.rejects(
    invocation.resumeCaller({
      sessionId,
      helperExecution: helper,
      host: { provider: "openai" },
    }),
    PlanDraftPendingError,
  );
  assert.equal(executor.calls.length, 2);
});

test("CODER to PLANNER helper loses authority when the accepted plan is removed", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "coder-planner-plan-drift";
  await bindTask(fixture, sessionId);
  await configure(fixture, "coder");
  await fixture.plans.saveDraft(fixture.task.id, "# Accepted plan\n");
  await fixture.plans.acceptDraft(fixture.task.id);
  await fixture.rules.setRule(
    "global",
    { kind: "agent_call", caller: "coder", target: "planner" },
    "allow",
  );
  const executor = new FakeAgentExecutor(() => ({
    agent: "coder",
    outcome: "success",
    summary: "Planner clarification requested.",
    workRecord: { files_changed: [] },
    requestedCalls: [requestedCall("coder", "planner", "plan_clarification")],
  }));
  const invocation = service(fixture, executor);
  const parent = await invocation.invokeUserAgent({
    sessionId,
    agent: "coder",
    host: { provider: "openai" },
  });
  await fixture.plans.archiveCurrent(fixture.task.id);

  await assert.rejects(
    invocation.executeHelper({
      sessionId,
      parentInvocation: parent,
      helperClassification: parent.helperCalls[0]!,
      host: { provider: "openai" },
    }),
    AgentCallForbiddenError,
  );
  assert.equal(executor.calls.length, 1);
});

test("helper artifact continuation rebuilds fresh caller context", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "artifact-continuation";
  await bindTask(fixture, sessionId);
  await configure(fixture, "questioner");
  await configure(fixture, "researcher");
  await fixture.rules.setRule(
    "global",
    { kind: "agent_call", caller: "questioner", target: "researcher" },
    "allow",
  );
  const call = requestedCall(
    "questioner",
    "researcher",
    "research",
    "Research the unresolved requirement.",
  );
  const executor = new FakeAgentExecutor(({ context }) => {
    if (executor.calls.length === 1) {
      assert.equal(context.agent, "questioner");
      assert.equal(context.memory.task?.hasContent, false);
      return {
        agent: "questioner",
        outcome: "success",
        summary: "Research is needed.",
        state: "context_complete",
        requestedCalls: [call],
      };
    }
    if (executor.calls.length === 2) {
      assert.equal(context.agent, "researcher");
      assert.deepEqual(context.handoff, call.handoff);
      return {
        agent: "researcher",
        outcome: "success",
        summary: "The evidence resolves the requirement.",
        researchArtifact: { findings: ["verified"] },
      };
    }
    assert.equal(context.agent, "questioner");
    assert.equal(context.memory.task?.content, "state changed after helper");
    assert.equal(context.artifacts.explicitlyReferenced.length, 1);
    assert.equal(
      context.artifacts.explicitlyReferenced[0]?.category,
      "researcher",
    );
    assert.equal(context.handoff?.artifactRefs?.length, 1);
    assert.equal(
      context.rules.outgoingAgentCalls.find(
        ({ key }) => key.kind === "agent_call" && key.target === "examiner",
      )?.source,
      "task",
    );
    return {
      agent: "questioner",
      outcome: "success",
      summary: "Questioner resumed with explicit evidence.",
      state: "context_complete",
    };
  });
  const invocation = service(fixture, executor);
  const parent = await invocation.invokeUserAgent({
    sessionId,
    agent: "questioner",
    host: { provider: "openai" },
  });
  const helper = await invocation.executeHelper({
    sessionId,
    parentInvocation: parent,
    helperClassification: parent.helperCalls[0]!,
    host: { provider: "openai" },
  });
  assert.equal(executor.calls.length, 2);
  assert.equal(helper.continuation.helperArtifactRefs.length, 1);
  assert.equal(helper.continuation.handoff.artifactRefs?.length, 1);
  assert.equal(
    (await fixture.artifacts.listResearchArtifacts(taskScope(fixture))).length,
    1,
  );

  await fixture.memory.replaceCanonicalMemory(
    taskScope(fixture),
    "state changed after helper",
  );
  await fixture.rules.setRule(
    "task",
    { kind: "agent_call", caller: "questioner", target: "examiner" },
    "ask",
    { projectId: fixture.project.id, taskId: fixture.task.id },
  );
  await invocation.resumeCaller({
    sessionId,
    helperExecution: helper,
    host: { provider: "openai" },
  });
  assert.equal(executor.calls.length, 3);
});

test("nested helpers stay explicit, carry lineage, and obey the maximum depth", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "nested-helper-depth";
  await bindTask(fixture, sessionId);
  await configure(fixture, "researcher");
  await configure(fixture, "examiner");
  await fixture.rules.setRule(
    "global",
    { kind: "agent_call", caller: "researcher", target: "examiner" },
    "allow",
  );
  await fixture.rules.setRule(
    "global",
    { kind: "agent_call", caller: "examiner", target: "researcher" },
    "allow",
  );
  const firstCall = requestedCall(
    "researcher",
    "examiner",
    "memory_update",
  );
  const nestedCall = requestedCall("examiner", "researcher", "research");
  let executionCount = 0;
  const executor = new FakeAgentExecutor(({ context }) => {
    executionCount += 1;
    if (context.agent === "examiner") {
      return {
        agent: "examiner",
        outcome: "success",
        summary: "Memory review requests supporting research.",
        memoryIntent: { kind: "none" },
        requestedCalls: [nestedCall],
      };
    }
    return {
      agent: "researcher",
      outcome: "success",
      summary: "Research execution complete.",
      researchArtifact: { findings: [] },
      ...(executionCount === 1 ? { requestedCalls: [firstCall] } : {}),
    };
  });
  const invocation = service(fixture, executor);
  const root = await invocation.invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });
  const helper = await invocation.executeHelper({
    sessionId,
    parentInvocation: root,
    helperClassification: root.helperCalls[0]!,
    host: { provider: "openai" },
  });
  assert.equal(executor.calls.length, 2);
  assert.equal(helper.helperInvocation.helperCalls[0]?.status, "allowed");
  assert.equal(helper.helperInvocation.lineage.depth, 1);

  const nested = await invocation.executeHelper({
    sessionId,
    parentInvocation: helper.helperInvocation,
    helperClassification: helper.helperInvocation.helperCalls[0]!,
    host: { provider: "openai" },
  });
  assert.equal(executor.calls.length, 3);
  assert.equal(nested.helperInvocation.lineage.depth, 2);
  assert.equal(
    nested.helperInvocation.lineage.rootInvocationId,
    root.lineage.rootInvocationId,
  );
  assert.equal(
    nested.helperInvocation.lineage.parentInvocationId,
    helper.helperInvocation.lineage.currentInvocationId,
  );

  const deepParent: AnyAgentInvocationResult = {
    ...helper.helperInvocation,
    lineage: { ...helper.helperInvocation.lineage, depth: 8 },
  };
  await assert.rejects(
    invocation.executeHelper({
      sessionId,
      parentInvocation: deepParent,
      helperClassification: deepParent.helperCalls[0]!,
      host: { provider: "openai" },
    }),
    AgentInvocationDepthExceededError,
  );
  assert.equal(executor.calls.length, 3);

  const newRoot = await invocation.invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });
  assert.equal(newRoot.lineage.depth, 0);
  assert.equal(newRoot.lineage.parentInvocationId, null);
  assert.notEqual(newRoot.lineage.rootInvocationId, root.lineage.rootInvocationId);
  assert.equal(executor.calls.length, 4);
});

test("REVIEWER helper applies its own result but never archives the task", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "reviewer-helper-no-archive";
  await bindTask(fixture, sessionId);
  await configure(fixture, "researcher");
  await configure(fixture, "reviewer");
  await fixture.artifacts.saveCoderWorkRecord(taskScope(fixture), {
    files_changed: ["src/review-target.ts"],
  });
  await fixture.rules.setRule(
    "global",
    { kind: "agent_call", caller: "researcher", target: "reviewer" },
    "allow",
  );
  const executor = new FakeAgentExecutor(({ context }) =>
    context.agent === "researcher"
      ? {
          agent: "researcher",
          outcome: "success",
          summary: "Reviewer evidence requested.",
          researchArtifact: { findings: [] },
          requestedCalls: [
            requestedCall("researcher", "reviewer", "review_followup"),
          ],
        }
      : {
          agent: "reviewer",
          outcome: "success",
          summary: "Review passed.",
          reviewStatus: "PASS",
          report: { requirement_compliance: true },
        },
  );
  const invocation = service(fixture, executor);
  const parent = await invocation.invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });
  await invocation.executeHelper({
    sessionId,
    parentInvocation: parent,
    helperClassification: parent.helperCalls[0]!,
    host: { provider: "openai" },
  });

  assert.equal(
    (await fixture.tasks.get(fixture.project.id, fixture.task.id)).status,
    "completed",
  );
  assert.equal(
    (await fixture.tasks.listArchived(fixture.project.id)).some(
      ({ id }) => id === fixture.task.id,
    ),
    false,
  );
  assert.equal(executor.calls.length, 2);
});

test("action requests classify allow, ask, deny, and default deny in result order", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "action-rule-matrix";
  await bindTask(fixture, sessionId);
  await configure(fixture, "researcher");
  await fixture.rules.setRule(
    "global",
    { kind: "action", action: "network" },
    "deny",
  );
  await fixture.rules.setRule(
    "project",
    { kind: "action", action: "network" },
    "ask",
    { projectId: fixture.project.id },
  );
  await fixture.rules.setRule(
    "task",
    { kind: "action", action: "network" },
    "allow",
    { projectId: fixture.project.id, taskId: fixture.task.id },
  );
  await fixture.rules.setRule(
    "project",
    { kind: "action", action: "git_push" },
    "ask",
    { projectId: fixture.project.id },
  );
  await fixture.rules.setRule(
    "global",
    { kind: "action", action: "ci" },
    "deny",
  );
  const executor = new FakeAgentExecutor(({ executionPolicy }) => {
    assert.equal(executionPolicy.sourceModification, "read_only");
    assert.deepEqual(executionPolicy.providerCapabilities.network, {
      decision: "allow",
      source: "task",
      approvedForInvocation: false,
    });
    assert.equal("git_push" in executionPolicy.providerCapabilities, false);
    assert.equal("ci" in executionPolicy.providerCapabilities, false);
    return {
      agent: "researcher",
      outcome: "success",
      summary: "Action classification requested.",
      researchArtifact: { findings: ["local"] },
      requestedActions: [
        requestedAction("network"),
        requestedAction("git_push"),
        requestedAction("ci"),
      ],
    };
  });

  const result = await service(fixture, executor).invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });

  assert.deepEqual(
    result.actionClassifications.map(({ status }) => status),
    ["allowed", "approval_required", "denied"],
  );
  assert.deepEqual(
    result.actionClassifications.map(({ executionKind }) => executionKind),
    ["provider_capability", "host_action", "host_action"],
  );
  assert.deepEqual(
    result.actionClassifications.map(({ effectiveRule }) =>
      effectiveRule?.source
    ),
    ["task", "project", "global"],
  );
  assert.deepEqual(
    result.processedResult.requestedActions,
    result.actionClassifications.map(({ request }) => request),
  );

  await fixture.rules.removeRule(
    "global",
    { kind: "action", action: "ci" },
  );
  const defaultExecutor = new FakeAgentExecutor(() => ({
    agent: "researcher",
    outcome: "success",
    summary: "Default-denied action requested.",
    researchArtifact: { findings: [] },
    requestedActions: [requestedAction("ci")],
  }));
  const defaultResult = await service(
    fixture,
    defaultExecutor,
  ).invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });
  assert.equal(defaultResult.actionClassifications[0]?.status, "denied");
  assert.equal(
    defaultResult.actionClassifications[0]?.effectiveRule?.source,
    "default_deny",
  );

  await fixture.rules.removeRule(
    "task",
    { kind: "action", action: "network" },
    { projectId: fixture.project.id, taskId: fixture.task.id },
  );
  await fixture.rules.removeRule(
    "project",
    { kind: "action", action: "network" },
    { projectId: fixture.project.id },
  );
  await fixture.rules.removeRule(
    "global",
    { kind: "action", action: "network" },
  );
  const defaultPolicyExecutor = new FakeAgentExecutor(({ executionPolicy }) => {
    assert.deepEqual(executionPolicy.providerCapabilities.network, {
      decision: "deny",
      source: "default_deny",
      approvedForInvocation: false,
    });
    return {
      agent: "researcher",
      outcome: "success",
      summary: "Default provider policy checked.",
      researchArtifact: { findings: [] },
    };
  });
  await service(fixture, defaultPolicyExecutor).invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });
});

test("direct USER invocation applies action rules and action/helper requests coexist", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "direct-user-action-policy";
  await bindProject(fixture, sessionId);
  await configure(fixture, "researcher");
  await fixture.rules.setRule(
    "global",
    { kind: "agent_call", caller: "researcher", target: "examiner" },
    "allow",
  );
  const executor = new FakeAgentExecutor(({ executionPolicy }) => {
    assert.deepEqual(executionPolicy.providerCapabilities.network, {
      decision: "ask",
      source: "global",
      approvedForInvocation: false,
    });
    return {
      agent: "researcher",
      outcome: "blocked",
      summary: "Both permissions requested.",
      researchArtifact: { findings: [] },
      requestedCalls: [
        requestedCall("researcher", "examiner", "memory_update"),
      ],
      requestedActions: [requestedAction("network")],
    };
  });

  const result = await service(fixture, executor).invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });

  assert.equal(result.helperCalls[0]?.status, "allowed");
  assert.equal(result.actionClassifications[0]?.status, "approval_required");
});

test("malformed requested action and unexpected classification failure mutate no workflow state", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "invalid-action-no-mutation";
  await bindProject(fixture, sessionId);
  await configure(fixture, "researcher");
  const malformedExecutor = new FakeAgentExecutor(() => ({
    agent: "researcher",
    outcome: "success",
    summary: "Malformed action.",
    researchArtifact: { findings: [] },
    requestedActions: [{ action: "shell", reason: "Not a known action." }],
  }));

  await assert.rejects(
    service(fixture, malformedExecutor).invokeUserAgent({
      sessionId,
      agent: "researcher",
      host: { provider: "openai" },
    }),
    InvalidAgentResultError,
  );
  assert.deepEqual(
    await fixture.artifacts.listResearchArtifacts({
      kind: "project",
      projectId: fixture.project.id,
    }),
    [],
  );

  const classificationFailureExecutor = new FakeAgentExecutor(async () => {
    await fixture.store.writeText("rules.jsonc", "{ invalid jsonc");
    return {
      agent: "researcher",
      outcome: "success",
      summary: "Valid result before classification failure.",
      researchArtifact: { findings: [] },
      requestedActions: [requestedAction("network")],
    };
  });
  await assert.rejects(
    service(fixture, classificationFailureExecutor).invokeUserAgent({
      sessionId,
      agent: "researcher",
      host: { provider: "openai" },
    }),
    SyntaxError,
  );
  assert.deepEqual(
    await fixture.artifacts.listResearchArtifacts({
      kind: "project",
      projectId: fixture.project.id,
    }),
    [],
  );
});

test("corrupt action rule is unavailable while the valid main result is processed", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "action-rule-unavailable";
  await bindProject(fixture, sessionId);
  await configure(fixture, "researcher");
  const executor = new FakeAgentExecutor(async () => {
    await fixture.store.writeJson("rules.jsonc", {
      agent_calls: {},
      actions: { network: "corrupt" },
    });
    return {
      agent: "researcher",
      outcome: "success",
      summary: "Main result remains valid.",
      researchArtifact: { findings: ["persist me"] },
      requestedActions: [requestedAction("network")],
    };
  });

  const invocation = service(fixture, executor);
  const result = await invocation.invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });

  assert.deepEqual(result.actionClassifications[0], {
    status: "unavailable",
    request: requestedAction("network"),
    executionKind: "provider_capability",
    effectiveRule: null,
    errorCode: "INVALID_RULE_VALUE",
  });
  await assert.rejects(
    invocation.resumeCallerWithActionApproval({
      sessionId,
      previousInvocation: result,
      actionClassification: result.actionClassifications[0]!,
      approvalGranted: true,
      host: { provider: "openai" },
    }),
    InvalidActionContinuationError,
  );
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

test("one-time action approval resumes with fresh context and is never persisted", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "one-time-action-approval";
  await bindProject(fixture, sessionId);
  await configure(fixture, "researcher");
  const observedApprovals: boolean[] = [];
  const observedNetworkMechanisms: string[] = [];
  const observedMemory: Array<string | null> = [];
  const executor = new FakeAgentExecutor(({ context, executionPolicy }) => {
    observedApprovals.push(
      executionPolicy.providerCapabilities.network.approvedForInvocation,
    );
    observedNetworkMechanisms.push(
      resolveCodexExecutionPolicy(executionPolicy).network.mechanism,
    );
    observedMemory.push(context.memory.project.content);
    return {
      agent: "researcher",
      outcome: "success",
      summary: "Research invocation complete.",
      researchArtifact: { findings: [] },
      ...(observedApprovals.length === 1
        ? { requestedActions: [requestedAction("network")] }
        : {}),
    };
  });
  const invocation = service(fixture, executor);
  const rulesBefore = await fixture.store.readText("rules.jsonc");
  const parent = await invocation.invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });
  const classification = parent.actionClassifications[0]!;

  await assert.rejects(
    invocation.resumeCallerWithActionApproval({
      sessionId,
      previousInvocation: parent,
      actionClassification: {
        ...classification,
        request: requestedAction("ci"),
      },
      approvalGranted: true,
      host: { provider: "openai" },
    }),
    InvalidActionContinuationError,
  );
  assert.equal(executor.calls.length, 1);

  await assert.rejects(
    invocation.resumeCallerWithActionApproval({
      sessionId,
      previousInvocation: parent,
      actionClassification: classification,
      approvalGranted: false,
      host: { provider: "openai" },
    }),
    (error: unknown) =>
      error instanceof ActionApprovalRequiredError &&
      error.code === "ACTION_APPROVAL_REQUIRED",
  );
  assert.equal(executor.calls.length, 1);

  await fixture.memory.replaceCanonicalMemory(
    { kind: "project", projectId: fixture.project.id },
    "fresh continuation memory",
  );

  const resumed = await invocation.resumeCallerWithActionApproval({
    sessionId,
    previousInvocation: parent,
    actionClassification: classification,
    approvalGranted: true,
    host: { provider: "openai" },
  });
  assert.equal(
    resumed.lineage.parentInvocationId,
    parent.lineage.currentInvocationId,
  );
  assert.deepEqual(observedApprovals, [false, true]);
  assert.deepEqual(observedNetworkMechanisms, [
    "disabled",
    "hosted_web_search",
  ]);
  assert.deepEqual(
    resolveCodexExecutionPolicy(parent.executionPolicy).configOverrides,
    [CODEX_WEB_SEARCH_DISABLED_OVERRIDE],
  );
  assert.deepEqual(
    resolveCodexExecutionPolicy(resumed.executionPolicy).configOverrides,
    [CODEX_WEB_SEARCH_LIVE_OVERRIDE],
  );
  assert.deepEqual(observedMemory, [null, "fresh continuation memory"]);
  assert.equal(await fixture.store.readText("rules.jsonc"), rulesBefore);

  await invocation.invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });
  assert.deepEqual(observedApprovals, [false, true, false]);
  assert.deepEqual(observedNetworkMechanisms, [
    "disabled",
    "hosted_web_search",
    "disabled",
  ]);
});

test("CODER network allow and one-time approval grant only hosted web search", async (t) => {
  const allowFixture = await createFixture(t);
  const allowSession = "coder-network-allow";
  await bindTask(allowFixture, allowSession);
  await configure(allowFixture, "coder", "openai", "cli");
  await allowFixture.rules.setRule(
    "global",
    { kind: "action", action: "network" },
    "allow",
  );
  const allowExecutor = new FakeAgentExecutor(({ executionPolicy }) => {
    assert.deepEqual(resolveCodexExecutionPolicy(executionPolicy), {
      sandbox: "workspace-write",
      network: {
        enabled: true,
        mechanism: "hosted_web_search",
      },
      configOverrides: [
        CODEX_WORKSPACE_WRITE_NETWORK_DISABLED_OVERRIDE,
        CODEX_WEB_SEARCH_LIVE_OVERRIDE,
      ],
    });
    return {
      agent: "coder",
      outcome: "success",
      summary: "Allowed network policy observed.",
      workRecord: { files_changed: [] },
    };
  });
  await service(allowFixture, allowExecutor).invokeUserAgent({
    sessionId: allowSession,
    agent: "coder",
    host: { provider: "openai" },
  });
  assert.equal(allowExecutor.calls.length, 1);

  const askFixture = await createFixture(t);
  const askSession = "coder-network-ask";
  await bindTask(askFixture, askSession);
  await configure(askFixture, "coder", "openai", "cli");
  const observedNetworkStates: string[] = [];
  const askExecutor = new FakeAgentExecutor(({ executionPolicy }) => {
    const resolved = resolveCodexExecutionPolicy(executionPolicy);
    observedNetworkStates.push(resolved.network.mechanism);
    assert.deepEqual(
      resolved.configOverrides,
      observedNetworkStates.length === 1
        ? [
            CODEX_WORKSPACE_WRITE_NETWORK_DISABLED_OVERRIDE,
            CODEX_WEB_SEARCH_DISABLED_OVERRIDE,
          ]
        : [
            CODEX_WORKSPACE_WRITE_NETWORK_DISABLED_OVERRIDE,
            CODEX_WEB_SEARCH_LIVE_OVERRIDE,
          ],
    );
    return {
      agent: "coder",
      outcome: "success",
      summary: "Ask network policy observed.",
      workRecord: { files_changed: [] },
      ...(observedNetworkStates.length === 1
        ? { requestedActions: [requestedAction("network")] }
        : {}),
    };
  });
  const askInvocation = service(askFixture, askExecutor);
  const initial = await askInvocation.invokeUserAgent({
    sessionId: askSession,
    agent: "coder",
    host: { provider: "openai" },
  });
  assert.deepEqual(observedNetworkStates, ["disabled"]);
  await askInvocation.resumeCallerWithActionApproval({
    sessionId: askSession,
    previousInvocation: initial,
    actionClassification: initial.actionClassifications[0]!,
    approvalGranted: true,
    host: { provider: "openai" },
  });
  assert.deepEqual(observedNetworkStates, [
    "disabled",
    "hosted_web_search",
  ]);
});

test("CODER network deny remains disabled and cannot be approved", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "coder-network-deny";
  await bindTask(fixture, sessionId);
  await configure(fixture, "coder", "openai", "cli");
  await fixture.rules.setRule(
    "global",
    { kind: "action", action: "network" },
    "deny",
  );
  const executor = new FakeAgentExecutor(({ executionPolicy }) => {
    assert.deepEqual(resolveCodexExecutionPolicy(executionPolicy), {
      sandbox: "workspace-write",
      network: { enabled: false, mechanism: "disabled" },
      configOverrides: [
        CODEX_WORKSPACE_WRITE_NETWORK_DISABLED_OVERRIDE,
        CODEX_WEB_SEARCH_DISABLED_OVERRIDE,
      ],
    });
    return {
      agent: "coder",
      outcome: "success",
      summary: "Denied network remains unavailable.",
      workRecord: { files_changed: [] },
      requestedActions: [requestedAction("network")],
    };
  });
  const invocation = service(fixture, executor);
  const result = await invocation.invokeUserAgent({
    sessionId,
    agent: "coder",
    host: { provider: "openai" },
  });
  assert.equal(result.actionClassifications[0]?.status, "denied");
  await assert.rejects(
    invocation.resumeCallerWithActionApproval({
      sessionId,
      previousInvocation: result,
      actionClassification: result.actionClassifications[0]!,
      approvalGranted: true,
      host: { provider: "openai" },
    }),
    InvalidActionContinuationError,
  );
  assert.equal(executor.calls.length, 1);
});

test("action approval re-resolves current rules and denied classifications cannot be approved", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "action-approval-revalidation";
  await bindProject(fixture, sessionId);
  await configure(fixture, "researcher");
  const executor = new FakeAgentExecutor(() => ({
    agent: "researcher",
    outcome: "success",
    summary: "Action requested.",
    researchArtifact: { findings: [] },
    requestedActions: [requestedAction("network")],
  }));
  const invocation = service(fixture, executor);
  const askParent = await invocation.invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });

  await fixture.store.writeJson("rules.jsonc", {
    agent_calls: {},
    actions: { network: "corrupt", git_push: "ask", ci: "ask" },
  });
  await assert.rejects(
    invocation.resumeCallerWithActionApproval({
      sessionId,
      previousInvocation: askParent,
      actionClassification: askParent.actionClassifications[0]!,
      approvalGranted: true,
      host: { provider: "openai" },
    }),
    (error: unknown) =>
      error instanceof ActionUnavailableError &&
      error.code === "ACTION_UNAVAILABLE",
  );
  assert.equal(executor.calls.length, 1);
  await fixture.store.writeJson("rules.jsonc", {
    agent_calls: {},
    actions: { network: "ask", git_push: "ask", ci: "ask" },
  });

  await fixture.rules.setRule(
    "global",
    { kind: "action", action: "network" },
    "deny",
  );
  await assert.rejects(
    invocation.resumeCallerWithActionApproval({
      sessionId,
      previousInvocation: askParent,
      actionClassification: askParent.actionClassifications[0]!,
      approvalGranted: true,
      host: { provider: "openai" },
    }),
    (error: unknown) =>
      error instanceof ActionDeniedError && error.code === "ACTION_DENIED",
  );
  assert.equal(executor.calls.length, 1);

  const deniedParent = await invocation.invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });
  await assert.rejects(
    invocation.resumeCallerWithActionApproval({
      sessionId,
      previousInvocation: deniedParent,
      actionClassification: deniedParent.actionClassifications[0]!,
      approvalGranted: true,
      host: { provider: "openai" },
    }),
    (error: unknown) =>
      error instanceof InvalidActionContinuationError &&
      error.code === "INVALID_ACTION_CONTINUATION",
  );

  await fixture.rules.setRule(
    "global",
    { kind: "action", action: "network" },
    "ask",
  );
  const secondAskParent = await invocation.invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });
  await fixture.rules.setRule(
    "global",
    { kind: "action", action: "network" },
    "allow",
  );
  const allowedResume = await invocation.resumeCallerWithActionApproval({
    sessionId,
    previousInvocation: secondAskParent,
    actionClassification: secondAskParent.actionClassifications[0]!,
    approvalGranted: false,
    host: { provider: "openai" },
  });
  assert.deepEqual(allowedResume.executionPolicy.providerCapabilities.network, {
    decision: "allow",
    source: "global",
    approvedForInvocation: false,
  });
});

test("allowed host actions produce validated ephemeral authorizations without model resumption", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "host-action-allow";
  await bindTask(fixture, sessionId);
  await configure(fixture, "coder");
  await fixture.rules.setRule(
    "global",
    { kind: "action", action: "git_push" },
    "allow",
  );
  await fixture.rules.setRule(
    "global",
    { kind: "action", action: "ci" },
    "allow",
  );
  const executor = new FakeAgentExecutor(() => ({
    agent: "coder",
    outcome: "success",
    summary: "Implementation requests host operations.",
    workRecord: { files_changed: [] },
    requestedActions: [
      requestedAction("git_push", "Publish the implementation."),
      requestedAction("ci", "Run configured project CI."),
    ],
  }));
  const invocation = service(fixture, executor);
  const parent = await invocation.invokeUserAgent({
    sessionId,
    agent: "coder",
    host: { provider: "openai" },
  });

  const gitAuthorization = await invocation.authorizeHostAction({
    sessionId,
    previousInvocation: parent,
    actionClassification: parent.actionClassifications[0]!,
    approvalGranted: false,
  });
  const ciAuthorization = await invocation.authorizeHostAction({
    sessionId,
    previousInvocation: parent,
    actionClassification: parent.actionClassifications[1]!,
    approvalGranted: false,
  });

  assert.equal(executor.calls.length, 1);
  assert.equal(gitAuthorization.authorization.executionKind, "host_action");
  assert.equal(gitAuthorization.authorization.action, "git_push");
  assert.equal(gitAuthorization.authorization.approvedForAuthorization, false);
  assert.equal(gitAuthorization.authorization.sessionId, sessionId);
  assert.equal(gitAuthorization.context.projectId, fixture.project.id);
  assert.equal(gitAuthorization.context.sourcePath, fixture.project.sourcePath);
  assert.equal(gitAuthorization.context.taskId, fixture.task.id);
  assert.equal("command" in gitAuthorization.context, false);
  assert.equal("remote" in gitAuthorization.context, false);
  assert.equal(ciAuthorization.authorization.action, "ci");
  await invocation.validateHostActionAuthorization(gitAuthorization);
  await invocation.validateHostActionAuthorization(ciAuthorization);

  const fakeHostExecutor = new FakeHostActionExecutor();
  assert.equal(fakeHostExecutor.calls.length, 0);
  await fakeHostExecutor.execute(gitAuthorization);
  assert.equal(fakeHostExecutor.calls.length, 1);

  const forged = {
    ...gitAuthorization,
    authorization: {
      ...gitAuthorization.authorization,
      action: "ci" as const,
    },
  };
  await assert.rejects(
    invocation.validateHostActionAuthorization(forged),
    InvalidHostActionAuthorizationError,
  );
  const reconstructed = service(fixture, new FakeAgentExecutor(() => ({})));
  await assert.rejects(
    reconstructed.validateHostActionAuthorization(gitAuthorization),
    (error: unknown) =>
      error instanceof InvalidHostActionAuthorizationError &&
      error.code === "INVALID_HOST_ACTION_AUTHORIZATION",
  );
  await fixture.sessions.unbindTask(sessionId);
  await assert.rejects(
    invocation.validateHostActionAuthorization(gitAuthorization),
    (error: unknown) =>
      error instanceof InvalidHostActionAuthorizationError &&
      error.code === "INVALID_HOST_ACTION_AUTHORIZATION",
  );
});

test("host ask approval is explicit, does not change rules, and cannot use provider resumption", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "host-action-ask";
  await bindProject(fixture, sessionId);
  await configure(fixture, "researcher");
  const executor = new FakeAgentExecutor(() => ({
    agent: "researcher",
    outcome: "success",
    summary: "Host actions requested.",
    researchArtifact: { findings: [] },
    requestedActions: [requestedAction("git_push"), requestedAction("ci")],
  }));
  const invocation = service(fixture, executor);
  const parent = await invocation.invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });
  const rulesBefore = await fixture.store.readText("rules.jsonc");

  for (const actionClassification of parent.actionClassifications) {
    await assert.rejects(
      invocation.authorizeHostAction({
        sessionId,
        previousInvocation: parent,
        actionClassification,
        approvalGranted: false,
      }),
      (error: unknown) =>
        error instanceof HostActionApprovalRequiredError &&
        error.code === "HOST_ACTION_APPROVAL_REQUIRED",
    );
    const authorized = await invocation.authorizeHostAction({
      sessionId,
      previousInvocation: parent,
      actionClassification,
      approvalGranted: true,
    });
    assert.equal(authorized.authorization.approvedForAuthorization, true);
  }
  for (const actionClassification of parent.actionClassifications) {
    await assert.rejects(
      invocation.resumeCallerWithActionApproval({
        sessionId,
        previousInvocation: parent,
        actionClassification,
        approvalGranted: true,
        host: { provider: "openai" },
      }),
      (error: unknown) =>
        error instanceof InvalidActionExecutionKindError &&
        error.code === "INVALID_ACTION_EXECUTION_KIND",
    );
  }
  assert.equal(executor.calls.length, 1);
  assert.equal(await fixture.store.readText("rules.jsonc"), rulesBefore);
});

test("denied and unavailable host actions cannot be authorized", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "host-action-refusal";
  await bindProject(fixture, sessionId);
  await configure(fixture, "researcher");
  await fixture.rules.setRule(
    "global",
    { kind: "action", action: "git_push" },
    "deny",
  );
  const executor = new FakeAgentExecutor(() => ({
    agent: "researcher",
    outcome: "success",
    summary: "Host action requested.",
    researchArtifact: { findings: [] },
    requestedActions: [requestedAction("git_push")],
  }));
  const invocation = service(fixture, executor);
  const deniedParent = await invocation.invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });
  await assert.rejects(
    invocation.authorizeHostAction({
      sessionId,
      previousInvocation: deniedParent,
      actionClassification: deniedParent.actionClassifications[0]!,
      approvalGranted: true,
    }),
    (error: unknown) =>
      error instanceof HostActionDeniedError &&
      error.code === "HOST_ACTION_DENIED",
  );

  await fixture.store.writeJson("rules.jsonc", {
    agent_calls: {},
    actions: { git_push: "ask", network: "ask", ci: "ask" },
  });
  const askParent = await invocation.invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });
  await fixture.store.writeJson("rules.jsonc", {
    agent_calls: {},
    actions: { git_push: "corrupt", network: "ask", ci: "ask" },
  });
  await assert.rejects(
    invocation.authorizeHostAction({
      sessionId,
      previousInvocation: askParent,
      actionClassification: askParent.actionClassifications[0]!,
      approvalGranted: true,
    }),
    (error: unknown) =>
      error instanceof HostActionUnavailableError &&
      error.code === "HOST_ACTION_UNAVAILABLE",
  );
  assert.equal(executor.calls.length, 2);
});

test("host authorization re-resolves ask/allow/deny rule drift", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "host-action-rule-drift";
  await bindProject(fixture, sessionId);
  await configure(fixture, "researcher");
  const executor = new FakeAgentExecutor(() => ({
    agent: "researcher",
    outcome: "success",
    summary: "Git push requested.",
    researchArtifact: { findings: [] },
    requestedActions: [requestedAction("git_push")],
  }));
  const invocation = service(fixture, executor);

  const oldAskForDeny = await invocation.invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });
  await fixture.rules.setRule(
    "global",
    { kind: "action", action: "git_push" },
    "deny",
  );
  await assert.rejects(
    invocation.authorizeHostAction({
      sessionId,
      previousInvocation: oldAskForDeny,
      actionClassification: oldAskForDeny.actionClassifications[0]!,
      approvalGranted: true,
    }),
    HostActionDeniedError,
  );

  await fixture.rules.setRule(
    "global",
    { kind: "action", action: "git_push" },
    "ask",
  );
  const oldAskForAllow = await invocation.invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });
  await fixture.rules.setRule(
    "global",
    { kind: "action", action: "git_push" },
    "allow",
  );
  const allowed = await invocation.authorizeHostAction({
    sessionId,
    previousInvocation: oldAskForAllow,
    actionClassification: oldAskForAllow.actionClassifications[0]!,
    approvalGranted: false,
  });
  assert.equal(allowed.authorization.effectiveRule.decision, "allow");
  assert.equal(allowed.authorization.approvedForAuthorization, false);

  const oldAllowForAsk = await invocation.invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });
  await fixture.rules.setRule(
    "global",
    { kind: "action", action: "git_push" },
    "ask",
  );
  await assert.rejects(
    invocation.authorizeHostAction({
      sessionId,
      previousInvocation: oldAllowForAsk,
      actionClassification: oldAllowForAsk.actionClassifications[0]!,
      approvalGranted: false,
    }),
    HostActionApprovalRequiredError,
  );
  const approved = await invocation.authorizeHostAction({
    sessionId,
    previousInvocation: oldAllowForAsk,
    actionClassification: oldAllowForAsk.actionClassifications[0]!,
    approvalGranted: true,
  });
  assert.equal(approved.authorization.effectiveRule.decision, "ask");
  assert.equal(approved.authorization.approvedForAuthorization, true);

  await fixture.rules.setRule(
    "global",
    { kind: "action", action: "git_push" },
    "allow",
  );
  const oldAllowForDeny = await invocation.invokeUserAgent({
    sessionId,
    agent: "researcher",
    host: { provider: "openai" },
  });
  await fixture.rules.setRule(
    "global",
    { kind: "action", action: "git_push" },
    "deny",
  );
  await assert.rejects(
    invocation.authorizeHostAction({
      sessionId,
      previousInvocation: oldAllowForDeny,
      actionClassification: oldAllowForDeny.actionClassifications[0]!,
      approvalGranted: true,
    }),
    HostActionDeniedError,
  );
  assert.equal(executor.calls.length, 4);
});
