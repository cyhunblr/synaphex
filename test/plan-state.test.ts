import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { PlanManager } from "../src/core/plan-manager.js";
import { ProjectManager } from "../src/core/project-manager.js";
import { projectStateDirectory } from "../src/core/project-state-path.js";
import { RoleContractRegistry } from "../src/core/role-contract-registry.js";
import { SessionManager } from "../src/core/session-manager.js";
import { TaskManager } from "../src/core/task-manager.js";
import {
  InvalidPlanContentError,
  NoPlanDraftError,
  NoTaskBoundError,
  PlanAlreadyAcceptedError,
  TaskArchivedError,
  TaskCompletedError,
} from "../src/domain/errors.js";
import type { Project } from "../src/domain/project.js";
import type { Task } from "../src/domain/task.js";
import { StateStore } from "../src/infrastructure/state-store.js";
import { PlanOperations } from "../src/operations/plan-operations.js";

interface Fixture {
  readonly root: string;
  readonly stateRoot: string;
  readonly homeDirectory: string;
  readonly sourcePath: string;
  readonly store: StateStore;
  readonly projects: ProjectManager;
  readonly sessions: SessionManager;
  readonly tasks: TaskManager;
  readonly plans: PlanManager;
  readonly project: Project;
  readonly task: Task;
}

class PromotionFailingStateStore extends StateStore {
  failPlanPromotion = false;

  override async move(
    sourceRelativePath: string,
    destinationRelativePath: string,
  ): Promise<void> {
    if (
      this.failPlanPromotion &&
      sourceRelativePath.endsWith("/plans/draft.md") &&
      destinationRelativePath.endsWith("/plans/current.md")
    ) {
      throw new Error("Injected plan promotion failure");
    }
    await super.move(sourceRelativePath, destinationRelativePath);
  }
}

async function createFixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-plan-test-"));
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
  const project = await projects.create("Plan Test Project", sourcePath);
  const task = await tasks.create(project.id, "Implement the accepted plan");
  return {
    root,
    stateRoot,
    homeDirectory,
    sourcePath,
    store,
    projects,
    sessions,
    tasks,
    plans: new PlanManager(store, tasks),
    project,
    task,
  };
}

function planOperations(fixture: Fixture): PlanOperations {
  return new PlanOperations({
    synaphexRoot: fixture.stateRoot,
    homeDirectory: fixture.homeDirectory,
  });
}

async function bindTask(fixture: Fixture, sessionId: string): Promise<void> {
  await fixture.sessions.bindProject(sessionId, fixture.project.id);
  await fixture.sessions.bindTask(sessionId, fixture.task.id);
}

function plansDirectory(fixture: Fixture): string {
  return join(
    fixture.stateRoot,
    projectStateDirectory(fixture.project),
    "tasks",
    "open",
    `${fixture.task.id}_${fixture.task.slug}`,
    "plans",
  );
}

test("new tasks have no draft or current plan", async (t) => {
  const fixture = await createFixture(t);

  assert.equal(await fixture.plans.getDraft(fixture.task.id), null);
  assert.equal(await fixture.plans.getCurrent(fixture.task.id), null);
  assert.deepEqual(await fixture.plans.getAvailability(fixture.task.id), {
    hasDraft: false,
    hasAcceptedPlan: false,
  });
  assert.deepEqual(await readdir(join(plansDirectory(fixture), "archive")), []);
});

test("saveDraft creates a human-readable Markdown draft", async (t) => {
  const fixture = await createFixture(t);
  const content = "# Implementation plan\n\n1. Add the state model.\n";

  const draft = await fixture.plans.saveDraft(fixture.task.id, content);

  assert.equal(draft.taskId, fixture.task.id);
  assert.equal(draft.status, "draft");
  assert.equal(draft.content, content);
  // Every draft write instance carries an opaque revision identity.
  assert.match(draft.revisionId, /^planrev_[0-9a-f]{32}$/);
  // The plan itself stays human-readable Markdown.
  assert.equal(
    await readFile(join(plansDirectory(fixture), "draft.md"), "utf8"),
    content,
  );
});

test("empty draft content is rejected", async (t) => {
  const fixture = await createFixture(t);

  await assert.rejects(
    fixture.plans.saveDraft(fixture.task.id, " \n\t "),
    (error: unknown) =>
      error instanceof InvalidPlanContentError &&
      error.code === "INVALID_PLAN_CONTENT",
  );
});

