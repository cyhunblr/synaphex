import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { ProjectManager } from "../src/core/project-manager.js";
import { projectStateDirectory } from "../src/core/project-state-path.js";
import { SessionManager } from "../src/core/session-manager.js";
import { TaskManager } from "../src/core/task-manager.js";
import {
  AmbiguousTaskReferenceError,
  InvalidTaskDescriptionError,
  InvalidTaskTransitionError,
  NoProjectBoundError,
  SessionAlreadyBoundToTaskError,
  TaskAlreadyBoundError,
  TaskArchivedError,
  TaskBindingLockTimeoutError,
  TaskCompletedError,
  TaskNotFoundError,
} from "../src/domain/errors.js";
import type { Project } from "../src/domain/project.js";
import { StateStore } from "../src/infrastructure/state-store.js";
import { TaskOperations } from "../src/operations/task-operations.js";

interface Fixture {
  readonly root: string;
  readonly stateRoot: string;
  readonly homeDirectory: string;
  readonly sourcePath: string;
  readonly store: StateStore;
  readonly projects: ProjectManager;
  readonly sessions: SessionManager;
  readonly tasks: TaskManager;
  readonly project: Project;
}

interface WorkerResult {
  readonly ok: boolean;
  readonly sessionId: string;
  readonly taskId?: string;
  readonly code?: string;
}

async function createFixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-task-test-"));
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
  const project = await projects.create("Task Test Project", sourcePath);

  return {
    root,
    stateRoot,
    homeDirectory,
    sourcePath,
    store,
    projects,
    sessions,
    tasks,
    project,
  };
}

function taskOperations(fixture: Fixture): TaskOperations {
  return new TaskOperations({
    synaphexRoot: fixture.stateRoot,
    homeDirectory: fixture.homeDirectory,
  });
}

async function bindProject(fixture: Fixture, sessionId: string): Promise<void> {
  await fixture.sessions.bindProject(sessionId, fixture.project.id);
}

test("creates an active task with the required workflow and memory scaffold", async (t) => {
  const fixture = await createFixture(t);

  const task = await fixture.tasks.create(
    fixture.project.id,
    "Add user authentication with JWT",
  );

  assert.match(task.id, /^task_[a-f0-9]{32}$/);
  assert.equal(task.slug, "add-user-authentication-with-jwt");
  assert.equal(task.status, "active");
  assert.equal(task.completedAt, null);
  assert.equal(task.archivedAt, null);
  const taskDirectory = `${projectStateDirectory(fixture.project)}/tasks/open/${task.id}_${task.slug}`;
  const memoryDirectory = `${projectStateDirectory(fixture.project)}/memory/tasks/${task.id}_${task.slug}`;

  await Promise.all([
    readFile(join(fixture.stateRoot, taskDirectory, "task.jsonc"), "utf8"),
    readFile(join(fixture.stateRoot, taskDirectory, "rules.jsonc"), "utf8"),
    readdir(join(fixture.stateRoot, taskDirectory, "plans", "archive")),
    readdir(join(fixture.stateRoot, taskDirectory, "artifacts", "questioner")),
    readdir(join(fixture.stateRoot, taskDirectory, "artifacts", "researcher")),
    readdir(join(fixture.stateRoot, taskDirectory, "artifacts", "coder")),
    readdir(join(fixture.stateRoot, taskDirectory, "artifacts", "reviewer")),
    readdir(join(fixture.stateRoot, memoryDirectory, "loaded")),
  ]);
  assert.equal(await fixture.store.exists(`${taskDirectory}/draft.md`), false);
  assert.equal(await fixture.store.exists(`${taskDirectory}/current.md`), false);
  assert.equal(await fixture.store.exists(`${memoryDirectory}/MEMORY.md`), false);
});

test("normalizes task descriptions and generates readable Turkish-safe slugs", async (t) => {
  const fixture = await createFixture(t);

  const task = await fixture.tasks.create(
    fixture.project.id,
    "  İşlem   için\nşifre ölçümü  ",
  );

  assert.equal(task.description, "İşlem için şifre ölçümü");
  assert.equal(task.slug, "islem-icin-sifre-olcumu");
});

