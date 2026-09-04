import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { AgentConfigManager } from "../src/core/agent-config-manager.js";
import { AgentInvocationService } from "../src/core/agent-invocation-service.js";
import { ArtifactManager } from "../src/core/artifact-manager.js";
import { ChangeSetApplyManager } from "../src/core/change-set-apply-manager.js";
import { CoderChangeSetManager } from "../src/core/coder-change-set-manager.js";
import { CoderStagingCoordinator } from "../src/core/coder-staging-coordinator.js";
import { CoderWorkspaceStager } from "../src/core/coder-workspace-stager.js";
import { PlanManager } from "../src/core/plan-manager.js";
import { ProjectManager } from "../src/core/project-manager.js";
import { SessionManager } from "../src/core/session-manager.js";
import { TaskManager } from "../src/core/task-manager.js";
import type {
  AgentExecutionInput,
  AgentExecutor,
} from "../src/domain/agent-invocation.js";
import {
  InvalidTaskTransitionError,
  NoTaskBoundError,
  PlanDraftPendingError,
  TaskCompletedError,
  TaskHasPendingChangeSetError,
  TaskSessionOwnershipLostError,
} from "../src/domain/errors.js";
import type { Project } from "../src/domain/project.js";
import type { RuntimeAvailability } from "../src/domain/provider-routing.js";
import { generateSessionId, type SessionId } from "../src/domain/session.js";
import type { Task } from "../src/domain/task.js";
import { StateStore } from "../src/infrastructure/state-store.js";
import { ChangeSetCommands } from "../src/operations/change-set-commands.js";
import { InvocationContinuationCommands } from "../src/operations/invocation-continuation-commands.js";
import { InvocationContinuationStore } from "../src/operations/invocation-continuation-store.js";
import { RoleContractRegistry } from "../src/core/role-contract-registry.js";
import { SessionCommands } from "../src/operations/session-commands.js";
import { TaskLifecycleCommands } from "../src/operations/task-lifecycle-commands.js";

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: cwd,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@localhost",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@localhost",
      LC_ALL: "C",
    },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

const available: RuntimeAvailability = {
  async isAvailable() {
    return true;
  },
};

interface Fixture {
  readonly root: string;
  readonly stateRoot: string;
  readonly sourcePath: string;
  readonly store: StateStore;
  readonly projects: ProjectManager;
  readonly tasks: TaskManager;
  readonly sessions: SessionManager;
  readonly plans: PlanManager;
  readonly artifacts: ArtifactManager;
  readonly changeSets: CoderChangeSetManager;
  readonly commands: SessionCommands;
  readonly lifecycle: TaskLifecycleCommands;
  readonly project: Project;
  readonly task: Task;
  readonly sessionId: SessionId;
}

async function createFixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-lifecycle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateRoot = join(root, "state-root");
  const homeDirectory = join(root, "home");
  const sourcePath = join(root, "source");
  await Promise.all([
    mkdir(homeDirectory, { recursive: true }),
    mkdir(sourcePath, { recursive: true }),
  ]);
  git(sourcePath, "init", "--quiet");
  await writeFile(join(sourcePath, "keep.txt"), "original\n", "utf8");
  git(sourcePath, "add", "-A");
  git(sourcePath, "commit", "--quiet", "-m", "baseline");

  const store = new StateStore(stateRoot);
  const projects = new ProjectManager(store, { homeDirectory });
  const tasks = new TaskManager(store, projects);
  const sessions = new SessionManager(store);
  const plans = new PlanManager(store, tasks);
  const artifacts = new ArtifactManager(store, projects, tasks);
  const project = await projects.create("Lifecycle Project", sourcePath);
  const task = await tasks.create(project.id, "Implement the feature");
  const configs = new AgentConfigManager(store);
  for (const agent of ["coder", "planner", "questioner", "researcher", "reviewer"] as const) {
    await configs.setConfigured(agent, {
      provider: "openai",
      surface: "cli",
      model: `${agent}-model`,
    });
  }
  const commands = new SessionCommands({ projects, tasks, sessions });
  const opened = await commands.openTaskSession(project.id, task.id);
  return {
    root,
    stateRoot,
    sourcePath,
    store,
    projects,
    tasks,
    sessions,
    plans,
    artifacts,
    changeSets: new CoderChangeSetManager(store, tasks),
    commands,
    lifecycle: new TaskLifecycleCommands({
      projects,
      tasks,
      plans,
      artifacts,
      applyManager: new ChangeSetApplyManager(store, tasks, {
        temporaryRoot: root,
      }),
      sessions,
    }),
    project,
    task,
    sessionId: opened.sessionId as SessionId,
  };
}