test("saveDraft replaces an unaccepted draft without archiving it", async (t) => {
  const fixture = await createFixture(t);
  await fixture.plans.saveDraft(fixture.task.id, "# Disposable draft v1");

  await fixture.plans.saveDraft(fixture.task.id, "# Proposed draft v2");

  assert.equal(
    (await fixture.plans.getDraft(fixture.task.id))?.content,
    "# Proposed draft v2",
  );
  assert.deepEqual(await readdir(join(plansDirectory(fixture), "archive")), []);
  assert.equal(await fixture.plans.getCurrent(fixture.task.id), null);
});

test("draft and accepted-plan queries represent all pending states", async (t) => {
  const fixture = await createFixture(t);

  assert.deepEqual(await fixture.plans.getAvailability(fixture.task.id), {
    hasDraft: false,
    hasAcceptedPlan: false,
  });
  await fixture.plans.saveDraft(fixture.task.id, "# Draft v1");
  assert.deepEqual(await fixture.plans.getAvailability(fixture.task.id), {
    hasDraft: true,
    hasAcceptedPlan: false,
  });
  await fixture.plans.acceptDraft(fixture.task.id);
  assert.deepEqual(await fixture.plans.getAvailability(fixture.task.id), {
    hasDraft: false,
    hasAcceptedPlan: true,
  });
  await fixture.plans.saveDraft(fixture.task.id, "# Draft v2");
  assert.deepEqual(await fixture.plans.getAvailability(fixture.task.id), {
    hasDraft: true,
    hasAcceptedPlan: true,
  });
});

test("accepting the first draft creates current and removes draft", async (t) => {
  const fixture = await createFixture(t);
  await fixture.plans.saveDraft(fixture.task.id, "# First accepted plan");

  const accepted = await fixture.plans.acceptDraft(fixture.task.id);

  assert.deepEqual(accepted, {
    taskId: fixture.task.id,
    status: "accepted",
    content: "# First accepted plan",
  });
  assert.equal(await fixture.plans.getDraft(fixture.task.id), null);
  assert.deepEqual(await fixture.plans.getCurrent(fixture.task.id), accepted);
});

test("acceptDraft distinguishes no draft from an already accepted plan", async (t) => {
  const fixture = await createFixture(t);

  await assert.rejects(
    fixture.plans.acceptDraft(fixture.task.id),
    (error: unknown) =>
      error instanceof NoPlanDraftError && error.code === "NO_PLAN_DRAFT",
  );
  await fixture.plans.saveDraft(fixture.task.id, "# Accepted plan");
  await fixture.plans.acceptDraft(fixture.task.id);
  await assert.rejects(
    fixture.plans.acceptDraft(fixture.task.id),
    (error: unknown) =>
      error instanceof PlanAlreadyAcceptedError &&
      error.code === "PLAN_ALREADY_ACCEPTED",
  );
});

test("an accepted current remains authoritative while a revision draft is pending", async (t) => {
  const fixture = await createFixture(t);
  await fixture.plans.saveDraft(fixture.task.id, "# Accepted v1");
  await fixture.plans.acceptDraft(fixture.task.id);

  await fixture.plans.saveDraft(fixture.task.id, "# Proposed v2");

  assert.equal(
    (await fixture.plans.getCurrent(fixture.task.id))?.content,
    "# Accepted v1",
  );
  assert.equal(
    (await fixture.plans.getDraft(fixture.task.id))?.content,
    "# Proposed v2",
  );
  assert.equal(await fixture.plans.hasAcceptedPlan(fixture.task.id), true);
});

test("accepting a revision archives the previous current and promotes the draft", async (t) => {
  const fixture = await createFixture(t);
  await fixture.plans.saveDraft(fixture.task.id, "# Accepted v1");
  await fixture.plans.acceptDraft(fixture.task.id);
  await fixture.plans.saveDraft(fixture.task.id, "# Accepted v2");

  const accepted = await fixture.plans.acceptDraft(fixture.task.id);

  assert.equal(accepted.content, "# Accepted v2");
  assert.equal(await fixture.plans.getDraft(fixture.task.id), null);
  assert.equal(
    (await fixture.plans.getCurrent(fixture.task.id))?.content,
    "# Accepted v2",
  );
  const archivedFiles = await readdir(join(plansDirectory(fixture), "archive"));
  assert.equal(archivedFiles.length, 1);
  assert.match(archivedFiles[0] as string, /^accepted-.*-[a-f0-9]{8}\.md$/);
  assert.equal(
    await readFile(
      join(plansDirectory(fixture), "archive", archivedFiles[0] as string),
      "utf8",
    ),
    "# Accepted v1",
  );
});

