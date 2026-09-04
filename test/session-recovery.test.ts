import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { ProjectManager } from "../src/core/project-manager.js";
import { SessionManager } from "../src/core/session-manager.js";
import { TaskManager } from "../src/core/task-manager.js";
import {
  ProjectNotFoundError,
  TaskAlreadyBoundError,
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
  const root = await mkdtemp(join(tmpdir(), "synaphex-session-recovery-"));
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
  const project = await projects.create("Recovery Project", sourcePath);
  const task = await tasks.create(project.id, "Recovery task");
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

// --- owner lookup ----------------------------------------------------------

test("getTaskSessionOwner distinguishes claimed from unclaimed", async (t) => {
  const fixture = await createFixture(t);
  assert.deepEqual(
    await fixture.commands.getTaskSessionOwner(
      fixture.project.id,
      fixture.task.id,
    ),
    { projectId: fixture.project.id, taskId: fixture.task.id, claimed: false },
  );

  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  assert.deepEqual(
    await fixture.commands.getTaskSessionOwner(
      fixture.project.id,
      fixture.task.id,
    ),
    {
      projectId: fixture.project.id,
      taskId: fixture.task.id,
      claimed: true,
      sessionId: opened.sessionId,
    },
  );
});

test("owner lookup and force release reject unknown projects and tasks", async (t) => {
  const fixture = await createFixture(t);
  const badProject = "prj_absent0000000000000000000000" as ProjectId;
  const badTask = "task_absent000000000000000000000" as TaskId;
  for (const operation of [
    () => fixture.commands.getTaskSessionOwner(badProject, fixture.task.id),
    () => fixture.commands.forceReleaseTaskSession(badProject, fixture.task.id),
  ]) {
    await assert.rejects(operation, (e: unknown) => e instanceof ProjectNotFoundError);
  }
  for (const operation of [
    () => fixture.commands.getTaskSessionOwner(fixture.project.id, badTask),
    () => fixture.commands.forceReleaseTaskSession(fixture.project.id, badTask),
  ]) {
    await assert.rejects(operation, (e: unknown) => e instanceof TaskNotFoundError);
  }
});

// --- explicit force release ------------------------------------------------

test("forceReleaseTaskSession recovers a task whose SessionId was lost", async (t) => {
  const fixture = await createFixture(t);
  const abandoned = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );

  // The caller no longer has the SessionId; recovery does not need it.
  const result = await fixture.commands.forceReleaseTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  assert.deepEqual(result, {
    taskId: fixture.task.id,
    released: true,
    previousSessionId: abandoned.sessionId,
  });

  // Both halves of the state are cleaned up consistently.
  assert.equal(await fixture.sessions.findTaskOwner(fixture.task.id), null);
  assert.equal(await fixture.sessions.findBinding(abandoned.sessionId), null);

  // The task is reopenable by a fresh canonical session.
  const recovered = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  assert.equal(isCanonicalSessionId(recovered.sessionId), true);
  assert.notEqual(recovered.sessionId, abandoned.sessionId);
});

test("forceReleaseTaskSession on an unclaimed task is a successful no-op", async (t) => {
  const fixture = await createFixture(t);
  const first = await fixture.commands.forceReleaseTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  assert.deepEqual(first, {
    taskId: fixture.task.id,
    released: false,
    previousSessionId: null,
  });

  // Idempotent: repeating after a real release is also a no-op, not an error.
  await fixture.commands.openTaskSession(fixture.project.id, fixture.task.id);
  const released = await fixture.commands.forceReleaseTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  assert.equal(released.released, true);
  const repeated = await fixture.commands.forceReleaseTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  assert.deepEqual(repeated, {
    taskId: fixture.task.id,
    released: false,
    previousSessionId: null,
  });
});

test("forceReleaseTaskSession never completes, archives or alters the task", async (t) => {
  const fixture = await createFixture(t);
  await fixture.commands.openTaskSession(fixture.project.id, fixture.task.id);
  const before = await fixture.tasks.get(fixture.project.id, fixture.task.id);

  await fixture.commands.forceReleaseTaskSession(
    fixture.project.id,
    fixture.task.id,
  );

  const after = await fixture.tasks.get(fixture.project.id, fixture.task.id);
  assert.deepEqual(after, before);
  assert.equal(after.status, "active");
  assert.equal(after.completedAt, null);
  assert.equal(after.archivedAt, null);
});

test("a normal open never auto-force-releases an occupied task", async (t) => {
  const fixture = await createFixture(t);
  const owner = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  // Repeated failed opens must not erode the existing claim.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(
      fixture.commands.openTaskSession(fixture.project.id, fixture.task.id),
      (error: unknown) => error instanceof TaskAlreadyBoundError,
    );
  }
  assert.equal(
    (await fixture.sessions.findTaskOwner(fixture.task.id))?.sessionId,
    owner.sessionId,
  );
});

// --- persistence across process loss ---------------------------------------