test("rejects an empty normalized task description", async (t) => {
  const fixture = await createFixture(t);

  await assert.rejects(
    fixture.tasks.create(fixture.project.id, " \n\t "),
    (error: unknown) =>
      error instanceof InvalidTaskDescriptionError &&
      error.code === "INVALID_TASK_DESCRIPTION",
  );
});

test("allows duplicate slugs while keeping task IDs unique", async (t) => {
  const fixture = await createFixture(t);

  const first = await fixture.tasks.create(fixture.project.id, "Same work");
  const second = await fixture.tasks.create(fixture.project.id, "Same work");

  assert.equal(first.slug, second.slug);
  assert.notEqual(first.id, second.id);
  assert.equal((await fixture.tasks.listOpen(fixture.project.id)).length, 2);
});

test("resolves tasks by ID and by a unique exact slug", async (t) => {
  const fixture = await createFixture(t);
  const task = await fixture.tasks.create(fixture.project.id, "Resolve this task");

  assert.deepEqual(await fixture.tasks.get(fixture.project.id, task.id), task);
  assert.deepEqual(await fixture.tasks.resolve(fixture.project.id, task.id), task);
  assert.deepEqual(
    await fixture.tasks.resolve(fixture.project.id, task.slug),
    task,
  );
});

test("rejects ambiguous duplicate slugs without guessing", async (t) => {
  const fixture = await createFixture(t);
  const first = await fixture.tasks.create(fixture.project.id, "Repeated task");
  await fixture.tasks.create(fixture.project.id, "Repeated task");

  await assert.rejects(
    fixture.tasks.resolve(fixture.project.id, first.slug),
    (error: unknown) =>
      error instanceof AmbiguousTaskReferenceError &&
      error.code === "AMBIGUOUS_TASK_REFERENCE" &&
      Array.isArray(error.details?.taskIds) &&
      error.details.taskIds.length === 2,
  );
});

test("returns a stable error for an unknown task", async (t) => {
  const fixture = await createFixture(t);

  await assert.rejects(
    fixture.tasks.resolve(fixture.project.id, "missing-task"),
    (error: unknown) =>
      error instanceof TaskNotFoundError && error.code === "TASK_NOT_FOUND",
  );
});

test("enforces active to completed to archived lifecycle", async (t) => {
  const fixture = await createFixture(t);
  const active = await fixture.tasks.create(fixture.project.id, "Lifecycle task");

  const completed = await fixture.tasks.markCompleted(
    fixture.project.id,
    active.id,
  );
  assert.equal(completed.status, "completed");
  assert.notEqual(completed.completedAt, null);
  assert.equal(completed.archivedAt, null);
  assert.equal(
    (await fixture.tasks.listOpen(fixture.project.id))[0]?.status,
    "completed",
  );

  const archived = await fixture.tasks.archive(fixture.project.id, completed.id);
  assert.equal(archived.status, "archived");
  assert.notEqual(archived.archivedAt, null);
  assert.equal((await fixture.tasks.listOpen(fixture.project.id)).length, 0);
  assert.deepEqual(await fixture.tasks.listArchived(fixture.project.id), [archived]);
  assert.deepEqual(await fixture.tasks.get(fixture.project.id, active.id), archived);
});

test("rejects every invalid lifecycle transition", async (t) => {
  const fixture = await createFixture(t);
  const active = await fixture.tasks.create(fixture.project.id, "Invalid transitions");

  await assert.rejects(
    fixture.tasks.archive(fixture.project.id, active.id),
    (error: unknown) =>
      error instanceof InvalidTaskTransitionError &&
      error.code === "INVALID_TASK_TRANSITION",
  );
  const completed = await fixture.tasks.markCompleted(fixture.project.id, active.id);
  await assert.rejects(
    fixture.tasks.markCompleted(fixture.project.id, completed.id),
    InvalidTaskTransitionError,
  );
  const archived = await fixture.tasks.archive(fixture.project.id, completed.id);
  await assert.rejects(
    fixture.tasks.markCompleted(fixture.project.id, archived.id),
    InvalidTaskTransitionError,
  );
  await assert.rejects(
    fixture.tasks.archive(fixture.project.id, archived.id),
    InvalidTaskTransitionError,
  );
});

