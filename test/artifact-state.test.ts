import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { ArtifactManager } from "../src/core/artifact-manager.js";
import { ProjectManager } from "../src/core/project-manager.js";
import { projectStateDirectory } from "../src/core/project-state-path.js";
import { TaskManager } from "../src/core/task-manager.js";
import type {
  ArtifactId,
  ArtifactPayload,
  ProjectArtifactScope,
  TaskArtifactScope,
} from "../src/domain/artifact.js";
import {
  ArtifactNotFoundError,
  InvalidArtifactError,
  InvalidArtifactPayloadError,
  InvalidArtifactScopeError,
  TaskArchivedError,
  TaskCompletedError,
} from "../src/domain/errors.js";
import type { Project } from "../src/domain/project.js";
import type { Task } from "../src/domain/task.js";
import { StateStore } from "../src/infrastructure/state-store.js";

interface Fixture {
  readonly root: string;
  readonly stateRoot: string;
  readonly sourcePath: string;
  readonly store: StateStore;
  readonly projects: ProjectManager;
  readonly tasks: TaskManager;
  readonly artifacts: ArtifactManager;
  readonly project: Project;
  readonly task: Task;
}

async function createFixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-artifact-test-"));
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
  const tasks = new TaskManager(store, projects);
  const project = await projects.create("Artifact Project", sourcePath);
  const task = await tasks.create(project.id, "Store working artifacts");
  return {
    root,
    stateRoot,
    sourcePath,
    store,
    projects,
    tasks,
    artifacts: new ArtifactManager(store, projects, tasks),
    project,
    task,
  };
}

function newServices(fixture: Fixture): {
  readonly store: StateStore;
  readonly projects: ProjectManager;
  readonly tasks: TaskManager;
  readonly artifacts: ArtifactManager;
} {
  const store = new StateStore(fixture.stateRoot);
  const projects = new ProjectManager(store, {
    homeDirectory: join(fixture.root, "home"),
  });
  const tasks = new TaskManager(store, projects);
  return {
    store,
    projects,
    tasks,
    artifacts: new ArtifactManager(store, projects, tasks),
  };
}

function projectScope(fixture: Fixture): ProjectArtifactScope {
  return { kind: "project", projectId: fixture.project.id };
}

function taskScope(fixture: Fixture): TaskArtifactScope {
  return {
    kind: "task",
    projectId: fixture.project.id,
    taskId: fixture.task.id,
  };
}

test("Questioner context has explicit missing, replace, read, and clear states", async (t) => {
  const fixture = await createFixture(t);
  const scope = taskScope(fixture);

  assert.deepEqual(await fixture.artifacts.getQuestionerContext(scope), {
    scope,
    hasContext: false,
    context: null,
  });

  const first = await fixture.artifacts.saveQuestionerContext(scope, {
    questions: ["What should change?"],
  });
  assert.deepEqual(first.payload, { questions: ["What should change?"] });
  assert.deepEqual(
    (await fixture.artifacts.getQuestionerContext(scope)).context,
    first,
  );

  const replacement = await fixture.artifacts.saveQuestionerContext(scope, {
    questions: ["What should change?"],
    answers: ["Only storage."],
  });
  assert.deepEqual(
    (await fixture.artifacts.getQuestionerContext(scope)).context,
    replacement,
  );
  assert.equal(await fixture.artifacts.clearQuestionerContext(scope), true);
  assert.equal(
    (await fixture.artifacts.getQuestionerContext(scope)).hasContext,
    false,
  );
  assert.equal(await fixture.artifacts.clearQuestionerContext(scope), false);
});

test("Questioner context persists across manager instances", async (t) => {
  const fixture = await createFixture(t);
  const scope = taskScope(fixture);
  await fixture.artifacts.saveQuestionerContext(scope, { turn: 3 });

  const persisted = await newServices(fixture).artifacts.getQuestionerContext(
    scope,
  );

  assert.equal(persisted.hasContext, true);
  assert.deepEqual(persisted.context?.payload, { turn: 3 });
});