test("a failed revision promotion preserves both previous current and draft", async (t) => {
  const fixture = await createFixture(t);
  await fixture.plans.saveDraft(fixture.task.id, "# Stable current");
  await fixture.plans.acceptDraft(fixture.task.id);
  await fixture.plans.saveDraft(fixture.task.id, "# Pending replacement");
  const failingStore = new PromotionFailingStateStore(fixture.stateRoot);
  const failingProjects = new ProjectManager(failingStore, {
    homeDirectory: fixture.homeDirectory,
  });
  const failingTasks = new TaskManager(failingStore, failingProjects);
  const failingPlans = new PlanManager(failingStore, failingTasks);
  failingStore.failPlanPromotion = true;

  await assert.rejects(
    failingPlans.acceptDraft(fixture.task.id),
    /Injected plan promotion failure/,
  );

  assert.equal(
    (await fixture.plans.getCurrent(fixture.task.id))?.content,
    "# Stable current",
  );
  assert.equal(
    (await fixture.plans.getDraft(fixture.task.id))?.content,
    "# Pending replacement",
  );
});

test("archive contains accepted plans only, never replaced drafts", async (t) => {
  const fixture = await createFixture(t);
  await fixture.plans.saveDraft(fixture.task.id, "# Rejected draft");
  await fixture.plans.saveDraft(fixture.task.id, "# Accepted v1");
  await fixture.plans.acceptDraft(fixture.task.id);
  await fixture.plans.saveDraft(fixture.task.id, "# Rejected revision");
  await fixture.plans.saveDraft(fixture.task.id, "# Accepted v2");
  await fixture.plans.acceptDraft(fixture.task.id);

  const archivedFiles = await readdir(join(plansDirectory(fixture), "archive"));
  assert.equal(archivedFiles.length, 1);
  assert.equal(
    await readFile(
      join(plansDirectory(fixture), "archive", archivedFiles[0] as string),
      "utf8",
    ),
    "# Accepted v1",
  );
});

test("repeated revisions create collision-safe archive filenames", async (t) => {
  const fixture = await createFixture(t);
  for (const version of [1, 2, 3]) {
    await fixture.plans.saveDraft(fixture.task.id, `# Accepted v${version}`);
    await fixture.plans.acceptDraft(fixture.task.id);
  }

  const archivedFiles = await readdir(join(plansDirectory(fixture), "archive"));
  assert.equal(archivedFiles.length, 2);
  assert.equal(new Set(archivedFiles).size, 2);
});

test("archiveCurrent preserves current in archive and removes authority", async (t) => {
  const fixture = await createFixture(t);
  await fixture.plans.saveDraft(fixture.task.id, "# Current to archive");
  await fixture.plans.acceptDraft(fixture.task.id);

  const archived = await fixture.plans.archiveCurrent(fixture.task.id);

  assert.equal(archived?.status, "archived");
  assert.equal(archived?.content, "# Current to archive");
  assert.equal(await fixture.plans.getCurrent(fixture.task.id), null);
  assert.equal(await fixture.plans.hasAcceptedPlan(fixture.task.id), false);
  assert.equal(
    await readFile(
      join(
        plansDirectory(fixture),
        "archive",
        archived?.archiveFileName as string,
      ),
      "utf8",
    ),
    "# Current to archive",
  );
});

test("archiveCurrent is idempotent when no current exists", async (t) => {
  const fixture = await createFixture(t);

  assert.equal(await fixture.plans.archiveCurrent(fixture.task.id), null);
  assert.equal(await fixture.plans.archiveCurrent(fixture.task.id), null);
  assert.deepEqual(await readdir(join(plansDirectory(fixture), "archive")), []);
});

test("accepted plan state survives new manager instances", async (t) => {
  const fixture = await createFixture(t);
  await fixture.plans.saveDraft(fixture.task.id, "# Persistent current");
  const accepted = await fixture.plans.acceptDraft(fixture.task.id);

  const newStore = new StateStore(fixture.stateRoot);
  const newProjects = new ProjectManager(newStore, {
    homeDirectory: fixture.homeDirectory,
  });
  const newTasks = new TaskManager(newStore, newProjects);
  const newPlans = new PlanManager(newStore, newTasks);

  assert.deepEqual(await newPlans.getCurrent(fixture.task.id), accepted);
  assert.equal(await newPlans.hasAcceptedPlan(fixture.task.id), true);
});

