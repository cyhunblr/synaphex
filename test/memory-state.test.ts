import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { MemoryManager } from "../src/core/memory-manager.js";
import { ProjectManager } from "../src/core/project-manager.js";
import { projectStateDirectory } from "../src/core/project-state-path.js";
import { SessionManager } from "../src/core/session-manager.js";
import { TaskManager } from "../src/core/task-manager.js";
import {
  InvalidMemoryReferenceError,
  MemoryAlreadyLoadedError,
  MemoryLoadCycleError,
  MemoryMutationLockTimeoutError,
  MemoryNotLoadedError,
  MemorySourceNotFoundError,
  NoProjectBoundError,
  TaskArchivedError,
} from "../src/domain/errors.js";
import type {
  MemoryLoadRequest,
  MemoryScope,
  MemorySourceIdentity,
} from "../src/domain/memory.js";
import type { Project, ProjectId } from "../src/domain/project.js";
import type { Task } from "../src/domain/task.js";
import { StateStore } from "../src/infrastructure/state-store.js";
import { MemoryOperations } from "../src/operations/memory-operations.js";

interface Fixture {
  readonly root: string;
  readonly stateRoot: string;
  readonly homeDirectory: string;
  readonly sourcesDirectory: string;
  readonly store: StateStore;
  readonly projectManager: ProjectManager;
  readonly sessionManager: SessionManager;
  readonly taskManager: TaskManager;
  readonly memoryManager: MemoryManager;
  readonly operations: MemoryOperations;
  readonly projectA: Project;
  readonly projectB: Project;
  readonly projectC: Project;
  readonly taskA1: Task;
  readonly taskA2: Task;
  readonly taskB1: Task;
  readonly taskB2: Task;
}

async function createFixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-memory-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const stateRoot = join(root, "state-root");
  const homeDirectory = join(root, "home");
  const sourcesDirectory = join(root, "sources");
  await Promise.all([
    mkdir(homeDirectory, { recursive: true }),
    mkdir(sourcesDirectory, { recursive: true }),
  ]);

  const store = new StateStore(stateRoot);
  const projectManager = new ProjectManager(store, { homeDirectory });
  const sessionManager = new SessionManager(store);
  const taskManager = new TaskManager(store, projectManager);
  const projectAPath = join(sourcesDirectory, "project-a");
  const projectBPath = join(sourcesDirectory, "project-b");
  const projectCPath = join(sourcesDirectory, "project-c");
  await Promise.all([
    mkdir(projectAPath),
    mkdir(projectBPath),
    mkdir(projectCPath),
  ]);
  const [projectA, projectB, projectC] = await Promise.all([
    projectManager.create("Project A", projectAPath),
    projectManager.create("Project B", projectBPath),
    projectManager.create("Project C", projectCPath),
  ]);
  const [taskA1, taskA2, taskB1, taskB2] = await Promise.all([
    taskManager.create(projectA.id, "Project A first task"),
    taskManager.create(projectA.id, "Project A second task"),
    taskManager.create(projectB.id, "Project B first task"),
    taskManager.create(projectB.id, "Project B second task"),
  ]);
  const memoryManager = new MemoryManager(store, projectManager, taskManager);

  return {
    root,
    stateRoot,
    homeDirectory,
    sourcesDirectory,
    store,
    projectManager,
    sessionManager,
    taskManager,
    memoryManager,
    operations: new MemoryOperations({ synaphexRoot: stateRoot, homeDirectory }),
    projectA,
    projectB,
    projectC,
    taskA1,
    taskA2,
    taskB1,
    taskB2,
  };
}

function newOperations(fixture: Fixture): MemoryOperations {
  return new MemoryOperations({
    synaphexRoot: fixture.stateRoot,
    homeDirectory: fixture.homeDirectory,
  });
}

async function bindProject(
  fixture: Fixture,
  sessionId: string,
  project: Project,
): Promise<void> {
  await fixture.sessionManager.bindProject(sessionId, project.id);
}

