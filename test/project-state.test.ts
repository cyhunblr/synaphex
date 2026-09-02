import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test, { type TestContext } from "node:test";
import { ProjectManager } from "../src/core/project-manager.js";
import { SessionManager } from "../src/core/session-manager.js";
import {
  AmbiguousProjectReferenceError,
  InvalidProjectPathError,
  ProjectPathAlreadyRegisteredError,
  ProjectPathNotFoundError,
  SessionAlreadyBoundToTaskError,
} from "../src/domain/errors.js";
import { StateStore } from "../src/infrastructure/state-store.js";
import { ProjectOperations } from "../src/operations/project-operations.js";

interface Fixture {
  readonly root: string;
  readonly stateRoot: string;
  readonly homeDirectory: string;
  readonly sourcesDirectory: string;
  readonly store: StateStore;
  readonly projects: ProjectManager;
}

async function createFixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const stateRoot = join(root, "state-root");
  const homeDirectory = join(root, "home");
  const sourcesDirectory = join(root, "sources");
  await Promise.all([
    mkdir(homeDirectory, { recursive: true }),
    mkdir(sourcesDirectory, { recursive: true }),
  ]);

  const store = new StateStore(stateRoot);
  return {
    root,
    stateRoot,
    homeDirectory,
    sourcesDirectory,
    store,
    projects: new ProjectManager(store, { homeDirectory }),
  };
}

async function createSource(fixture: Fixture, name: string): Promise<string> {
  const sourcePath = join(fixture.sourcesDirectory, name);
  await mkdir(sourcePath, { recursive: true });
  return sourcePath;
}

test("creates a project and its Synaphex-owned filesystem scaffold", async (t) => {
  const fixture = await createFixture(t);
  const sourcePath = await createSource(fixture, "alpha");

  const project = await fixture.projects.create("Alpha Project", sourcePath);

  assert.match(project.id, /^prj_[a-f0-9]{32}$/);
  assert.equal(project.name, "Alpha Project");
  assert.equal(project.sourcePath, await realpath(sourcePath));
  assert.ok(!Number.isNaN(Date.parse(project.createdAt)));

  const projectDirectories = await readdir(join(fixture.stateRoot, "projects"));
  assert.equal(projectDirectories.length, 1);
  assert.equal(
    projectDirectories[0],
    `${project.id}_alpha-project`,
  );

  const projectStateDirectory = join(
    fixture.stateRoot,
    "projects",
    projectDirectories[0] as string,
  );
  await Promise.all([
    readFile(join(projectStateDirectory, "project.jsonc"), "utf8"),
    readFile(join(projectStateDirectory, "rules.jsonc"), "utf8"),
    readdir(join(projectStateDirectory, "artifacts", "researcher")),
    readdir(join(projectStateDirectory, "memory", "loaded")),
    readdir(join(projectStateDirectory, "memory", "tasks")),
    readdir(join(projectStateDirectory, "tasks", "open")),
    readdir(join(projectStateDirectory, "tasks", "archive")),
  ]);
});

test("canonicalizes source paths before storing them", async (t) => {
  const fixture = await createFixture(t);
  const sourcePath = await createSource(fixture, "canonical");
  await mkdir(join(sourcePath, "nested"));
  const pathWithParentSegment = `${sourcePath}/nested/..`;

  const project = await fixture.projects.create("Canonical", pathWithParentSegment);

  assert.equal(project.sourcePath, await realpath(sourcePath));
});

test("expands a leading tilde using the configured home directory", async (t) => {
  const fixture = await createFixture(t);
  const sourcePath = join(fixture.homeDirectory, "code", "tilde-project");
  await mkdir(sourcePath, { recursive: true });

  const project = await fixture.projects.create(
    "Tilde Project",
    "~/code/tilde-project",
  );

  assert.equal(project.sourcePath, await realpath(sourcePath));
});

test("rejects a missing source path with a stable error code", async (t) => {
  const fixture = await createFixture(t);
  const missingPath = join(fixture.sourcesDirectory, "missing");

  await assert.rejects(
    fixture.projects.create("Missing", missingPath),
    (error: unknown) =>
      error instanceof ProjectPathNotFoundError &&
      error.code === "PROJECT_PATH_NOT_FOUND",
  );
});

test("rejects a source path that is not a directory", async (t) => {
  const fixture = await createFixture(t);
  const filePath = join(fixture.sourcesDirectory, "a-file.txt");
  await writeFile(filePath, "not a directory", "utf8");

  await assert.rejects(
    fixture.projects.create("File", filePath),
    (error: unknown) =>
      error instanceof InvalidProjectPathError &&
      error.code === "INVALID_PROJECT_PATH",
  );
});