test("acceptPlan requires a task-bound session", async (t) => {
  const fixture = await createFixture(t);
  await fixture.sessions.bindProject("project-only", fixture.project.id);

  await assert.rejects(
    planOperations(fixture).acceptPlan("project-only"),
    (error: unknown) =>
      error instanceof NoTaskBoundError && error.code === "NO_TASK_BOUND",
  );
});

test("acceptPlan rejects completed tasks", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "completed-plan-session";
  await bindTask(fixture, sessionId);
  await fixture.plans.saveDraft(fixture.task.id, "# Cannot accept completed");
  await fixture.tasks.markCompleted(fixture.project.id, fixture.task.id);

  await assert.rejects(
    planOperations(fixture).acceptPlan(sessionId),
    (error: unknown) =>
      error instanceof TaskCompletedError && error.code === "TASK_COMPLETED",
  );
});

test("acceptPlan rejects archived tasks", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "archived-plan-session";
  await bindTask(fixture, sessionId);
  await fixture.plans.saveDraft(fixture.task.id, "# Cannot accept archived");
  await fixture.tasks.markCompleted(fixture.project.id, fixture.task.id);
  await fixture.tasks.archive(fixture.project.id, fixture.task.id);

  await assert.rejects(
    planOperations(fixture).acceptPlan(sessionId),
    (error: unknown) =>
      error instanceof TaskArchivedError && error.code === "TASK_ARCHIVED",
  );
});

test("acceptPlan explicitly promotes a draft without changing task status", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "accept-plan-session";
  await bindTask(fixture, sessionId);
  await fixture.plans.saveDraft(fixture.task.id, "# Explicitly accepted");

  const accepted = await planOperations(fixture).acceptPlan(sessionId);

  assert.equal(accepted.content, "# Explicitly accepted");
  assert.equal(
    (await fixture.tasks.get(fixture.project.id, fixture.task.id)).status,
    "active",
  );
});

test("a new PlanOperations instance accepts persisted draft state", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "new-operation-instance";
  await bindTask(fixture, sessionId);
  await fixture.plans.saveDraft(fixture.task.id, "# Persisted draft");

  const accepted = await new PlanOperations({
    synaphexRoot: fixture.stateRoot,
    homeDirectory: fixture.homeDirectory,
  }).acceptPlan(sessionId);

  assert.equal(accepted.content, "# Persisted draft");
  assert.equal(await fixture.plans.hasAcceptedPlan(fixture.task.id), true);
});

test("persisted accepted-plan presence feeds the existing role-contract context", async (t) => {
  const fixture = await createFixture(t);
  const registry = new RoleContractRegistry();
  await fixture.plans.saveDraft(fixture.task.id, "# Conditional plan");

  assert.equal(
    registry.evaluateAgentCall("coder", "planner", {
      acceptedPlanExists: await fixture.plans.hasAcceptedPlan(fixture.task.id),
      purpose: "plan_clarification",
    }).allowed,
    false,
  );
  await fixture.plans.acceptDraft(fixture.task.id);
  assert.equal(
    registry.evaluateAgentCall("coder", "planner", {
      acceptedPlanExists: await fixture.plans.hasAcceptedPlan(fixture.task.id),
      purpose: "plan_clarification",
    }).allowed,
    true,
  );
});

test("plan state never modifies the user's source repository", async (t) => {
  const fixture = await createFixture(t);
  await writeFile(join(fixture.sourcePath, "existing.txt"), "unchanged", "utf8");
  const before = await readdir(fixture.sourcePath);

  await fixture.plans.saveDraft(fixture.task.id, "# Source-safe plan");
  await fixture.plans.acceptDraft(fixture.task.id);
  await fixture.plans.saveDraft(fixture.task.id, "# Source-safe revision");
  await fixture.plans.acceptDraft(fixture.task.id);

  assert.deepEqual(await readdir(fixture.sourcePath), before);
  assert.equal(
    await readFile(join(fixture.sourcePath, "existing.txt"), "utf8"),
    "unchanged",
  );
});