async function bindTask(
  fixture: Fixture,
  sessionId: string,
  project: Project,
  task: Task,
): Promise<void> {
  await bindProject(fixture, sessionId, project);
  await fixture.sessionManager.bindTask(sessionId, task.id);
}

function projectSource(project: Project): MemorySourceIdentity {
  return {
    kind: "project",
    projectId: project.id,
    projectName: project.name,
  };
}

function taskSource(project: Project, task: Task): MemorySourceIdentity {
  return {
    kind: "task",
    projectId: project.id,
    projectName: project.name,
    taskId: task.id,
    taskSlug: task.slug,
  };
}

function projectScope(project: Project): MemoryScope {
  return { kind: "project", projectId: project.id };
}

function taskScope(project: Project, task: Task): MemoryScope {
  return { kind: "task", projectId: project.id, taskId: task.id };
}

test("loads project memory into another project using the project-only target", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "project-target";
  await bindProject(fixture, sessionId, fixture.projectA);

  const reference = await fixture.operations.loadMemory({
    sessionId,
    sourceProjectRef: fixture.projectB.id,
  });

  assert.deepEqual(reference.target, projectScope(fixture.projectA));
  assert.deepEqual(reference.source, projectSource(fixture.projectB));
});

test("loads a task memory scope into a project without loading its project", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "task-into-project";
  await bindProject(fixture, sessionId, fixture.projectA);

  const reference = await fixture.operations.loadMemory({
    sessionId,
    sourceProjectRef: fixture.projectB.name,
    sourceTaskRef: fixture.taskB1.slug,
  });

  assert.deepEqual(reference.source, taskSource(fixture.projectB, fixture.taskB1));
  assert.equal((await fixture.operations.listLoadedMemory(sessionId)).length, 1);
});

test("loads project memory into the current task target", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "project-into-task";
  await bindTask(fixture, sessionId, fixture.projectA, fixture.taskA1);

  const reference = await fixture.operations.loadMemory({
    sessionId,
    sourceProjectRef: fixture.projectB.id,
  });

  assert.deepEqual(reference.target, taskScope(fixture.projectA, fixture.taskA1));
  assert.deepEqual(reference.source, projectSource(fixture.projectB));
});

test("loads task memory into another task", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "task-into-task";
  await bindTask(fixture, sessionId, fixture.projectA, fixture.taskA1);

  const reference = await fixture.operations.loadMemory({
    sessionId,
    sourceProjectRef: fixture.projectB.id,
    sourceTaskRef: fixture.taskB1.id,
  });

  assert.deepEqual(reference.source, taskSource(fixture.projectB, fixture.taskB1));
});

test("same-project task memory can be loaded into a different task", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "same-project-tasks";
  await fixture.taskManager.markCompleted(fixture.projectA.id, fixture.taskA1.id);
  await bindTask(fixture, sessionId, fixture.projectA, fixture.taskA2);

  await fixture.operations.loadMemory({
    sessionId,
    sourceProjectRef: fixture.projectA.id,
    sourceTaskRef: fixture.taskA1.id,
  });

  assert.equal(
    await fixture.memoryManager.isLoaded(
      taskScope(fixture.projectA, fixture.taskA2),
      taskScope(fixture.projectA, fixture.taskA1),
    ),
    true,
  );
});

test("archived task memory remains a valid source", async (t) => {
  const fixture = await createFixture(t);
  await fixture.taskManager.markCompleted(fixture.projectB.id, fixture.taskB1.id);
  await fixture.taskManager.archive(fixture.projectB.id, fixture.taskB1.id);
  const sessionId = "archived-source";
  await bindProject(fixture, sessionId, fixture.projectA);

  const reference = await fixture.operations.loadMemory({
    sessionId,
    sourceProjectRef: fixture.projectB.id,
    sourceTaskRef: fixture.taskB1.slug,
  });

  assert.equal(reference.source.kind, "task");
  assert.equal(
    reference.source.kind === "task" ? reference.source.taskId : null,
    fixture.taskB1.id,
  );
});