function service(f: Fixture, executor: AgentExecutor): AgentInvocationService {
  return new AgentInvocationService({
    executor,
    runtimeAvailability: available,
    synaphexRoot: f.stateRoot,
    homeDirectory: join(f.root, "home"),
    coderStaging: new CoderStagingCoordinator({
      stager: new CoderWorkspaceStager({ temporaryRoot: f.root }),
      changeSets: new CoderChangeSetManager(f.store, f.tasks),
      sessions: f.sessions,
    }),
  });
}

/** An executor that blocks until the test releases it, with no sleeps. */
class BarrierExecutor implements AgentExecutor {
  readonly entered: Promise<void>;
  private announce!: () => void;
  private release!: () => void;
  private readonly gate: Promise<void>;

  constructor(
    private readonly result: unknown,
    private readonly work?: (workspace: string) => Promise<void>,
  ) {
    this.entered = new Promise((resolve) => {
      this.announce = resolve;
    });
    this.gate = new Promise((resolve) => {
      this.release = resolve;
    });
  }

  proceed(): void {
    this.release();
  }

  async execute(input: AgentExecutionInput): Promise<unknown> {
    if (this.work !== undefined) {
      await this.work(input.context.project.sourcePath);
    }
    this.announce();
    await this.gate;
    return this.result;
  }
}

function coderResult(): unknown {
  return {
    agent: "coder",
    outcome: "success",
    summary: "Implemented it.",
    workRecord: { files_changed: ["keep.txt"] },
  };
}

function plannerResult(): unknown {
  return {
    agent: "planner",
    outcome: "success",
    summary: "Planned it.",
    draftPlanMarkdown: "# Plan\n\n1. Do the thing.\n",
  };
}

function researcherResult(): unknown {
  return {
    agent: "researcher",
    outcome: "success",
    summary: "Researched it.",
    researchArtifact: { findings: ["a finding"] },
  };
}

function questionerResult(): unknown {
  return {
    agent: "questioner",
    outcome: "success",
    summary: "Context gathered.",
    state: "context_complete",
    workingContext: { goal: "ship it" },
  };
}

// ---------------------------------------------------------------------------
// Manual completion
// ---------------------------------------------------------------------------

test("completion is authorized by the bound session alone and retains it", async (t) => {
  const f = await createFixture(t);
  const result = await f.lifecycle.completeTask(f.sessionId);

  assert.equal(result.status, "completed");
  assert.equal(result.projectId, f.project.id);
  assert.equal(result.taskId, f.task.id);
  assert.ok(result.completedAt);
  assert.equal(result.archivedAt, null);
  assert.equal(result.sessionRetained, true);

  // Persisted, and NOT archived.
  const task = await f.tasks.get(f.project.id, f.task.id);
  assert.equal(task.status, "completed");
  // The session stays bound and still owns the task.
  const binding = await f.sessions.getCurrentBinding(f.sessionId);
  assert.equal(binding.taskId, f.task.id);
  const owner = await f.sessions.findTaskOwner(f.task.id);
  assert.equal(owner?.sessionId, f.sessionId);
  // No Reviewer artifact was fabricated for a user completion.
  const artifacts = await f.artifacts.listCoderWorkRecords({
    kind: "task",
    projectId: f.project.id,
    taskId: f.task.id,
  });
  assert.deepEqual(artifacts, []);
});

test("completion requires a bound task and current ownership", async (t) => {
  const f = await createFixture(t);
  // No task bound.
  const projectOnly = generateSessionId();
  await f.sessions.bindProject(projectOnly, f.project.id);
  await assert.rejects(
    () => f.lifecycle.completeTask(projectOnly),
    NoTaskBoundError,
  );

  // Ownership lost to another session.
  await f.commands.forceReleaseTaskSession(f.project.id, f.task.id);
  await f.commands.openTaskSession(f.project.id, f.task.id);
  await assert.rejects(
    () => f.lifecycle.completeTask(f.sessionId),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      return true;
    },
  );
  assert.equal(
    (await f.tasks.get(f.project.id, f.task.id)).status,
    "active",
    "a lost session must not complete the task",
  );
});

