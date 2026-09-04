import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { ProjectManager } from "../src/core/project-manager.js";
import { SessionManager } from "../src/core/session-manager.js";
import { TaskManager } from "../src/core/task-manager.js";
import {
  InvalidSessionIdError,
  ProjectNotFoundError,
  TaskAlreadyBoundError,
  TaskArchivedError,
  TaskCompletedError,
  TaskNotFoundError,
} from "../src/domain/errors.js";
import type { Project, ProjectId } from "../src/domain/project.js";
import { isCanonicalSessionId } from "../src/domain/session.js";
import type { Task, TaskId } from "../src/domain/task.js";
import { StateStore } from "../src/infrastructure/state-store.js";
import { SessionCommands } from "../src/operations/session-commands.js";

interface Fixture {
  readonly store: StateStore;
  readonly projects: ProjectManager;
  readonly tasks: TaskManager;
  readonly sessions: SessionManager;
  readonly commands: SessionCommands;
  readonly project: Project;
  readonly task: Task;
}

async function createFixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-session-cmd-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const homeDirectory = join(root, "home");
  const sourcePath = join(root, "source");
  await Promise.all([
    mkdir(homeDirectory, { recursive: true }),
    mkdir(sourcePath, { recursive: true }),
  ]);
  const store = new StateStore(join(root, "state-root"));
  const projects = new ProjectManager(store, { homeDirectory });
  const tasks = new TaskManager(store, projects);
  const sessions = new SessionManager(store);
  const project = await projects.create("Session Command Project", sourcePath);
  const task = await tasks.create(project.id, "Session command task");
  return {
    store,
    projects,
    tasks,
    sessions,
    commands: new SessionCommands({ projects, tasks, sessions }),
    project,
    task,
  };
}

test("openTaskSession binds an active task and mints a canonical session id", async (t) => {
  const fixture = await createFixture(t);
  const binding = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  assert.equal(isCanonicalSessionId(binding.sessionId), true);
  assert.equal(binding.projectId, fixture.project.id);
  assert.equal(binding.taskId, fixture.task.id);

  // The claim is authoritative in Core, and the binding round-trips.
  assert.equal(
    (await fixture.sessions.findTaskOwner(fixture.task.id))?.sessionId,
    binding.sessionId,
  );
  assert.deepEqual(await fixture.sessions.find(binding.sessionId), binding);
});

test("openTaskSession preserves one writable session per task", async (t) => {
  const fixture = await createFixture(t);
  const first = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  await assert.rejects(
    fixture.commands.openTaskSession(fixture.project.id, fixture.task.id),
    (error: unknown) =>
      error instanceof TaskAlreadyBoundError &&
      error.code === "TASK_ALREADY_BOUND" &&
      error.details?.taskId === fixture.task.id &&
      error.details?.ownerSessionId === first.sessionId,
  );
  // The existing claim is never stolen and the owner is unchanged.
  assert.equal(
    (await fixture.sessions.findTaskOwner(fixture.task.id))?.sessionId,
    first.sessionId,
  );
});

test("concurrent openTaskSession calls produce exactly one writable owner", async (t) => {
  const fixture = await createFixture(t);
  const attempts = await Promise.allSettled(
    Array.from({ length: 5 }, () =>
      fixture.commands.openTaskSession(fixture.project.id, fixture.task.id),
    ),
  );
  const fulfilled = attempts.filter((a) => a.status === "fulfilled");
  const rejected = attempts.filter((a) => a.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 4);
  for (const failure of rejected) {
    assert.ok(
      (failure as PromiseRejectedResult).reason instanceof TaskAlreadyBoundError,
    );
  }
  const winner = (fulfilled[0] as PromiseFulfilledResult<{ sessionId: string }>)
    .value.sessionId;
  assert.equal(
    (await fixture.sessions.findTaskOwner(fixture.task.id))?.sessionId,
    winner,
  );
});

test("openTaskSession rejects unknown projects and tasks", async (t) => {
  const fixture = await createFixture(t);
  await assert.rejects(
    fixture.commands.openTaskSession(
      "prj_absent0000000000000000000000" as ProjectId,
      fixture.task.id,
    ),
    (error: unknown) => error instanceof ProjectNotFoundError,
  );
  await assert.rejects(
    fixture.commands.openTaskSession(
      fixture.project.id,
      "task_absent000000000000000000000" as TaskId,
    ),
    (error: unknown) => error instanceof TaskNotFoundError,
  );
  // Nothing was claimed by a failed open.
  assert.equal(await fixture.sessions.findTaskOwner(fixture.task.id), null);
});