test("Questioner save rejects completed tasks while clear remains allowed", async (t) => {
  const fixture = await createFixture(t);
  const scope = taskScope(fixture);
  await fixture.artifacts.saveQuestionerContext(scope, { state: "active" });
  await fixture.tasks.markCompleted(fixture.project.id, fixture.task.id);

  await assert.rejects(
    fixture.artifacts.saveQuestionerContext(scope, { state: "completed" }),
    (error: unknown) =>
      error instanceof TaskCompletedError && error.code === "TASK_COMPLETED",
  );
  assert.equal(await fixture.artifacts.clearQuestionerContext(scope), true);
  assert.equal(
    (await fixture.artifacts.getQuestionerContext(scope)).hasContext,
    false,
  );
});

test("Questioner save and clear reject archived tasks", async (t) => {
  const fixture = await createFixture(t);
  const scope = taskScope(fixture);
  await fixture.tasks.markCompleted(fixture.project.id, fixture.task.id);
  await fixture.tasks.archive(fixture.project.id, fixture.task.id);

  await assert.rejects(
    fixture.artifacts.saveQuestionerContext(scope, { state: "archived" }),
    (error: unknown) =>
      error instanceof TaskArchivedError && error.code === "TASK_ARCHIVED",
  );
  await assert.rejects(
    fixture.artifacts.clearQuestionerContext(scope),
    (error: unknown) =>
      error instanceof TaskArchivedError && error.code === "TASK_ARCHIVED",
  );
});

test("Researcher artifacts support project and task scopes and append records", async (t) => {
  const fixture = await createFixture(t);
  const project = projectScope(fixture);
  const task = taskScope(fixture);

  const projectRecord = await fixture.artifacts.saveResearchArtifact(project, {
    subject: "project",
  });
  const firstTaskRecord = await fixture.artifacts.saveResearchArtifact(task, {
    subject: "task",
    run: 1,
  });
  const secondTaskRecord = await fixture.artifacts.saveResearchArtifact(task, {
    subject: "task",
    run: 2,
  });

  assert.match(projectRecord.id, /^artifact_[a-f0-9]{32}$/);
  assert.notEqual(firstTaskRecord.id, secondTaskRecord.id);
  assert.deepEqual(await fixture.artifacts.listResearchArtifacts(project), [
    projectRecord,
  ]);
  assert.deepEqual(
    await fixture.artifacts.getResearchArtifact(task, secondTaskRecord.id),
    secondTaskRecord,
  );
  assert.deepEqual(
    new Set(
      (await fixture.artifacts.listResearchArtifacts(task)).map(({ id }) => id),
    ),
    new Set([firstTaskRecord.id, secondTaskRecord.id]),
  );
});

test("project Researcher artifacts persist across manager instances", async (t) => {
  const fixture = await createFixture(t);
  const scope = projectScope(fixture);
  const artifact = await fixture.artifacts.saveResearchArtifact(scope, {
    durable: true,
  });

  assert.deepEqual(
    await newServices(fixture).artifacts.getResearchArtifact(scope, artifact.id),
    artifact,
  );
});

test("task Researcher writes allow completed tasks but reject archived tasks", async (t) => {
  const fixture = await createFixture(t);
  const scope = taskScope(fixture);
  await fixture.tasks.markCompleted(fixture.project.id, fixture.task.id);

  const completedArtifact = await fixture.artifacts.saveResearchArtifact(scope, {
    state: "completed",
  });
  assert.deepEqual(completedArtifact.payload, { state: "completed" });

  await fixture.tasks.archive(fixture.project.id, fixture.task.id);
  await assert.rejects(
    fixture.artifacts.saveResearchArtifact(scope, { state: "archived" }),
    (error: unknown) =>
      error instanceof TaskArchivedError && error.code === "TASK_ARCHIVED",
  );
});