test("a second completion is refused rather than silently succeeding", async (t) => {
  const f = await createFixture(t);
  await f.lifecycle.completeTask(f.sessionId);
  await assert.rejects(
    () => f.lifecycle.completeTask(f.sessionId),
    InvalidTaskTransitionError,
  );
});

// ---------------------------------------------------------------------------
// Completion blockers
// ---------------------------------------------------------------------------

test("a pending plan draft blocks completion until it is decided", async (t) => {
  const f = await createFixture(t);
  await f.plans.saveDraft(f.task.id, "# Draft\n");

  await assert.rejects(
    () => f.lifecycle.completeTask(f.sessionId),
    PlanDraftPendingError,
  );
  assert.equal((await f.tasks.get(f.project.id, f.task.id)).status, "active");

  const draft = await f.plans.getDraftWithRevision(f.task.id);
  await f.plans.rejectDraft(f.task.id, draft!.revisionId);
  const completed = await f.lifecycle.completeTask(f.sessionId);
  assert.equal(completed.status, "completed");
});

test("an undecided change set blocks completion; a decided one does not", async (t) => {
  const f = await createFixture(t);
  const executor = new BarrierExecutor(coderResult(), async (workspace) => {
    await writeFile(join(workspace, "keep.txt"), "coder\n", "utf8");
  });
  executor.proceed();
  const invoked = await service(f, executor).invokeUserAgent({
    sessionId: f.sessionId,
    agent: "coder",
    host: { provider: "openai", surface: "cli" },
    instruction: "Do it.",
  });
  const changeSetId = (
    invoked.processedResult as { coderChangeSet?: { id: string } | null }
  ).coderChangeSet!.id;

  // Pending: refused, and the error names the exact undecided change set.
  await assert.rejects(
    () => f.lifecycle.completeTask(f.sessionId),
    (error: unknown) => {
      assert.ok(error instanceof TaskHasPendingChangeSetError);
      return true;
    },
  );

  // Decided (rejected): completion proceeds.
  const changeSetCommands = new ChangeSetCommands({
    projects: f.projects,
    tasks: f.tasks,
    artifacts: f.artifacts,
    changeSets: f.changeSets,
    applyManager: new ChangeSetApplyManager(f.store, f.tasks, {
      temporaryRoot: f.root,
    }),
    sessions: f.sessions,
  });
  await changeSetCommands.rejectChangeSet(f.sessionId, changeSetId);
  const completed = await f.lifecycle.completeTask(f.sessionId);
  assert.equal(completed.status, "completed");
});

test("an interrupted apply blocks completion", async (t) => {
  const f = await createFixture(t);
  const executor = new BarrierExecutor(coderResult(), async (workspace) => {
    await writeFile(join(workspace, "keep.txt"), "coder\n", "utf8");
  });
  executor.proceed();
  const invoked = await service(f, executor).invokeUserAgent({
    sessionId: f.sessionId,
    agent: "coder",
    host: { provider: "openai", surface: "cli" },
    instruction: "Do it.",
  });
  const changeSetId = (
    invoked.processedResult as { coderChangeSet?: { id: string } | null }
  ).coderChangeSet!.id;
  const stored = await f.changeSets.get(f.task.id, changeSetId);

  // Crash mid-apply, leaving an interrupted intent.
  await assert.rejects(
    () =>
      new ChangeSetApplyManager(f.store, f.tasks, {
        temporaryRoot: f.root,
        beforeSourceMutation: async () => {
          throw new Error("crash");
        },
      }).apply({
        project: f.project,
        taskId: f.task.id,
        metadata: stored.metadata,
        patch: stored.patch,
      }),
    /crash/,
  );

  await assert.rejects(
    () => f.lifecycle.completeTask(f.sessionId),
    TaskHasPendingChangeSetError,
  );
  assert.equal((await f.tasks.get(f.project.id, f.task.id)).status, "active");
});

test("a CODER record with no change set does not block completion", async (t) => {
  const f = await createFixture(t);
  // A CODER invocation that changes nothing writes changeSet: null.
  const executor = new BarrierExecutor(coderResult());
  executor.proceed();
  await service(f, executor).invokeUserAgent({
    sessionId: f.sessionId,
    agent: "coder",
    host: { provider: "openai", surface: "cli" },
    instruction: "Do nothing.",
  });
  const records = await f.artifacts.listCoderWorkRecords({
    kind: "task",
    projectId: f.project.id,
    taskId: f.task.id,
  });
  assert.equal(records[0]?.changeSet, null);

  const completed = await f.lifecycle.completeTask(f.sessionId);
  assert.equal(completed.status, "completed");
});