test("archiving moves workflow state but leaves canonical task memory in place", async (t) => {
  const fixture = await createFixture(t);
  const task = await fixture.tasks.create(fixture.project.id, "Archive locations");
  const projectDirectory = projectStateDirectory(fixture.project);
  const directoryName = `${task.id}_${task.slug}`;
  const openDirectory = `${projectDirectory}/tasks/open/${directoryName}`;
  const archiveDirectory = `${projectDirectory}/tasks/archive/${directoryName}`;
  const memoryDirectory = `${projectDirectory}/memory/tasks/${directoryName}/loaded`;
  await fixture.tasks.markCompleted(fixture.project.id, task.id);

  await fixture.tasks.archive(fixture.project.id, task.id);

  assert.equal(await fixture.store.exists(openDirectory), false);
  assert.equal(await fixture.store.exists(`${archiveDirectory}/task.jsonc`), true);
  assert.equal(await fixture.store.exists(memoryDirectory), true);
});

test("createTask creates and automatically binds an active task", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "create-task-session";
  await bindProject(fixture, sessionId);

  const task = await taskOperations(fixture).createTask(
    sessionId,
    "Create through operations",
  );

  assert.equal(task.status, "active");
  assert.deepEqual(await fixture.sessions.getCurrentBinding(sessionId), {
    sessionId,
    projectId: fixture.project.id,
    taskId: task.id,
  });
  assert.equal((await fixture.sessions.findTaskOwner(task.id))?.sessionId, sessionId);
});

test("createTask rejects a session without a project", async (t) => {
  const fixture = await createFixture(t);

  await assert.rejects(
    taskOperations(fixture).createTask("unbound-session", "No project"),
    (error: unknown) =>
      error instanceof NoProjectBoundError && error.code === "NO_PROJECT_BOUND",
  );
});

test("createTask rejects a session that already owns a task", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "already-task-bound";
  await bindProject(fixture, sessionId);
  const operations = taskOperations(fixture);
  await operations.createTask(sessionId, "First task");

  await assert.rejects(
    operations.createTask(sessionId, "Second task"),
    (error: unknown) =>
      error instanceof SessionAlreadyBoundToTaskError &&
      error.code === "SESSION_ALREADY_BOUND_TO_TASK",
  );
});

test("resumeTask binds an active task", async (t) => {
  const fixture = await createFixture(t);
  const task = await fixture.tasks.create(fixture.project.id, "Resume active");
  const sessionId = "resume-active";
  await bindProject(fixture, sessionId);

  assert.deepEqual(
    await taskOperations(fixture).resumeTask(sessionId, task.slug),
    task,
  );
  assert.equal((await fixture.sessions.getCurrentBinding(sessionId)).taskId, task.id);
});

test("completed tasks cannot be resumed", async (t) => {
  const fixture = await createFixture(t);
  const task = await fixture.tasks.create(fixture.project.id, "Completed task");
  await fixture.tasks.markCompleted(fixture.project.id, task.id);
  const sessionId = "resume-completed";
  await bindProject(fixture, sessionId);

  await assert.rejects(
    taskOperations(fixture).resumeTask(sessionId, task.id),
    (error: unknown) =>
      error instanceof TaskCompletedError && error.code === "TASK_COMPLETED",
  );
});

test("completion does not release the task's existing writable session", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "complete-while-bound";
  await bindProject(fixture, sessionId);
  const task = await taskOperations(fixture).createTask(
    sessionId,
    "Complete while bound",
  );

  await fixture.tasks.markCompleted(fixture.project.id, task.id);

  assert.equal(
    (await fixture.sessions.getCurrentBinding(sessionId)).taskId,
    task.id,
  );
  assert.equal(
    (await fixture.sessions.findTaskOwner(task.id))?.sessionId,
    sessionId,
  );
});