test("a specific Researcher artifact can be deleted without removing its peers", async (t) => {
  const fixture = await createFixture(t);
  const scope = taskScope(fixture);
  const first = await fixture.artifacts.saveResearchArtifact(scope, { run: 1 });
  const second = await fixture.artifacts.saveResearchArtifact(scope, { run: 2 });

  await fixture.artifacts.deleteResearchArtifact(scope, first.id);

  assert.deepEqual(await fixture.artifacts.listResearchArtifacts(scope), [second]);
  await assert.rejects(
    fixture.artifacts.getResearchArtifact(scope, first.id),
    (error: unknown) =>
      error instanceof ArtifactNotFoundError &&
      error.code === "ARTIFACT_NOT_FOUND",
  );
});

test("Coder work records append and reject completed or archived writes", async (t) => {
  const fixture = await createFixture(t);
  const scope = taskScope(fixture);
  const first = await fixture.artifacts.saveCoderWorkRecord(scope, { run: 1 });
  const second = await fixture.artifacts.saveCoderWorkRecord(scope, { run: 2 });
  assert.notEqual(first.id, second.id);
  assert.equal((await fixture.artifacts.listCoderWorkRecords(scope)).length, 2);

  await fixture.tasks.markCompleted(fixture.project.id, fixture.task.id);
  await assert.rejects(
    fixture.artifacts.saveCoderWorkRecord(scope, { run: 3 }),
    TaskCompletedError,
  );
  await fixture.tasks.archive(fixture.project.id, fixture.task.id);
  await assert.rejects(
    fixture.artifacts.saveCoderWorkRecord(scope, { run: 4 }),
    TaskArchivedError,
  );
});

test("Reviewer reports append without changing task status", async (t) => {
  const fixture = await createFixture(t);
  const scope = taskScope(fixture);
  const first = await fixture.artifacts.saveReviewerReport(
    scope,
    {
      status: "FAIL",
      warnings: [],
      failureOrigin: "implementation",
    },
    { decision: "revise" },
  );
  const second = await fixture.artifacts.saveReviewerReport(
    scope,
    { status: "PASS", warnings: [] },
    { decision: "accept" },
  );

  assert.notEqual(first.id, second.id);
  assert.deepEqual(first.review, {
    status: "FAIL",
    warnings: [],
    failureOrigin: "implementation",
  });
  assert.deepEqual(second.review, { status: "PASS", warnings: [] });
  const taskDirectory = await fixture.tasks.getStateDirectory(
    fixture.project.id,
    fixture.task.id,
  );
  const persisted = await fixture.store.readJson<Record<string, unknown>>(
    `${taskDirectory}/artifacts/reviewer/${first.id}.json`,
  );
  assert.equal(persisted?.version, 2);
  assert.deepEqual(persisted?.review, first.review);
  assert.deepEqual(persisted?.payload, { decision: "revise" });
  assert.equal((await fixture.artifacts.listReviewerReports(scope)).length, 2);
  assert.equal(
    (await fixture.tasks.get(fixture.project.id, fixture.task.id)).status,
    "active",
  );
});

test("Reviewer writes reject completed and archived tasks", async (t) => {
  const fixture = await createFixture(t);
  const scope = taskScope(fixture);
  await fixture.tasks.markCompleted(fixture.project.id, fixture.task.id);
  await assert.rejects(
    fixture.artifacts.saveReviewerReport(
      scope,
      { status: "PASS", warnings: [] },
      { decision: "late" },
    ),
    TaskCompletedError,
  );
  await fixture.tasks.archive(fixture.project.id, fixture.task.id);
  await assert.rejects(
    fixture.artifacts.saveReviewerReport(
      scope,
      { status: "PASS", warnings: [] },
      { decision: "later" },
    ),
    TaskArchivedError,
  );
});

