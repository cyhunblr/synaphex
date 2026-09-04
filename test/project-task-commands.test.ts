import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { ProjectManager } from "../src/core/project-manager.js";
import { SessionManager } from "../src/core/session-manager.js";
import { TaskManager } from "../src/core/task-manager.js";
import {
  InvalidProjectPathError,
  InvalidTaskDescriptionError,
  ProjectNotFoundError,
  ProjectPathAlreadyRegisteredError,
  ProjectPathNotFoundError,
} from "../src/domain/errors.js";
import type { ProjectId } from "../src/domain/project.js";
import { isCanonicalSessionId } from "../src/domain/session.js";
import { StateStore } from "../src/infrastructure/state-store.js";
import { ProjectTaskCommands } from "../src/operations/project-task-commands.js";
import { SessionCommands } from "../src/operations/session-commands.js";

interface Fixture {
  readonly root: string;
  readonly store: StateStore;
  readonly projects: ProjectManager;
  readonly tasks: TaskManager;
  readonly sessions: SessionManager;
  readonly commands: ProjectTaskCommands;
  readonly sessionCommands: SessionCommands;
  readonly sourcePath: string;
}

async function createFixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-bootstrap-"));
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
  return {
    root,
    store,
    projects,
    tasks,
    sessions,
    commands: new ProjectTaskCommands({ projects, tasks, sessions }),
    sessionCommands: new SessionCommands({ projects, tasks, sessions }),
    sourcePath,
  };
}

// ---------------------------------------------------------------------------
// Project registration
// ---------------------------------------------------------------------------

test("registering an existing workspace stores canonical metadata only", async (t) => {
  const f = await createFixture(t);
  await writeFile(join(f.sourcePath, "existing.txt"), "untouched", "utf8");
  const before = await readdir(f.sourcePath);

  const project = await f.commands.registerProject("Demo", f.sourcePath);
  assert.match(project.id, /^prj_[0-9a-f]{32}$/);
  assert.equal(project.name, "Demo");
  assert.match(project.sourcePath, /source$/);
  assert.ok(project.createdAt.length > 0);

  // The user's source tree is never created, cloned, git-initialized or
  // otherwise modified.
  assert.deepEqual(await readdir(f.sourcePath), before);
  // Synaphex state lives under its own root, outside the source workspace.
  assert.equal(f.store.rootPath.startsWith(f.sourcePath), false);
  assert.equal(await f.projects.get(project.id) !== null, true);
});

test("registration canonicalizes the path and expands ~", async (t) => {
  const f = await createFixture(t);
  // A symlink to the real directory must resolve to the same canonical path.
  const linkPath = join(f.root, "link-to-source");
  await symlink(f.sourcePath, linkPath);
  const viaLink = await f.commands.registerProject("Linked", linkPath);
  assert.equal(viaLink.sourcePath.endsWith("source"), true);
  assert.equal(viaLink.sourcePath.includes("link-to-source"), false);
});

test("duplicate source paths are refused, not deduplicated", async (t) => {
  const f = await createFixture(t);
  const first = await f.commands.registerProject("First", f.sourcePath);
  await assert.rejects(
    f.commands.registerProject("Second", f.sourcePath),
    (error: unknown) =>
      error instanceof ProjectPathAlreadyRegisteredError &&
      error.code === "PROJECT_PATH_ALREADY_REGISTERED" &&
      error.details?.projectId === first.id,
  );
  // Exactly one project exists; nothing was silently returned or replaced.
  assert.equal((await f.projects.list()).length, 1);
});

test("registration rejects a missing path, a file, and never creates one", async (t) => {
  const f = await createFixture(t);
  const missing = join(f.root, "does-not-exist");
  await assert.rejects(
    f.commands.registerProject("Missing", missing),
    (error: unknown) => error instanceof ProjectPathNotFoundError,
  );
  // The path was NOT created as a side effect.
  await assert.rejects(readdir(missing));

  const filePath = join(f.root, "a-file.txt");
  await writeFile(filePath, "not a directory", "utf8");
  await assert.rejects(
    f.commands.registerProject("File", filePath),
    (error: unknown) => error instanceof InvalidProjectPathError,
  );
  assert.equal((await f.projects.list()).length, 0);
});

// ---------------------------------------------------------------------------
// Task creation
// ---------------------------------------------------------------------------

test("task creation makes an active, unbound task with no session or claim", async (t) => {
  const f = await createFixture(t);
  const project = await f.commands.registerProject("Demo", f.sourcePath);

  const task = await f.commands.createTask(project.id, "Add JWT auth");
  assert.match(task.id, /^task_[0-9a-f]{32}$/);
  assert.equal(task.projectId, project.id);
  assert.equal(task.slug, "add-jwt-auth");
  assert.equal(task.status, "active");
  assert.equal(task.completedAt, null);
  assert.equal(task.archivedAt, null);

  // No session was opened and no ownership claim was acquired.
  assert.equal(await f.sessions.findTaskOwner(task.id), null);
});