test("canonical Markdown may be absent and loading never creates or copies it", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "absent-canonical";
  await bindProject(fixture, sessionId, fixture.projectA);
  const sourceScope = taskScope(fixture.projectB, fixture.taskB1);
  const canonicalPath = await fixture.memoryManager.resolveCanonicalSourceLocation(
    sourceScope,
  );
  assert.equal(await fixture.store.exists(canonicalPath), false);

  await fixture.operations.loadMemory({
    sessionId,
    sourceProjectRef: fixture.projectB.id,
    sourceTaskRef: fixture.taskB1.id,
  });

  assert.equal(await fixture.store.exists(canonicalPath), false);
  assert.deepEqual(await fixture.memoryManager.getCanonicalMemory(sourceScope), {
    scope: sourceScope,
    hasContent: false,
    content: null,
  });
});

test("loaded references persist with immutable source IDs across service instances", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "persistent-load";
  await bindTask(fixture, sessionId, fixture.projectA, fixture.taskA1);
  await fixture.operations.loadMemory({
    sessionId,
    sourceProjectRef: fixture.projectB.id,
    sourceTaskRef: fixture.taskB1.id,
  });

  const loaded = await newOperations(fixture).listLoadedMemory(sessionId);

  assert.equal(loaded.length, 1);
  assert.deepEqual(loaded[0]?.target, taskScope(fixture.projectA, fixture.taskA1));
  assert.deepEqual(loaded[0]?.source, taskSource(fixture.projectB, fixture.taskB1));
});

test("unload persists and does not modify canonical source state", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "persistent-unload";
  await bindProject(fixture, sessionId, fixture.projectA);
  const sourceScope = projectScope(fixture.projectB);
  const canonicalPath = await fixture.memoryManager.resolveCanonicalSourceLocation(
    sourceScope,
  );
  await fixture.store.writeText(canonicalPath, "# Canonical source\nExact text.\n");
  const request: MemoryLoadRequest = {
    sessionId,
    sourceProjectRef: fixture.projectB.id,
  };
  await fixture.operations.loadMemory(request);

  await newOperations(fixture).unloadMemory(request);

  assert.deepEqual(await newOperations(fixture).listLoadedMemory(sessionId), []);
  assert.equal(
    await fixture.store.readText(canonicalPath),
    "# Canonical source\nExact text.\n",
  );
  assert.deepEqual(await fixture.projectManager.get(fixture.projectB.id), fixture.projectB);
});

test("independent targets can load the same source and unload independently", async (t) => {
  const fixture = await createFixture(t);
  const firstSession = "independent-a";
  const secondSession = "independent-c";
  await Promise.all([
    bindProject(fixture, firstSession, fixture.projectA),
    bindProject(fixture, secondSession, fixture.projectC),
  ]);
  const firstRequest = {
    sessionId: firstSession,
    sourceProjectRef: fixture.projectB.id,
  };
  const secondRequest = {
    sessionId: secondSession,
    sourceProjectRef: fixture.projectB.id,
  };
  await fixture.operations.loadMemory(firstRequest);
  await fixture.operations.loadMemory(secondRequest);

  await fixture.operations.unloadMemory(firstRequest);

  assert.deepEqual(await fixture.operations.listLoadedMemory(firstSession), []);
  assert.equal((await fixture.operations.listLoadedMemory(secondSession)).length, 1);
});

test("duplicate loads are rejected", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "duplicate-load";
  await bindProject(fixture, sessionId, fixture.projectA);
  const request = { sessionId, sourceProjectRef: fixture.projectB.id };
  await fixture.operations.loadMemory(request);

  await assert.rejects(
    fixture.operations.loadMemory(request),
    (error: unknown) =>
      error instanceof MemoryAlreadyLoadedError &&
      error.code === "MEMORY_ALREADY_LOADED",
  );
});