test("task artifacts remain readable with stable scope metadata after archive", async (t) => {
  const fixture = await createFixture(t);
  const scope = taskScope(fixture);
  await fixture.artifacts.saveQuestionerContext(scope, { raw: "Q&A" });
  const research = await fixture.artifacts.saveResearchArtifact(scope, {
    evidence: true,
  });
  const coder = await fixture.artifacts.saveCoderWorkRecord(scope, {
    files: ["src/a.ts"],
  });
  const reviewer = await fixture.artifacts.saveReviewerReport(
    scope,
    {
      status: "FAIL",
      warnings: ["Archived evidence remains inspectable."],
      failureOrigin: "mixed",
    },
    { approved: false },
  );
  await fixture.tasks.markCompleted(fixture.project.id, fixture.task.id);
  await fixture.tasks.archive(fixture.project.id, fixture.task.id);

  const restarted = newServices(fixture).artifacts;
  assert.deepEqual(
    (await restarted.getQuestionerContext(scope)).context?.scope,
    scope,
  );
  assert.deepEqual(await restarted.getResearchArtifact(scope, research.id), research);
  assert.deepEqual(await restarted.getCoderWorkRecord(scope, coder.id), coder);
  assert.deepEqual(await restarted.getReviewerReport(scope, reviewer.id), reviewer);
  assert.deepEqual(
    (await restarted.getReviewerReport(scope, reviewer.id)).review,
    {
      status: "FAIL",
      warnings: ["Archived evidence remains inspectable."],
      failureOrigin: "mixed",
    },
  );
});

test("legacy Reviewer artifacts without lifecycle metadata are rejected rather than inferred", async (t) => {
  const fixture = await createFixture(t);
  const scope = taskScope(fixture);
  const artifactId = "artifact_00000000000000000000000000000000" as ArtifactId;
  const taskDirectory = await fixture.tasks.getStateDirectory(
    fixture.project.id,
    fixture.task.id,
  );
  await fixture.store.writeJson(
    `${taskDirectory}/artifacts/reviewer/${artifactId}.json`,
    {
      version: 1,
      id: artifactId,
      category: "reviewer",
      scope,
      createdAt: new Date().toISOString(),
      payload: { legacy: true },
    },
  );

  await assert.rejects(
    fixture.artifacts.getReviewerReport(scope, artifactId),
    InvalidArtifactError,
  );
});

test("generic artifact persistence cannot create Reviewer lifecycle evidence", async (t) => {
  const fixture = await createFixture(t);

  await assert.rejects(
    fixture.artifacts.saveRunArtifact(
      "reviewer",
      taskScope(fixture),
      { status: "forged" },
    ),
    InvalidArtifactError,
  );
  assert.deepEqual(
    await fixture.artifacts.listReviewerReports(taskScope(fixture)),
    [],
  );
});

test("artifact writes never create canonical memory Markdown", async (t) => {
  const fixture = await createFixture(t);
  const project = projectScope(fixture);
  const task = taskScope(fixture);
  await Promise.all([
    fixture.artifacts.saveResearchArtifact(project, { project: true }),
    fixture.artifacts.saveResearchArtifact(task, { task: true }),
    fixture.artifacts.saveQuestionerContext(task, { questioner: true }),
    fixture.artifacts.saveCoderWorkRecord(task, { coder: true }),
    fixture.artifacts.saveReviewerReport(
      task,
      { status: "PASS", warnings: [] },
      { reviewer: true },
    ),
  ]);
  const projectDirectory = projectStateDirectory(fixture.project);
  const taskMemoryDirectory = `${projectDirectory}/memory/tasks/${fixture.task.id}_${fixture.task.slug}`;

  assert.equal(
    await fixture.store.exists(`${projectDirectory}/memory/PROJECT.md`),
    false,
  );
  assert.equal(
    await fixture.store.exists(`${taskMemoryDirectory}/MEMORY.md`),
    false,
  );
});

test("artifact writes never touch the user source repository", async (t) => {
  const fixture = await createFixture(t);
  const before = await readdir(fixture.sourcePath);
  await Promise.all([
    fixture.artifacts.saveResearchArtifact(projectScope(fixture), {
      project: true,
    }),
    fixture.artifacts.saveResearchArtifact(taskScope(fixture), { task: true }),
    fixture.artifacts.saveCoderWorkRecord(taskScope(fixture), { run: true }),
  ]);

  assert.deepEqual(await readdir(fixture.sourcePath), before);
});