test("archived tasks cannot be resumed", async (t) => {
  const fixture = await createFixture(t);
  const task = await fixture.tasks.create(fixture.project.id, "Archived task");
  await fixture.tasks.markCompleted(fixture.project.id, task.id);
  await fixture.tasks.archive(fixture.project.id, task.id);
  const sessionId = "resume-archived";
  await bindProject(fixture, sessionId);

  await assert.rejects(
    taskOperations(fixture).resumeTask(sessionId, task.id),
    (error: unknown) =>
      error instanceof TaskArchivedError && error.code === "TASK_ARCHIVED",
  );
});

test("the same active task cannot be bound to two sessions", async (t) => {
  const fixture = await createFixture(t);
  const task = await fixture.tasks.create(fixture.project.id, "Exclusive task");
  await Promise.all([
    bindProject(fixture, "exclusive-one"),
    bindProject(fixture, "exclusive-two"),
  ]);
  const operations = taskOperations(fixture);
  await operations.resumeTask("exclusive-one", task.id);

  await assert.rejects(
    operations.resumeTask("exclusive-two", task.id),
    (error: unknown) =>
      error instanceof TaskAlreadyBoundError &&
      error.code === "TASK_ALREADY_BOUND",
  );
});

test("different active tasks can be bound to different sessions", async (t) => {
  const fixture = await createFixture(t);
  const first = await fixture.tasks.create(fixture.project.id, "Different one");
  const second = await fixture.tasks.create(fixture.project.id, "Different two");
  await Promise.all([
    bindProject(fixture, "different-one"),
    bindProject(fixture, "different-two"),
  ]);
  const operations = taskOperations(fixture);

  await Promise.all([
    operations.resumeTask("different-one", first.id),
    operations.resumeTask("different-two", second.id),
  ]);

  assert.equal(
    (await fixture.sessions.findTaskOwner(first.id))?.sessionId,
    "different-one",
  );
  assert.equal(
    (await fixture.sessions.findTaskOwner(second.id))?.sessionId,
    "different-two",
  );
});

test("unbindTask retains the project binding and releases writable ownership", async (t) => {
  const fixture = await createFixture(t);
  const task = await fixture.tasks.create(fixture.project.id, "Release task");
  const firstSession = "release-first";
  const secondSession = "release-second";
  await Promise.all([
    bindProject(fixture, firstSession),
    bindProject(fixture, secondSession),
  ]);
  await taskOperations(fixture).resumeTask(firstSession, task.id);

  const binding = await fixture.sessions.unbindTask(firstSession);

  assert.deepEqual(binding, {
    sessionId: firstSession,
    projectId: fixture.project.id,
    taskId: null,
  });
  assert.equal(await fixture.sessions.findTaskOwner(task.id), null);
  await taskOperations(fixture).resumeTask(secondSession, task.id);
  assert.equal(
    (await fixture.sessions.findTaskOwner(task.id))?.sessionId,
    secondSession,
  );
});

test("an inconsistent task claim is reconciled against persisted session state", async (t) => {
  const fixture = await createFixture(t);
  const task = await fixture.tasks.create(fixture.project.id, "Stale claim task");
  const staleSession = "stale-claim-owner";
  const replacementSession = "replacement-owner";
  await Promise.all([
    bindProject(fixture, staleSession),
    bindProject(fixture, replacementSession),
  ]);
  await taskOperations(fixture).resumeTask(staleSession, task.id);

  const staleSessionHash = createHash("sha256")
    .update(staleSession)
    .digest("hex");
  await fixture.store.writeJson(
    `state/sessions/${staleSessionHash}.jsonc`,
    {
      sessionId: staleSession,
      projectId: fixture.project.id,
      taskId: null,
    },
  );

  await taskOperations(fixture).resumeTask(replacementSession, task.id);

  assert.equal(
    (await fixture.sessions.findTaskOwner(task.id))?.sessionId,
    replacementSession,
  );
});