test("unloading a source that is not loaded is rejected", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "missing-unload";
  await bindProject(fixture, sessionId, fixture.projectA);

  await assert.rejects(
    fixture.operations.unloadMemory({
      sessionId,
      sourceProjectRef: fixture.projectB.id,
    }),
    (error: unknown) =>
      error instanceof MemoryNotLoadedError &&
      error.code === "MEMORY_NOT_LOADED",
  );
});

test("project and task self-loads are rejected", async (t) => {
  const fixture = await createFixture(t);
  await bindProject(fixture, "project-self", fixture.projectA);
  await bindTask(fixture, "task-self", fixture.projectA, fixture.taskA1);

  await assert.rejects(
    fixture.operations.loadMemory({
      sessionId: "project-self",
      sourceProjectRef: fixture.projectA.id,
    }),
    MemoryLoadCycleError,
  );
  await assert.rejects(
    fixture.operations.loadMemory({
      sessionId: "task-self",
      sourceProjectRef: fixture.projectA.id,
      sourceTaskRef: fixture.taskA1.id,
    }),
    (error: unknown) =>
      error instanceof MemoryLoadCycleError &&
      error.code === "MEMORY_LOAD_CYCLE",
  );
});

test("project-to-project cycles are rejected", async (t) => {
  const fixture = await createFixture(t);
  await Promise.all([
    bindProject(fixture, "project-cycle-a", fixture.projectA),
    bindProject(fixture, "project-cycle-b", fixture.projectB),
  ]);
  await fixture.operations.loadMemory({
    sessionId: "project-cycle-a",
    sourceProjectRef: fixture.projectB.id,
  });

  await assert.rejects(
    fixture.operations.loadMemory({
      sessionId: "project-cycle-b",
      sourceProjectRef: fixture.projectA.id,
    }),
    MemoryLoadCycleError,
  );
});

test("task-to-task cycles are rejected", async (t) => {
  const fixture = await createFixture(t);
  await Promise.all([
    bindTask(fixture, "task-cycle-a", fixture.projectA, fixture.taskA1),
    bindTask(fixture, "task-cycle-b", fixture.projectB, fixture.taskB1),
  ]);
  await fixture.operations.loadMemory({
    sessionId: "task-cycle-a",
    sourceProjectRef: fixture.projectB.id,
    sourceTaskRef: fixture.taskB1.id,
  });

  await assert.rejects(
    fixture.operations.loadMemory({
      sessionId: "task-cycle-b",
      sourceProjectRef: fixture.projectA.id,
      sourceTaskRef: fixture.taskA1.id,
    }),
    MemoryLoadCycleError,
  );
});

test("mixed project-task cycles are rejected", async (t) => {
  const fixture = await createFixture(t);
  await bindProject(fixture, "mixed-project", fixture.projectA);
  await bindTask(fixture, "mixed-task", fixture.projectB, fixture.taskB1);
  await fixture.operations.loadMemory({
    sessionId: "mixed-project",
    sourceProjectRef: fixture.projectB.id,
    sourceTaskRef: fixture.taskB1.id,
  });

  await assert.rejects(
    fixture.operations.loadMemory({
      sessionId: "mixed-task",
      sourceProjectRef: fixture.projectA.id,
    }),
    MemoryLoadCycleError,
  );
});

test("cycle detection uses persisted graph state after service restart", async (t) => {
  const fixture = await createFixture(t);
  await Promise.all([
    bindProject(fixture, "persisted-cycle-a", fixture.projectA),
    bindProject(fixture, "persisted-cycle-b", fixture.projectB),
  ]);
  await fixture.operations.loadMemory({
    sessionId: "persisted-cycle-a",
    sourceProjectRef: fixture.projectB.id,
  });

  await assert.rejects(
    newOperations(fixture).loadMemory({
      sessionId: "persisted-cycle-b",
      sourceProjectRef: fixture.projectA.id,
    }),
    MemoryLoadCycleError,
  );
});