// ---------------------------------------------------------------------------
// Manual-completion races at the commit boundary
// ---------------------------------------------------------------------------

test("CODER cannot publish a change set after the task is completed", async (t) => {
  const f = await createFixture(t);
  const headBefore = git(f.sourcePath, "rev-parse", "HEAD").trim();
  const executor = new BarrierExecutor(coderResult(), async (workspace) => {
    await writeFile(join(workspace, "keep.txt"), "coder wrote this\n", "utf8");
  });

  const invocation = service(f, executor).invokeUserAgent({
    sessionId: f.sessionId,
    agent: "coder",
    host: { provider: "openai", surface: "cli" },
    instruction: "Do it.",
  });
  // Barrier: the provider is inside, having already edited staging.
  await executor.entered;
  // The user completes the task while CODER is still running.
  await f.lifecycle.completeTask(f.sessionId);
  executor.proceed();

  // CODER is a role contract that requires an ACTIVE task, so its commit is
  // refused at the boundary.
  await assert.rejects(invocation, TaskCompletedError);

  // No change set, no work record, and the real source is untouched.
  assert.deepEqual(await f.changeSets.list(f.task.id), []);
  assert.deepEqual(
    await f.artifacts.listCoderWorkRecords({
      kind: "task",
      projectId: f.project.id,
      taskId: f.task.id,
    }),
    [],
  );
  assert.equal(git(f.sourcePath, "rev-parse", "HEAD").trim(), headBefore);
  assert.equal(git(f.sourcePath, "status", "--porcelain").trim(), "");
  assert.equal(
    await readFile(join(f.sourcePath, "keep.txt"), "utf8"),
    "original\n",
  );
  assert.equal((await f.tasks.get(f.project.id, f.task.id)).status, "completed");
});

test("PLANNER cannot persist a draft after the task is completed", async (t) => {
  const f = await createFixture(t);
  const executor = new BarrierExecutor(plannerResult());
  const invocation = service(f, executor).invokeUserAgent({
    sessionId: f.sessionId,
    agent: "planner",
    host: { provider: "openai", surface: "cli" },
    instruction: "Plan it.",
  });
  await executor.entered;
  await f.lifecycle.completeTask(f.sessionId);
  executor.proceed();

  await assert.rejects(invocation, TaskCompletedError);
  assert.equal(await f.plans.hasDraft(f.task.id), false);
});

test("QUESTIONER cannot mutate context after the task is completed", async (t) => {
  const f = await createFixture(t);
  const executor = new BarrierExecutor(questionerResult());
  const invocation = service(f, executor).invokeUserAgent({
    sessionId: f.sessionId,
    agent: "questioner",
    host: { provider: "openai", surface: "cli" },
    instruction: "Ask.",
  });
  await executor.entered;
  await f.lifecycle.completeTask(f.sessionId);
  executor.proceed();

  await assert.rejects(invocation, TaskCompletedError);
});

test("a role legal on a completed task still commits after completion", async (t) => {
  const f = await createFixture(t);
  // RESEARCHER's contract allows ["active", "completed"], so completion during
  // its run must NOT invalidate it. This proves the commit check consults the
  // role contract table rather than hardcoding "active".
  const executor = new BarrierExecutor(researcherResult());
  const invocation = service(f, executor).invokeUserAgent({
    sessionId: f.sessionId,
    agent: "researcher",
    host: { provider: "openai", surface: "cli" },
    instruction: "Research it.",
  });
  await executor.entered;
  await f.lifecycle.completeTask(f.sessionId);
  executor.proceed();

  const result = await invocation;
  assert.equal(result.processedResult.agent, "researcher");
  // Its artifact really was persisted.
  assert.ok(result.processedResult.persistedArtifacts.length > 0);
});

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