test("concurrent append artifacts use distinct exclusive records", async (t) => {
  const fixture = await createFixture(t);
  const scope = taskScope(fixture);
  const otherManager = newServices(fixture).artifacts;
  const saved = await Promise.all(
    Array.from({ length: 40 }, (_, index) =>
      (index % 2 === 0 ? fixture.artifacts : otherManager).saveResearchArtifact(
        scope,
        { index },
      ),
    ),
  );
  const listed = await newServices(fixture).artifacts.listResearchArtifacts(
    scope,
  );

  assert.equal(new Set(saved.map(({ id }) => id)).size, 40);
  assert.equal(listed.length, 40);
  assert.deepEqual(
    new Set(listed.map(({ payload }) => payload.index)),
    new Set(Array.from({ length: 40 }, (_, index) => index)),
  );
});

test("concurrent Questioner replacements expose only complete contexts", async (t) => {
  const fixture = await createFixture(t);
  const scope = taskScope(fixture);
  await fixture.artifacts.saveQuestionerContext(scope, { revision: -1 });
  const managers = [fixture.artifacts, newServices(fixture).artifacts];
  const replacements = Array.from({ length: 30 }, (_, revision) =>
    (managers[revision % managers.length] as ArtifactManager).saveQuestionerContext(
      scope,
      { revision, body: "x".repeat(2_000) },
    ),
  );
  const reads = Array.from({ length: 30 }, (_, index) =>
    (managers[index % managers.length] as ArtifactManager).getQuestionerContext(
      scope,
    ),
  );

  const readResults = await Promise.all(reads);
  await Promise.all(replacements);
  for (const result of readResults) {
    assert.equal(result.hasContext, true);
    assert.equal(typeof result.context?.payload.revision, "number");
  }
  assert.equal(
    typeof (await fixture.artifacts.getQuestionerContext(scope)).context?.payload
      .revision,
    "number",
  );
});

test("invalid category and scope combinations return a stable error", async (t) => {
  const fixture = await createFixture(t);

  await assert.rejects(
    fixture.artifacts.saveRunArtifact("coder", projectScope(fixture), {}),
    (error: unknown) =>
      error instanceof InvalidArtifactScopeError &&
      error.code === "INVALID_ARTIFACT_SCOPE",
  );
  await assert.rejects(
    fixture.artifacts.getQuestionerContext(
      projectScope(fixture) as unknown as TaskArtifactScope,
    ),
    InvalidArtifactScopeError,
  );
  await assert.rejects(
    fixture.artifacts.saveQuestionerContext(
      projectScope(fixture) as unknown as TaskArtifactScope,
      {},
    ),
    InvalidArtifactScopeError,
  );
});

test("unsafe JSON payloads return the stable payload error", async (t) => {
  const fixture = await createFixture(t);
  const scope = taskScope(fixture);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const invalidPayloads: ArtifactPayload[] = [
    { missing: undefined },
    { large: 1n },
    { number: Number.NaN },
    cyclic,
    { date: new Date() },
  ];

  for (const payload of invalidPayloads) {
    await assert.rejects(
      fixture.artifacts.saveResearchArtifact(scope, payload),
      (error: unknown) =>
        error instanceof InvalidArtifactPayloadError &&
        error.code === "INVALID_ARTIFACT_PAYLOAD",
    );
  }
});

test("malformed committed artifacts return the stable artifact error", async (t) => {
  const fixture = await createFixture(t);
  const directory = `${await fixture.tasks.getStateDirectory(fixture.project.id, fixture.task.id)}/artifacts/researcher`;
  await fixture.store.writeText(
    `${directory}/artifact_00000000000000000000000000000000.json`,
    "{ malformed",
  );

  await assert.rejects(
    fixture.artifacts.listResearchArtifacts(taskScope(fixture)),
    (error: unknown) =>
      error instanceof InvalidArtifactError && error.code === "INVALID_ARTIFACT",
  );
});

test("missing immutable artifacts return the stable not-found error", async (t) => {
  const fixture = await createFixture(t);

  await assert.rejects(
    fixture.artifacts.getResearchArtifact(
      taskScope(fixture),
      "artifact_00000000000000000000000000000000" as ArtifactId,
    ),
    (error: unknown) =>
      error instanceof ArtifactNotFoundError &&
      error.code === "ARTIFACT_NOT_FOUND",
  );
});