test("completed but still-bound task remains a valid load and unload target", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "completed-target";
  await bindTask(fixture, sessionId, fixture.projectA, fixture.taskA1);
  await fixture.taskManager.markCompleted(fixture.projectA.id, fixture.taskA1.id);
  const request = { sessionId, sourceProjectRef: fixture.projectB.id };

  const reference = await fixture.operations.loadMemory(request);
  assert.deepEqual(reference.target, taskScope(fixture.projectA, fixture.taskA1));
  await fixture.operations.unloadMemory(request);
  assert.deepEqual(await fixture.operations.listLoadedMemory(sessionId), []);
});

test("an archived task cannot act as the current target", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "archived-target";
  await bindTask(fixture, sessionId, fixture.projectA, fixture.taskA1);
  await fixture.taskManager.markCompleted(fixture.projectA.id, fixture.taskA1.id);
  await fixture.taskManager.archive(fixture.projectA.id, fixture.taskA1.id);

  await assert.rejects(
    fixture.operations.loadMemory({
      sessionId,
      sourceProjectRef: fixture.projectB.id,
    }),
    TaskArchivedError,
  );
});

test("a session without a project cannot select a memory target", async (t) => {
  const fixture = await createFixture(t);

  await assert.rejects(
    fixture.operations.loadMemory({
      sessionId: "no-project",
      sourceProjectRef: fixture.projectB.id,
    }),
    (error: unknown) =>
      error instanceof NoProjectBoundError && error.code === "NO_PROJECT_BOUND",
  );
});

test("missing canonical project and task files return explicit no-content results", async (t) => {
  const fixture = await createFixture(t);
  const projectMemory = await fixture.memoryManager.getProjectCanonicalMemory(
    fixture.projectA.id,
  );
  const taskMemory = await fixture.memoryManager.getTaskCanonicalMemory(
    fixture.projectA.id,
    fixture.taskA1.id,
  );

  assert.deepEqual(projectMemory, {
    scope: projectScope(fixture.projectA),
    hasContent: false,
    content: null,
  });
  assert.deepEqual(taskMemory, {
    scope: taskScope(fixture.projectA, fixture.taskA1),
    hasContent: false,
    content: null,
  });
});

test("manually created canonical Markdown is read exactly", async (t) => {
  const fixture = await createFixture(t);
  const projectScopeValue = projectScope(fixture.projectA);
  const taskScopeValue = taskScope(fixture.projectA, fixture.taskA1);
  const projectContent = "# Project memory\n\nExact project text.\n";
  const taskContent = "# Task memory\n\nExact task text.\n";
  await fixture.store.writeText(
    await fixture.memoryManager.resolveCanonicalSourceLocation(
      projectScopeValue,
    ),
    projectContent,
  );
  await fixture.store.writeText(
    await fixture.memoryManager.resolveCanonicalSourceLocation(taskScopeValue),
    taskContent,
  );

  assert.deepEqual(
    await fixture.memoryManager.getCanonicalMemory(projectScopeValue),
    { scope: projectScopeValue, hasContent: true, content: projectContent },
  );
  assert.deepEqual(
    await fixture.memoryManager.getCanonicalMemory(taskScopeValue),
    { scope: taskScopeValue, hasContent: true, content: taskContent },
  );
});

test("invalid persisted metadata is rejected rather than treated as committed", async (t) => {
  const fixture = await createFixture(t);
  const loadedDirectory = `${projectStateDirectory(fixture.projectA)}/memory/loaded`;
  await fixture.store.writeJson(
    `${loadedDirectory}/project-${fixture.projectB.id}.json`,
    { incomplete: true },
  );

  await assert.rejects(
    fixture.memoryManager.listLoadedReferences(projectScope(fixture.projectA)),
    (error: unknown) =>
      error instanceof InvalidMemoryReferenceError &&
      error.code === "INVALID_MEMORY_REFERENCE",
  );
});

test("syntactically corrupt reference metadata returns the stable invalid-reference code", async (t) => {
  const fixture = await createFixture(t);
  const loadedDirectory = `${projectStateDirectory(fixture.projectA)}/memory/loaded`;
  await fixture.store.writeText(
    `${loadedDirectory}/project-${fixture.projectB.id}.json`,
    "{ incomplete",
  );

  await assert.rejects(
    fixture.memoryManager.listLoadedReferences(projectScope(fixture.projectA)),
    (error: unknown) =>
      error instanceof InvalidMemoryReferenceError &&
      error.code === "INVALID_MEMORY_REFERENCE",
  );
});