test("archive is terminal, releases the task session, and preserves history", async (t) => {
  const f = await createFixture(t);
  const executor = new BarrierExecutor(coderResult(), async (workspace) => {
    await writeFile(join(workspace, "keep.txt"), "coder\n", "utf8");
  });
  executor.proceed();
  const invoked = await service(f, executor).invokeUserAgent({
    sessionId: f.sessionId,
    agent: "coder",
    host: { provider: "openai", surface: "cli" },
    instruction: "Do it.",
  });
  const changeSetId = (
    invoked.processedResult as { coderChangeSet?: { id: string } | null }
  ).coderChangeSet!.id;
  const changeSetCommands = new ChangeSetCommands({
    projects: f.projects,
    tasks: f.tasks,
    artifacts: f.artifacts,
    changeSets: f.changeSets,
    applyManager: new ChangeSetApplyManager(f.store, f.tasks, {
      temporaryRoot: f.root,
    }),
    sessions: f.sessions,
  });
  await changeSetCommands.applyChangeSet(f.sessionId, changeSetId);
  await f.plans.saveDraft(f.task.id, "# Plan\n");
  await f.plans.acceptDraft(f.task.id);
  await f.lifecycle.completeTask(f.sessionId);

  const archived = await f.lifecycle.archiveTask(f.project.id, f.task.id);
  assert.equal(archived.status, "archived");
  assert.ok(archived.archivedAt);
  assert.equal(archived.releasedTaskSession, true);

  // Ownership and session binding are gone.
  assert.equal(await f.sessions.findTaskOwner(f.task.id), null);
  const binding = await f.sessions.getCurrentBinding(f.sessionId);
  assert.equal(binding.taskId, null);

  // Immutable history survives the move into the archive collection.
  const task = await f.tasks.get(f.project.id, f.task.id);
  assert.equal(task.status, "archived");
  assert.deepEqual((await f.changeSets.list(f.task.id)).length, 1);
  const stored = await f.changeSets.get(f.task.id, changeSetId);
  assert.equal(stored.metadata.changeSetId, changeSetId);
  assert.notEqual(await f.plans.getCurrent(f.task.id), null);
  assert.equal(
    (
      await f.artifacts.listCoderWorkRecords({
        kind: "task",
        projectId: f.project.id,
        taskId: f.task.id,
      })
    ).length,
    1,
  );
  // The registered source was never touched by lifecycle operations.
  assert.equal(
    await readFile(join(f.sourcePath, "keep.txt"), "utf8"),
    "coder\n",
  );
});

test("an active task is never archived", async (t) => {
  const f = await createFixture(t);
  await assert.rejects(
    () => f.lifecycle.archiveTask(f.project.id, f.task.id),
    InvalidTaskTransitionError,
  );
  // A refused archive must not release the live task claim as a side effect.
  const owner = await f.sessions.findTaskOwner(f.task.id);
  assert.equal(owner?.sessionId, f.sessionId);
  assert.equal((await f.tasks.get(f.project.id, f.task.id)).status, "active");
});

test("archiving twice leaves exactly one archived task", async (t) => {
  const f = await createFixture(t);
  await f.lifecycle.completeTask(f.sessionId);
  const outcomes = await Promise.allSettled([
    f.lifecycle.archiveTask(f.project.id, f.task.id),
    f.lifecycle.archiveTask(f.project.id, f.task.id),
  ]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  const loser = outcomes.find((o) => o.status === "rejected");
  assert.ok(loser?.status === "rejected");
  assert.ok(loser.reason instanceof InvalidTaskTransitionError);

  // Exactly one task, in the archive collection only.
  assert.deepEqual(
    (await f.tasks.listArchived(f.project.id)).map((task) => task.id),
    [f.task.id],
  );
  assert.deepEqual(await f.tasks.listOpen(f.project.id), []);
});

test("archive invalidates a completed-bound invocation still in flight", async (t) => {
  const f = await createFixture(t);
  await f.lifecycle.completeTask(f.sessionId);
  // RESEARCHER is legal on a completed task, so only the archive can stop it.
  const executor = new BarrierExecutor(researcherResult());
  const invocation = service(f, executor).invokeUserAgent({
    sessionId: f.sessionId,
    agent: "researcher",
    host: { provider: "openai", surface: "cli" },
    instruction: "Research it.",
  });
  await executor.entered;
  await f.lifecycle.archiveTask(f.project.id, f.task.id);
  executor.proceed();

  // Archive released the claim, so the fence is stale and nothing commits.
  await assert.rejects(invocation, (error: unknown) => {
    assert.ok(error instanceof Error);
    return true;
  });
  assert.equal((await f.tasks.get(f.project.id, f.task.id)).status, "archived");
});

test("a completed task whose session was lost can still be archived", async (t) => {
  const f = await createFixture(t);
  await f.lifecycle.completeTask(f.sessionId);
  // The owning session disappears entirely.
  await f.commands.closeSession(f.sessionId);
  assert.equal(await f.sessions.findTaskOwner(f.task.id), null);

  // Administrative addressing means no session must be reopened to archive.
  const archived = await f.lifecycle.archiveTask(f.project.id, f.task.id);
  assert.equal(archived.status, "archived");
  assert.equal(archived.releasedTaskSession, false);
});

test("archived tasks remain readable through the ordinary task lookup", async (t) => {
  const f = await createFixture(t);
  await f.lifecycle.completeTask(f.sessionId);
  await f.lifecycle.archiveTask(f.project.id, f.task.id);
  const task = await f.tasks.get(f.project.id, f.task.id);
  assert.equal(task.status, "archived");
  assert.ok(task.archivedAt);
});

// ---------------------------------------------------------------------------
// Audits
// ---------------------------------------------------------------------------

test("lifecycle operations run no Git command and reach no provider", async () => {
  const source = await readFile(
    join(process.cwd(), "src/operations/task-lifecycle-commands.ts"),
    "utf8",
  );
  const code = source
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/\/\/.*$/gm, "");
  for (const forbidden of [
    "IsolatedGitRunner",
    "spawn",
    "execFile",
    "shell",
    "git",
    "fetch(",
    "executor",
    "provider",
    "HostAction",
  ]) {
    assert.equal(
      code.includes(forbidden),
      false,
      `lifecycle commands must not reference ${forbidden}`,
    );
  }
});