test("an abandoned claim survives process loss and needs explicit recovery", async (t) => {
  const fixture = await createFixture(t);
  const abandoned = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );

  // A fresh manager set stands in for a restarted MCP subprocess/provider.
  const reloadedStore = new StateStore(fixture.store.rootPath);
  const reloadedProjects = new ProjectManager(reloadedStore, {
    homeDirectory: join(fixture.store.rootPath, "..", "home"),
  });
  const reloadedTasks = new TaskManager(reloadedStore, reloadedProjects);
  const reloadedSessions = new SessionManager(reloadedStore);
  const reloadedCommands = new SessionCommands({
    projects: reloadedProjects,
    tasks: reloadedTasks,
    sessions: reloadedSessions,
  });

  // The claim persisted: no lease expired, no heartbeat lapsed.
  assert.deepEqual(
    await reloadedCommands.getTaskSessionOwner(
      fixture.project.id,
      fixture.task.id,
    ),
    {
      projectId: fixture.project.id,
      taskId: fixture.task.id,
      claimed: true,
      sessionId: abandoned.sessionId,
    },
  );

  // Explicit recovery is what releases it.
  const released = await reloadedCommands.forceReleaseTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  assert.equal(released.released, true);
  assert.equal(released.previousSessionId, abandoned.sessionId);
});

// --- concurrency (Phase 11 cases A-D) --------------------------------------

test("case A: concurrent opens still yield exactly one winner", async (t) => {
  const fixture = await createFixture(t);
  const attempts = await Promise.allSettled(
    Array.from({ length: 6 }, () =>
      fixture.commands.openTaskSession(fixture.project.id, fixture.task.id),
    ),
  );
  assert.equal(attempts.filter((a) => a.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((a) => a.status === "rejected").length, 5);
});

test("case B: force release racing an open leaves consistent ownership", async (t) => {
  for (let round = 0; round < 12; round += 1) {
    const fixture = await createFixture(t);
    await fixture.commands.openTaskSession(fixture.project.id, fixture.task.id);

    // Race an explicit recovery against a new open attempt.
    const [, openOutcome] = await Promise.allSettled([
      fixture.commands.forceReleaseTaskSession(
        fixture.project.id,
        fixture.task.id,
      ),
      fixture.commands.openTaskSession(fixture.project.id, fixture.task.id),
    ]);

    // Whatever the interleaving, claim and binding must agree: the owner
    // reported by the authoritative subsystem must have a matching binding,
    // and there must never be a claim owned by A with a binding owned by B.
    const owner = await fixture.sessions.findTaskOwner(fixture.task.id);
    if (owner === null) {
      // Nothing claims the task; the open must have failed or been released.
      assert.ok(true);
    } else {
      const binding = await fixture.sessions.findBinding(owner.sessionId);
      assert.notEqual(binding, null, "claim owner must have a binding");
      assert.equal(binding?.taskId, fixture.task.id);
      assert.equal(binding?.sessionId, owner.sessionId);
      if (openOutcome.status === "fulfilled") {
        // If the open succeeded, the surviving owner must be that session.
        assert.equal(owner.sessionId, openOutcome.value.sessionId);
      }
    }
    // The task is always recoverable to a usable state afterwards.
    await fixture.commands.forceReleaseTaskSession(
      fixture.project.id,
      fixture.task.id,
    );
    assert.equal(await fixture.sessions.findTaskOwner(fixture.task.id), null);
  }
});

test("case C: concurrent force releases produce one release and no corruption", async (t) => {
  const fixture = await createFixture(t);
  const abandoned = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );

  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      fixture.commands.forceReleaseTaskSession(
        fixture.project.id,
        fixture.task.id,
      ),
    ),
  );
  const actualReleases = results.filter((result) => result.released);
  assert.equal(actualReleases.length, 1, "exactly one real release");
  assert.equal(actualReleases[0]?.previousSessionId, abandoned.sessionId);
  for (const noop of results.filter((result) => !result.released)) {
    assert.equal(noop.previousSessionId, null);
  }
  assert.equal(await fixture.sessions.findTaskOwner(fixture.task.id), null);
  assert.equal(await fixture.sessions.findBinding(abandoned.sessionId), null);
});

test("case D: normal close racing force release stays consistent and idempotent", async (t) => {
  for (let round = 0; round < 12; round += 1) {
    const fixture = await createFixture(t);
    const opened = await fixture.commands.openTaskSession(
      fixture.project.id,
      fixture.task.id,
    );

    const [closeOutcome, forceOutcome] = await Promise.allSettled([
      fixture.commands.closeTaskSession(opened.sessionId),
      fixture.commands.forceReleaseTaskSession(
        fixture.project.id,
        fixture.task.id,
      ),
    ]);

    // Neither operation may fail: both are idempotent by design.
    assert.equal(closeOutcome.status, "fulfilled");
    assert.equal(forceOutcome.status, "fulfilled");
    // Exactly one of them actually released the claim.
    const releases = [
      closeOutcome.status === "fulfilled" && closeOutcome.value.released,
      forceOutcome.status === "fulfilled" && forceOutcome.value.released,
    ].filter(Boolean);
    assert.equal(releases.length, 1, "exactly one operation released");
    // End state is fully clean either way.
    assert.equal(await fixture.sessions.findTaskOwner(fixture.task.id), null);
    assert.equal(await fixture.sessions.findBinding(opened.sessionId), null);
  }
});

test("no orphaned claim can grant phantom ownership", async (t) => {
  const fixture = await createFixture(t);
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  // Simulate the residual crash window: a claim whose owning binding is gone
  // (the reverse of Synaphex's write ordering). The authoritative lookup must
  // self-heal rather than report a phantom owner.
  await fixture.store.removeFile(
    `state/sessions/${(await sessionFileName(opened.sessionId))}`,
  );
  assert.equal(await fixture.sessions.findTaskOwner(fixture.task.id), null);
  // And the task can be claimed again normally, with no force release needed.
  const reopened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  assert.notEqual(reopened.sessionId, opened.sessionId);
});

async function sessionFileName(sessionId: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return `${createHash("sha256").update(sessionId).digest("hex")}.jsonc`;
}