test("task creation validates the project and the description", async (t) => {
  const f = await createFixture(t);
  const project = await f.commands.registerProject("Demo", f.sourcePath);
  await assert.rejects(
    f.commands.createTask(
      "prj_absent0000000000000000000000" as ProjectId,
      "Anything",
    ),
    (error: unknown) => error instanceof ProjectNotFoundError,
  );
  for (const description of ["", "   ", "\n\t"]) {
    await assert.rejects(
      f.commands.createTask(project.id, description),
      (error: unknown) => error instanceof InvalidTaskDescriptionError,
    );
  }
});

test("task identity carries no provider, model or transport information", async (t) => {
  const f = await createFixture(t);
  const project = await f.commands.registerProject("Demo", f.sourcePath);
  const task = await f.commands.createTask(project.id, "Provider neutral");
  const serialized = JSON.stringify(task).toLowerCase();
  for (const forbidden of [
    "claude",
    "codex",
    "anthropic",
    "openai",
    "google",
    "antigravity",
    "model",
    "conversation",
    "mcp",
    "host",
    String(process.pid),
  ]) {
    assert.equal(serialized.includes(forbidden), false, `leaks ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Project-only sessions
// ---------------------------------------------------------------------------

test("a project session binds only the project and acquires no task claim", async (t) => {
  const f = await createFixture(t);
  const project = await f.commands.registerProject("Demo", f.sourcePath);
  const task = await f.commands.createTask(project.id, "Untouched task");

  const binding = await f.commands.openProjectSession(project.id);
  assert.equal(isCanonicalSessionId(binding.sessionId), true);
  assert.equal(binding.projectId, project.id);
  assert.equal(binding.taskId, null);

  // No TaskBindingClaim and therefore no ownership token exists.
  assert.equal(await f.sessions.findTaskOwner(task.id), null);
  assert.equal(
    await f.sessions.captureTaskOwnership(binding.sessionId),
    null,
    "a project session has no ownership fence",
  );
  const claim = await f.store.readJson(`state/task-bindings/${task.id}.json`);
  assert.equal(claim, null, "no claim file exists");
});

test("each project session gets a distinct canonical id", async (t) => {
  const f = await createFixture(t);
  const project = await f.commands.registerProject("Demo", f.sourcePath);
  const first = await f.commands.openProjectSession(project.id);
  const second = await f.commands.openProjectSession(project.id);
  assert.notEqual(first.sessionId, second.sessionId);
});

test("opening a project session validates the project", async (t) => {
  const f = await createFixture(t);
  await assert.rejects(
    f.commands.openProjectSession(
      "prj_absent0000000000000000000000" as ProjectId,
    ),
    (error: unknown) => error instanceof ProjectNotFoundError,
  );
});

// ---------------------------------------------------------------------------
// Close semantics across both session forms
// ---------------------------------------------------------------------------

test("closeSession closes a project-only session with no false release", async (t) => {
  const f = await createFixture(t);
  const project = await f.commands.registerProject("Demo", f.sourcePath);
  const binding = await f.commands.openProjectSession(project.id);

  const closed = await f.sessionCommands.closeSession(binding.sessionId);
  // Nothing was claimed, so nothing is reported as released.
  assert.deepEqual(closed, {
    sessionId: binding.sessionId,
    released: false,
    releasedTaskId: null,
  });
  assert.equal(await f.sessions.findBinding(binding.sessionId), null);

  // Idempotent.
  assert.deepEqual(
    await f.sessionCommands.closeSession(binding.sessionId),
    closed,
  );
});

test("closeSession closes a task-bound session and reports the release", async (t) => {
  const f = await createFixture(t);
  const project = await f.commands.registerProject("Demo", f.sourcePath);
  const task = await f.commands.createTask(project.id, "Bound task");
  const opened = await f.sessionCommands.openTaskSession(project.id, task.id);

  const closed = await f.sessionCommands.closeSession(opened.sessionId);
  assert.deepEqual(closed, {
    sessionId: opened.sessionId,
    released: true,
    releasedTaskId: task.id,
  });
  assert.equal(await f.sessions.findBinding(opened.sessionId), null);
  assert.equal(await f.sessions.findTaskOwner(task.id), null);
});

test("a project session never disturbs an existing task owner", async (t) => {
  const f = await createFixture(t);
  const project = await f.commands.registerProject("Demo", f.sourcePath);
  const task = await f.commands.createTask(project.id, "Owned task");
  const owner = await f.sessionCommands.openTaskSession(project.id, task.id);

  // Opening and closing project sessions must not touch the claim.
  const projectSession = await f.commands.openProjectSession(project.id);
  assert.equal(
    (await f.sessions.findTaskOwner(task.id))?.sessionId,
    owner.sessionId,
  );
  await f.sessionCommands.closeSession(projectSession.sessionId);
  assert.equal(
    (await f.sessions.findTaskOwner(task.id))?.sessionId,
    owner.sessionId,
  );
});

test("bootstrap commands expose only the intended narrow methods", async (t) => {
  const f = await createFixture(t);
  const methods = Object.getOwnPropertyNames(
    Object.getPrototypeOf(f.commands),
  ).filter((name) => name !== "constructor");
  assert.deepEqual(methods.sort(), [
    "createTask",
    "openProjectSession",
    "registerProject",
  ]);
});