test("rejects duplicate registration of the same physical directory", async (t) => {
  const fixture = await createFixture(t);
  const sourcePath = await createSource(fixture, "physical");
  const linkPath = join(fixture.sourcesDirectory, "physical-link");
  await symlink(sourcePath, linkPath, "dir");
  const firstProject = await fixture.projects.create("First", sourcePath);

  await assert.rejects(
    fixture.projects.create("Second", linkPath),
    (error: unknown) =>
      error instanceof ProjectPathAlreadyRegisteredError &&
      error.code === "PROJECT_PATH_ALREADY_REGISTERED" &&
      error.details?.projectId === firstProject.id,
  );
});

test("allows duplicate project names for different source paths", async (t) => {
  const fixture = await createFixture(t);
  const firstPath = await createSource(fixture, "duplicate-name-one");
  const secondPath = await createSource(fixture, "duplicate-name-two");

  const firstProject = await fixture.projects.create("Shared Name", firstPath);
  const secondProject = await fixture.projects.create("Shared Name", secondPath);

  assert.notEqual(firstProject.id, secondProject.id);
  assert.equal((await fixture.projects.list()).length, 2);
});

test("resolves a project by its immutable internal ID", async (t) => {
  const fixture = await createFixture(t);
  const project = await fixture.projects.create(
    "By Id",
    await createSource(fixture, "by-id"),
  );

  assert.deepEqual(await fixture.projects.resolve(project.id), project);
  assert.deepEqual(await fixture.projects.get(project.id), project);
});

test("resolves a project by a unique exact name", async (t) => {
  const fixture = await createFixture(t);
  const project = await fixture.projects.create(
    "Unique Name",
    await createSource(fixture, "unique-name"),
  );

  assert.deepEqual(await fixture.projects.resolve("Unique Name"), project);
});

test("rejects an ambiguous duplicate project name", async (t) => {
  const fixture = await createFixture(t);
  await fixture.projects.create(
    "Ambiguous",
    await createSource(fixture, "ambiguous-one"),
  );
  await fixture.projects.create(
    "Ambiguous",
    await createSource(fixture, "ambiguous-two"),
  );

  await assert.rejects(
    fixture.projects.resolve("Ambiguous"),
    (error: unknown) =>
      error instanceof AmbiguousProjectReferenceError &&
      error.code === "AMBIGUOUS_PROJECT_REFERENCE" &&
      Array.isArray(error.details?.projectIds) &&
      error.details.projectIds.length === 2,
  );
});

test("resolves and finds a project by canonical source path", async (t) => {
  const fixture = await createFixture(t);
  const sourcePath = await createSource(fixture, "by-source-path");
  const linkPath = join(fixture.sourcesDirectory, "by-source-link");
  await symlink(sourcePath, linkPath, "dir");
  const project = await fixture.projects.create("By Source", sourcePath);

  assert.deepEqual(await fixture.projects.resolve(linkPath), project);
  assert.deepEqual(await fixture.projects.findBySourcePath(linkPath), project);
});

test("createProject automatically binds the calling session", async (t) => {
  const fixture = await createFixture(t);
  const operations = new ProjectOperations({
    synaphexRoot: fixture.stateRoot,
    homeDirectory: fixture.homeDirectory,
  });
  const sessions = new SessionManager(new StateStore(fixture.stateRoot));

  const project = await operations.createProject(
    "session/create",
    "Created",
    await createSource(fixture, "created-and-bound"),
  );

  assert.deepEqual(await sessions.getCurrentBinding("session/create"), {
    sessionId: "session/create",
    projectId: project.id,
    taskId: null,
  });
});

test("useProject binds and switches a project-only session", async (t) => {
  const fixture = await createFixture(t);
  const operations = new ProjectOperations({
    synaphexRoot: fixture.stateRoot,
    homeDirectory: fixture.homeDirectory,
  });
  const sessions = new SessionManager(new StateStore(fixture.stateRoot));
  const firstProject = await fixture.projects.create(
    "First",
    await createSource(fixture, "switch-first"),
  );
  const secondProject = await fixture.projects.create(
    "Second",
    await createSource(fixture, "switch-second"),
  );

  await operations.useProject("switching-session", firstProject.id);
  await operations.useProject("switching-session", "Second");

  assert.equal(
    (await sessions.getCurrentBinding("switching-session")).projectId,
    secondProject.id,
  );
});