test("openTaskSession refuses completed and archived tasks", async (t) => {
  const completedFixture = await createFixture(t);
  await completedFixture.tasks.markCompleted(
    completedFixture.project.id,
    completedFixture.task.id,
  );
  await assert.rejects(
    completedFixture.commands.openTaskSession(
      completedFixture.project.id,
      completedFixture.task.id,
    ),
    (error: unknown) =>
      error instanceof TaskCompletedError && error.code === "TASK_COMPLETED",
  );

  const archivedFixture = await createFixture(t);
  // Archiving requires a completed task first (existing lifecycle invariant).
  await archivedFixture.tasks.markCompleted(
    archivedFixture.project.id,
    archivedFixture.task.id,
  );
  await archivedFixture.tasks.archive(
    archivedFixture.project.id,
    archivedFixture.task.id,
  );
  await assert.rejects(
    archivedFixture.commands.openTaskSession(
      archivedFixture.project.id,
      archivedFixture.task.id,
    ),
    (error: unknown) =>
      error instanceof TaskArchivedError && error.code === "TASK_ARCHIVED",
  );
});

test("openTaskSession does not mutate the task, plans, memory or the source tree", async (t) => {
  const fixture = await createFixture(t);
  const before = await fixture.tasks.get(fixture.project.id, fixture.task.id);
  const sourceBefore = await readdir(fixture.project.sourcePath);

  await fixture.commands.openTaskSession(fixture.project.id, fixture.task.id);

  assert.deepEqual(
    await fixture.tasks.get(fixture.project.id, fixture.task.id),
    before,
  );
  assert.deepEqual(await readdir(fixture.project.sourcePath), sourceBefore);
});

test("closeSession fully closes the session and reports a real release", async (t) => {
  const fixture = await createFixture(t);
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );

  const closed = await fixture.commands.closeSession(opened.sessionId);
  assert.deepEqual(closed, {
    sessionId: opened.sessionId,
    released: true,
    releasedTaskId: fixture.task.id,
  });
  // The claim is gone AND the binding record is deleted -- no stale
  // project-only session state is retained.
  assert.equal(await fixture.sessions.findTaskOwner(fixture.task.id), null);
  assert.equal(await fixture.sessions.findBinding(opened.sessionId), null);

  // The task becomes claimable again by a distinct new session.
  const reopened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  assert.notEqual(reopened.sessionId, opened.sessionId);
});

test("closeSession does not complete, archive or otherwise change the task", async (t) => {
  const fixture = await createFixture(t);
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const before = await fixture.tasks.get(fixture.project.id, fixture.task.id);

  await fixture.commands.closeSession(opened.sessionId);

  const after = await fixture.tasks.get(fixture.project.id, fixture.task.id);
  assert.deepEqual(after, before);
  assert.equal(after.status, "active");
  assert.equal(after.completedAt, null);
  assert.equal(after.archivedAt, null);
});

test("closeSession never reports success when nothing was released", async (t) => {
  const fixture = await createFixture(t);
  // Unknown session: no binding exists, so nothing is released.
  assert.deepEqual(
    await fixture.commands.closeSession(
      "ses_00000000000000000000000000000000",
    ),
    {
      sessionId: "ses_00000000000000000000000000000000",
      released: false,
      releasedTaskId: null,
    },
  );

  // Closing twice: the first releases, the second is a deterministic no-op.
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const firstClose = await fixture.commands.closeSession(opened.sessionId);
  assert.equal(firstClose.released, true);
  const secondClose = await fixture.commands.closeSession(opened.sessionId);
  assert.deepEqual(secondClose, {
    sessionId: opened.sessionId,
    released: false,
    releasedTaskId: null,
  });
});

test("closeSession validates the session id through Core before touching state", async (t) => {
  const fixture = await createFixture(t);
  for (const invalid of ["", "../../etc/passwd", "has space", "a".repeat(201)]) {
    await assert.rejects(
      fixture.commands.closeSession(invalid),
      (error: unknown) => error instanceof InvalidSessionIdError,
      `must reject ${JSON.stringify(invalid)}`,
    );
  }
});

test("a logical session binding survives the process that created it", async (t) => {
  // Session lifetime is explicit and domain-owned: bindings live in Synaphex
  // state, so a new set of managers (standing in for a restarted MCP
  // subprocess or provider host) still observes the claim. No PID-based
  // cleanup exists, and no disconnect implicitly unbinds.
  const fixture = await createFixture(t);
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );

  const reloadedStore = new StateStore(fixture.store.rootPath);
  const reloadedSessions = new SessionManager(reloadedStore);
  assert.equal(
    (await reloadedSessions.findTaskOwner(fixture.task.id))?.sessionId,
    opened.sessionId,
  );
  assert.equal(
    (await reloadedSessions.getCurrentBinding(opened.sessionId)).taskId,
    fixture.task.id,
  );
});