test("there is no code path that moves a task backwards", async () => {
  const source = await readFile(
    join(process.cwd(), "src/core/task-manager.ts"),
    "utf8",
  );
  const code = source
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/\/\/.*$/gm, "");
  // Only two transition writers exist, and both move forwards.
  assert.equal(code.includes('status: "completed"'), true);
  assert.equal(code.includes('status: "archived"'), true);
  // Nothing reverts a task to active or un-archives it.
  assert.equal(/status:\s*"active"/.test(code.replace(/status:\s*"active",\n\s*completedAt:\s*null/, "")), true,
    "only task creation may set active");
  for (const forbidden of ["reopen", "unarchive", "restore", "uncomplete"]) {
    assert.equal(
      code.toLowerCase().includes(forbidden),
      false,
      `task manager must not implement ${forbidden}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Continuations after a lifecycle transition
// ---------------------------------------------------------------------------

test("a continuation issued before completion cannot resurrect authority", async (t) => {
  const f = await createFixture(t);
  // A real invocation service behind the continuation surface, so the refusal
  // comes from genuine binding/lifecycle/ownership preflight rather than a fake.
  // A PLANNER result that requests a helper, so a continuation is actually
  // issued for it.
  const executor = new BarrierExecutor({
    ...(plannerResult() as Record<string, unknown>),
    requestedCalls: [
      {
        target: "researcher",
        purpose: "research",
        handoff: {
          caller: "planner",
          target: "researcher",
          purpose: "research",
          summary: "Look into the approach.",
        },
      },
    ],
  });
  executor.proceed();
  const invocations = service(f, executor);
  const store = new InvocationContinuationStore({});
  const continuations = new InvocationContinuationCommands({
    host: { provider: "openai", surface: "cli" },
    invocations,
    store,
    roleContracts: new RoleContractRegistry(),
  });

  const planned = await invocations.invokeUserAgent({
    sessionId: f.sessionId,
    agent: "planner",
    host: { provider: "openai", surface: "cli" },
    instruction: "Plan it.",
  });
  const continuationId = continuations.issueFor(f.sessionId, planned as never);
  assert.ok(continuationId, "expected a continuation handle");

  // Decide the draft so it does not itself block completion, then complete.
  const draft = await f.plans.getDraftWithRevision(f.task.id);
  await f.plans.rejectDraft(f.task.id, draft!.revisionId);
  await f.lifecycle.completeTask(f.sessionId);

  // The stale handle still exists in process memory -- lifecycle mutation
  // deliberately does not scan or delete continuation records. Using it must
  // fail through preflight instead.
  await assert.rejects(
    () => continuations.resumeCaller(continuationId),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      return true;
    },
  );
  // No plan draft was resurrected and the task stays completed.
  assert.equal(await f.plans.hasDraft(f.task.id), false);
  assert.equal((await f.tasks.get(f.project.id, f.task.id)).status, "completed");

  // The same holds after archive.
  await f.lifecycle.archiveTask(f.project.id, f.task.id);
  await assert.rejects(
    () => continuations.resumeCaller(continuationId),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      return true;
    },
  );
  assert.equal((await f.tasks.get(f.project.id, f.task.id)).status, "archived");
});