test("task binding lock contention returns a stable timeout error", async (t) => {
  const fixture = await createFixture(t);
  const task = await fixture.tasks.create(fixture.project.id, "Lock timeout");
  await fixture.store.createJsonExclusive(
    "state/task-bindings/.ownership-lock.json",
    {
      token: "held-by-another-process",
      processId: process.pid,
      createdAt: new Date().toISOString(),
    },
  );

  await assert.rejects(
    fixture.sessions.findTaskOwner(task.id),
    (error: unknown) =>
      error instanceof TaskBindingLockTimeoutError &&
      error.code === "TASK_BINDING_LOCK_TIMEOUT",
  );
});

test("task metadata and session ownership survive new service instances", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "persistent-task-session";
  await bindProject(fixture, sessionId);
  const task = await taskOperations(fixture).createTask(sessionId, "Persistent task");

  const newStore = new StateStore(fixture.stateRoot);
  const newProjects = new ProjectManager(newStore, {
    homeDirectory: fixture.homeDirectory,
  });
  const newTasks = new TaskManager(newStore, newProjects);
  const newSessions = new SessionManager(newStore);

  assert.deepEqual(await newTasks.get(fixture.project.id, task.id), task);
  assert.equal((await newSessions.getCurrentBinding(sessionId)).taskId, task.id);
  assert.equal((await newSessions.findTaskOwner(task.id))?.sessionId, sessionId);
});

test("concurrent cross-process resume attempts produce exactly one writable owner", async (t) => {
  const fixture = await createFixture(t);
  const task = await fixture.tasks.create(fixture.project.id, "Cross process task");
  const sessionIds = ["process-session-one", "process-session-two"] as const;
  await Promise.all(sessionIds.map((sessionId) => bindProject(fixture, sessionId)));

  const results = await Promise.all(
    sessionIds.map((sessionId) => runBindingWorker(fixture, sessionId, task.id)),
  );

  const successes = results.filter(({ ok }) => ok);
  const failures = results.filter(({ ok }) => !ok);
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.code, "TASK_ALREADY_BOUND");
  assert.equal(
    (await fixture.sessions.findTaskOwner(task.id))?.sessionId,
    successes[0]?.sessionId,
  );
});

test("task creation does not modify the user's source repository", async (t) => {
  const fixture = await createFixture(t);
  await writeFile(join(fixture.sourcePath, "existing.txt"), "unchanged", "utf8");
  const before = await readdir(fixture.sourcePath);

  await fixture.tasks.create(fixture.project.id, "Do not touch source");

  assert.deepEqual(await readdir(fixture.sourcePath), before);
  assert.equal(
    await readFile(join(fixture.sourcePath, "existing.txt"), "utf8"),
    "unchanged",
  );
});

function runBindingWorker(
  fixture: Fixture,
  sessionId: string,
  taskReference: string,
): Promise<WorkerResult> {
  const workerPath = fileURLToPath(
    new URL("./fixtures/task-binding-worker.js", import.meta.url),
  );
  const resultPath = join(fixture.root, `${sessionId}.result.json`);
  const { NODE_TEST_CONTEXT: _testContext, ...workerEnvironment } = process.env;

  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [
        workerPath,
        fixture.stateRoot,
        fixture.homeDirectory,
        sessionId,
        taskReference,
        resultPath,
      ],
      { encoding: "utf8", env: workerEnvironment },
      async (error, _stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`Task binding worker failed: ${stderr}`, { cause: error }));
          return;
        }
        try {
          const result = await readFile(resultPath, "utf8");
          resolve(JSON.parse(result) as WorkerResult);
        } catch (parseError) {
          reject(
            new Error(`Invalid task binding worker result: ${resultPath}`, {
              cause: parseError,
            }),
          );
        }
      },
    );
  });
}