test("a nonexistent structured memory scope returns a stable source error", async (t) => {
  const fixture = await createFixture(t);

  await assert.rejects(
    fixture.memoryManager.getCanonicalMemory({
      kind: "project",
      projectId: "prj_missing" as ProjectId,
    }),
    (error: unknown) =>
      error instanceof MemorySourceNotFoundError &&
      error.code === "MEMORY_SOURCE_NOT_FOUND",
  );
});

test("load and unload never write to user source repositories", async (t) => {
  const fixture = await createFixture(t);
  const sourceA = fixture.projectA.sourcePath;
  const sourceB = fixture.projectB.sourcePath;
  await Promise.all([
    writeFile(join(sourceA, "a.txt"), "A", "utf8"),
    writeFile(join(sourceB, "b.txt"), "B", "utf8"),
  ]);
  const [beforeA, beforeB] = await Promise.all([
    readdir(sourceA),
    readdir(sourceB),
  ]);
  const sessionId = "source-safety";
  await bindProject(fixture, sessionId, fixture.projectA);
  const request = { sessionId, sourceProjectRef: fixture.projectB.id };

  await fixture.operations.loadMemory(request);
  await fixture.operations.unloadMemory(request);

  assert.deepEqual(await readdir(sourceA), beforeA);
  assert.deepEqual(await readdir(sourceB), beforeB);
  assert.equal(await readFile(join(sourceA, "a.txt"), "utf8"), "A");
  assert.equal(await readFile(join(sourceB, "b.txt"), "utf8"), "B");
});

test("concurrent duplicate loads commit exactly one reference", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "concurrent-duplicate";
  await bindProject(fixture, sessionId, fixture.projectA);
  const request = { sessionId, sourceProjectRef: fixture.projectB.id };
  const first = fixture.operations.loadMemory(request);
  const second = newOperations(fixture).loadMemory(request);

  const results = await Promise.allSettled([first, second]);

  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  const rejected = results.find(({ status }) => status === "rejected");
  assert.ok(rejected?.status === "rejected");
  assert.ok(rejected.reason instanceof MemoryAlreadyLoadedError);
  assert.equal((await newOperations(fixture).listLoadedMemory(sessionId)).length, 1);
});

test("concurrent load and unload serialize to a valid committed target state", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "concurrent-mutation";
  await bindProject(fixture, sessionId, fixture.projectA);
  const request = { sessionId, sourceProjectRef: fixture.projectB.id };
  await fixture.operations.loadMemory(request);

  const results = await Promise.allSettled([
    fixture.operations.loadMemory(request),
    newOperations(fixture).unloadMemory(request),
  ]);
  const loaded = await newOperations(fixture).listLoadedMemory(sessionId);

  assert.ok(loaded.length === 0 || loaded.length === 1);
  assert.equal(
    loaded.length,
    results[0]?.status === "fulfilled" ? 1 : 0,
  );
  if (results[0]?.status === "rejected") {
    assert.ok(results[0].reason instanceof MemoryAlreadyLoadedError);
  }
  assert.equal(results[1]?.status, "fulfilled");
});

test("memory mutation lock contention returns a stable timeout error", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "memory-lock-timeout";
  await bindProject(fixture, sessionId, fixture.projectA);
  assert.equal(
    await fixture.store.createJsonExclusive(
      "state/memory-graph/.mutation-lock.json",
      { heldBy: "test" },
    ),
    true,
  );

  await assert.rejects(
    fixture.operations.loadMemory({
      sessionId,
      sourceProjectRef: fixture.projectB.id,
    }),
    (error: unknown) =>
      error instanceof MemoryMutationLockTimeoutError &&
      error.code === "MEMORY_MUTATION_LOCK_TIMEOUT",
  );
});