test("session state survives new manager and service instances", async (t) => {
  const fixture = await createFixture(t);
  const firstOperations = new ProjectOperations({
    synaphexRoot: fixture.stateRoot,
    homeDirectory: fixture.homeDirectory,
  });
  const project = await firstOperations.createProject(
    "persistent-session",
    "Persistent",
    await createSource(fixture, "persistent"),
  );

  const newSessions = new SessionManager(new StateStore(fixture.stateRoot));
  const newOperations = new ProjectOperations({
    synaphexRoot: fixture.stateRoot,
    homeDirectory: fixture.homeDirectory,
  });

  assert.equal(
    (await newSessions.getCurrentBinding("persistent-session")).projectId,
    project.id,
  );
  assert.deepEqual(
    await newOperations.useProject("persistent-session", project.id),
    project,
  );
});

test("project creation never writes into the user's source directory", async (t) => {
  const fixture = await createFixture(t);
  const sourcePath = await createSource(fixture, "untouched");
  await writeFile(join(sourcePath, "existing.txt"), "keep me", "utf8");
  const before = await readdir(sourcePath);

  await fixture.projects.create("Untouched", sourcePath);

  assert.deepEqual(await readdir(sourcePath), before);
  assert.equal(await readFile(join(sourcePath, "existing.txt"), "utf8"), "keep me");
});

test("unknown sessions are unbound and unsafe session IDs become safe filenames", async (t) => {
  const fixture = await createFixture(t);
  const sessions = new SessionManager(fixture.store);
  const unsafeSessionId = "provider/session:../../outside?value=1";

  assert.deepEqual(await sessions.getCurrentBinding(unsafeSessionId), {
    sessionId: unsafeSessionId,
    projectId: null,
    taskId: null,
  });

  const project = await fixture.projects.create(
    "Safe Session",
    await createSource(fixture, "safe-session"),
  );
  await sessions.bindProject(unsafeSessionId, project.id);

  const filenames = await readdir(join(fixture.stateRoot, "state", "sessions"));
  assert.equal(filenames.length, 1);
  assert.match(filenames[0] as string, /^[a-f0-9]{64}\.jsonc$/);
  assert.ok(!filenames.includes(basename(unsafeSessionId)));
});

test("JSONC state files accept comments and trailing commas", async (t) => {
  const fixture = await createFixture(t);
  await fixture.store.ensureDirectory("custom");
  await writeFile(
    join(fixture.stateRoot, "custom", "commented.jsonc"),
    "{\n  // a comment\n  \"enabled\": true,\n}\n",
    "utf8",
  );

  assert.deepEqual(
    await fixture.store.readJson("custom/commented.jsonc"),
    { enabled: true },
  );

  await fixture.store.writeJson("custom/plain.json", { format: "json" });
  assert.deepEqual(await fixture.store.readJson("custom/plain.json"), {
    format: "json",
  });
});

test("project operations reject every project binding while a session has a task", async (t) => {
  const fixture = await createFixture(t);
  const operations = new ProjectOperations({
    synaphexRoot: fixture.stateRoot,
    homeDirectory: fixture.homeDirectory,
  });
  const firstProject = await fixture.projects.create(
    "Task Project",
    await createSource(fixture, "task-project"),
  );
  const secondProject = await fixture.projects.create(
    "Other Project",
    await createSource(fixture, "other-project"),
  );
  const sessionId = "task-bound-session";
  const sessionHash = createHash("sha256").update(sessionId).digest("hex");
  await fixture.store.writeJson(`state/sessions/${sessionHash}.jsonc`, {
    sessionId,
    projectId: firstProject.id,
    taskId: "task_future",
  });

  await assert.rejects(
    operations.useProject(sessionId, firstProject.id),
    (error: unknown) =>
      error instanceof SessionAlreadyBoundToTaskError &&
      error.code === "SESSION_ALREADY_BOUND_TO_TASK",
  );
  await assert.rejects(
    operations.useProject(sessionId, secondProject.id),
    (error: unknown) =>
      error instanceof SessionAlreadyBoundToTaskError &&
      error.code === "SESSION_ALREADY_BOUND_TO_TASK",
  );
  await assert.rejects(
    operations.createProject(
      sessionId,
      "Blocked Project",
      await createSource(fixture, "blocked-project"),
    ),
    SessionAlreadyBoundToTaskError,
  );
  assert.equal((await fixture.projects.list()).length, 2);
});
