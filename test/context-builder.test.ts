import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { AgentBehaviorManager } from "../src/core/agent-behavior-manager.js";
import { ArtifactManager } from "../src/core/artifact-manager.js";
import { ContextBuilder } from "../src/core/context-builder.js";
import { MemoryManager } from "../src/core/memory-manager.js";
import { PlanManager } from "../src/core/plan-manager.js";
import { ProjectManager } from "../src/core/project-manager.js";
import { RuleResolver } from "../src/core/rule-resolver.js";
import { SessionManager } from "../src/core/session-manager.js";
import { TaskManager } from "../src/core/task-manager.js";
import type { ArtifactId, TaskArtifactScope } from "../src/domain/artifact.js";
import {
  ArtifactNotFoundError,
  InvalidAgentContextError,
  InvalidAgentHandoffError,
  NoProjectBoundError,
  NoTaskBoundError,
  TaskCompletedError,
} from "../src/domain/errors.js";
import type { Project } from "../src/domain/project.js";
import type { Task } from "../src/domain/task.js";
import { StateStore } from "../src/infrastructure/state-store.js";

interface Fixture {
  readonly root: string;
  readonly stateRoot: string;
  readonly homeDirectory: string;
  readonly sourceRoot: string;
  readonly store: StateStore;
  readonly projects: ProjectManager;
  readonly sessions: SessionManager;
  readonly tasks: TaskManager;
  readonly memory: MemoryManager;
  readonly plans: PlanManager;
  readonly artifacts: ArtifactManager;
  readonly rules: RuleResolver;
  readonly behavior: AgentBehaviorManager;
  readonly builder: ContextBuilder;
  readonly projectA: Project;
  readonly projectB: Project;
  readonly projectC: Project;
  readonly taskA: Task;
  readonly otherTaskA: Task;
}

async function createFixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-context-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateRoot = join(root, "state-root");
  const homeDirectory = join(root, "home");
  const sourceRoot = join(root, "sources");
  await Promise.all([
    mkdir(homeDirectory, { recursive: true }),
    mkdir(sourceRoot, { recursive: true }),
  ]);
  const store = new StateStore(stateRoot);
  const projects = new ProjectManager(store, { homeDirectory });
  const sessions = new SessionManager(store);
  const tasks = new TaskManager(store, projects);
  const paths = ["a", "b", "c"].map((name) => join(sourceRoot, name));
  await Promise.all(paths.map((path) => mkdir(path)));
  const [pathA, pathB, pathC] = paths as [string, string, string];
  const [projectA, projectB, projectC] = await Promise.all([
    projects.create("Context A", pathA),
    projects.create("Context B", pathB),
    projects.create("Context C", pathC),
  ]);
  const [taskA, otherTaskA] = await Promise.all([
    tasks.create(projectA.id, "Primary context task"),
    tasks.create(projectA.id, "Other context task"),
  ]);
  const memory = new MemoryManager(store, projects, tasks);
  return {
    root,
    stateRoot,
    homeDirectory,
    sourceRoot,
    store,
    projects,
    sessions,
    tasks,
    memory,
    plans: new PlanManager(store, tasks),
    artifacts: new ArtifactManager(store, projects, tasks),
    rules: new RuleResolver(store, projects, tasks),
    behavior: new AgentBehaviorManager(store),
    builder: new ContextBuilder({ synaphexRoot: stateRoot, homeDirectory }),
    projectA,
    projectB,
    projectC,
    taskA,
    otherTaskA,
  };
}

function taskScope(fixture: Fixture, task = fixture.taskA): TaskArtifactScope {
  return {
    kind: "task",
    projectId: fixture.projectA.id,
    taskId: task.id,
  };
}

async function bindProject(
  fixture: Fixture,
  sessionId: string,
): Promise<void> {
  await fixture.sessions.bindProject(sessionId, fixture.projectA.id);
}

async function bindTask(fixture: Fixture, sessionId: string): Promise<void> {
  await bindProject(fixture, sessionId);
  await fixture.sessions.bindTask(sessionId, fixture.taskA.id);
}

test("QUESTIONER receives required task context without Coder or Reviewer evidence", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "questioner-context";
  await bindTask(fixture, sessionId);
  await fixture.artifacts.saveQuestionerContext(taskScope(fixture), {
    answers: ["bounded"],
  });
  await fixture.artifacts.saveCoderWorkRecord(taskScope(fixture), { run: 1 });
  await fixture.artifacts.saveReviewerReport(
    taskScope(fixture),
    { status: "PASS", warnings: [] },
    { status: "prior" },
  );

  const context = await fixture.builder.build({
    sessionId,
    agent: "questioner",
    instruction: "Clarify the requested behavior.",
  });

  assert.equal(context.project.id, fixture.projectA.id);
  assert.equal(context.task?.id, fixture.taskA.id);
  assert.equal(context.task?.description, "Primary context task");
  assert.equal(context.artifacts.questionerContext?.hasContext, true);
  assert.deepEqual(context.artifacts.coderWorkRecords, []);
  assert.equal(context.artifacts.latestReviewerReport, null);
  assert.equal(context.behavior, null);
  assert.equal(context.instruction, "Clarify the requested behavior.");
});

test("RESEARCHER and EXAMINER support project-only context", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "project-only-context";
  await bindProject(fixture, sessionId);
  await fixture.behavior.replaceOutputFields("researcher", [
    "custom_findings",
    "source_map",
  ]);

  const researcher = await fixture.builder.build({
    sessionId,
    agent: "researcher",
  });
  const examiner = await fixture.builder.build({
    sessionId,
    agent: "examiner",
  });

  assert.equal(researcher.task, null);
  assert.deepEqual(
    researcher.behavior?.outputFields,
    ["custom_findings", "source_map"],
  );
  assert.equal(examiner.task, null);
  assert.equal(examiner.behavior, null);
});

test("task-required agents reject project-only context and every role rejects no project", async (t) => {
  const fixture = await createFixture(t);
  const projectSession = "task-required";
  await bindProject(fixture, projectSession);

  for (const agent of ["questioner", "planner", "coder", "reviewer"] as const) {
    await assert.rejects(
      fixture.builder.build({ sessionId: projectSession, agent }),
      NoTaskBoundError,
    );
  }
  await assert.rejects(
    fixture.builder.build({ sessionId: "unbound", agent: "researcher" }),
    NoProjectBoundError,
  );
});

test("empty direct instructions return the stable context error", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "invalid-instruction";
  await bindProject(fixture, sessionId);

  await assert.rejects(
    fixture.builder.build({
      sessionId,
      agent: "researcher",
      instruction: "   ",
    }),
    (error: unknown) =>
      error instanceof InvalidAgentContextError &&
      error.code === "INVALID_AGENT_CONTEXT",
  );
});

test("completed bound tasks remain valid only for RESEARCHER and EXAMINER", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "completed-context";
  await bindTask(fixture, sessionId);
  await fixture.tasks.markCompleted(fixture.projectA.id, fixture.taskA.id);

  assert.equal(
    (await fixture.builder.build({ sessionId, agent: "researcher" })).task
      ?.status,
    "completed",
  );
  assert.equal(
    (await fixture.builder.build({ sessionId, agent: "examiner" })).task?.status,
    "completed",
  );
  for (const agent of ["questioner", "planner", "coder", "reviewer"] as const) {
    await assert.rejects(
      fixture.builder.build({ sessionId, agent }),
      TaskCompletedError,
    );
  }
});

test("canonical memory represents content and no-content states explicitly", async (t) => {
  const fixture = await createFixture(t);
  const projectSession = "memory-project";
  await bindProject(fixture, projectSession);
  const absent = await fixture.builder.build({
    sessionId: projectSession,
    agent: "researcher",
  });
  assert.deepEqual(absent.memory.project, {
    scope: { kind: "project", projectId: fixture.projectA.id },
    hasContent: false,
    content: null,
  });

  await fixture.store.writeText(
    await fixture.memory.resolveCanonicalSourceLocation({
      kind: "project",
      projectId: fixture.projectA.id,
    }),
    "# Project memory\n",
  );
  await fixture.store.writeText(
    await fixture.memory.resolveCanonicalSourceLocation({
      kind: "task",
      projectId: fixture.projectA.id,
      taskId: fixture.taskA.id,
    }),
    "# Task memory\n",
  );
  const taskSession = "memory-task";
  await bindTask(fixture, taskSession);
  const present = await fixture.builder.build({
    sessionId: taskSession,
    agent: "coder",
  });
  assert.equal(present.memory.project.content, "# Project memory\n");
  assert.equal(present.memory.task?.content, "# Task memory\n");
});

test("context includes direct loaded memory with source identity but not transitive loads", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "direct-memory";
  await bindTask(fixture, sessionId);
  await fixture.memory.load(
    {
      kind: "task",
      projectId: fixture.projectA.id,
      taskId: fixture.taskA.id,
    },
    {
      kind: "project",
      projectId: fixture.projectB.id,
      projectName: fixture.projectB.name,
    },
  );
  await fixture.memory.load(
    { kind: "project", projectId: fixture.projectB.id },
    {
      kind: "project",
      projectId: fixture.projectC.id,
      projectName: fixture.projectC.name,
    },
  );
  await fixture.store.writeText(
    await fixture.memory.resolveCanonicalSourceLocation({
      kind: "project",
      projectId: fixture.projectB.id,
    }),
    "B memory",
  );

  const context = await fixture.builder.build({ sessionId, agent: "coder" });

  assert.equal(context.memory.directlyLoaded.length, 1);
  assert.equal(
    context.memory.directlyLoaded[0]?.reference.source.projectId,
    fixture.projectB.id,
  );
  assert.equal(
    context.memory.directlyLoaded[0]?.reference.source.projectName,
    fixture.projectB.name,
  );
  assert.equal(context.memory.directlyLoaded[0]?.memory.content, "B memory");
  assert.equal(
    context.memory.directlyLoaded.some(
      ({ reference }) => reference.source.projectId === fixture.projectC.id,
    ),
    false,
  );
});

test("context rules contain only target outgoing calls plus effective actions and sources", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "rule-context";
  await bindTask(fixture, sessionId);
  const ruleContext = {
    projectId: fixture.projectA.id,
    taskId: fixture.taskA.id,
  };
  await fixture.rules.setRule(
    "task",
    { kind: "agent_call", caller: "coder", target: "researcher" },
    "allow",
    ruleContext,
  );
  await fixture.rules.setRule(
    "task",
    { kind: "agent_call", caller: "reviewer", target: "coder" },
    "allow",
    ruleContext,
  );
  await fixture.rules.setRule(
    "task",
    { kind: "action", action: "deploy_preview" },
    "deny",
    ruleContext,
  );

  const context = await fixture.builder.build({ sessionId, agent: "coder" });

  assert.equal(context.rules.outgoingAgentCalls.length, 6);
  assert.ok(
    context.rules.outgoingAgentCalls.every(
      ({ key }) => key.kind === "agent_call" && key.caller === "coder",
    ),
  );
  assert.equal(
    context.rules.outgoingAgentCalls.find(
      ({ key }) => key.kind === "agent_call" && key.target === "researcher",
    )?.source,
    "task",
  );
  assert.equal(
    context.rules.outgoingAgentCalls.find(
      ({ key }) => key.kind === "agent_call" && key.target === "examiner",
    )?.source,
    "default_deny",
  );
  assert.equal(
    context.rules.actions.find(
      ({ key }) => key.kind === "action" && key.action === "deploy_preview",
    )?.source,
    "task",
  );
  assert.equal(
    context.rules.actions.find(
      ({ key }) => key.kind === "action" && key.action === "network",
    )?.source,
    "global",
  );
  assert.deepEqual(context.roleContract.forbiddenOutgoingTargets, ["reviewer"]);
  assert.equal(
    context.roleContract.conditionalOutgoingContracts[0]?.target,
    "planner",
  );
});

test("PLANNER, CODER, and REVIEWER receive only their selected plan and artifact evidence", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "workflow-context";
  await bindTask(fixture, sessionId);
  const scope = taskScope(fixture);
  await fixture.plans.saveDraft(fixture.taskA.id, "accepted-v1");
  await fixture.plans.acceptDraft(fixture.taskA.id);
  await fixture.plans.saveDraft(fixture.taskA.id, "accepted-v2");
  await fixture.plans.acceptDraft(fixture.taskA.id);
  await fixture.plans.saveDraft(fixture.taskA.id, "pending-v3");
  await fixture.artifacts.saveQuestionerContext(scope, { q: true });
  const research = await fixture.artifacts.saveResearchArtifact(scope, {
    evidence: true,
  });
  const coderOne = await fixture.artifacts.saveCoderWorkRecord(scope, { run: 1 });
  const coderTwo = await fixture.artifacts.saveCoderWorkRecord(scope, { run: 2 });
  await fixture.artifacts.saveReviewerReport(
    scope,
    { status: "PASS", warnings: [] },
    { review: 1 },
  );
  await fixture.artifacts.saveReviewerReport(
    scope,
    {
      status: "FAIL",
      warnings: ["Plan and implementation disagree."],
      failureOrigin: "mixed",
    },
    { review: 2 },
  );
  const expectedLatest = (await fixture.artifacts.listReviewerReports(scope)).at(-1);
  await fixture.behavior.replaceOutputFields("coder", ["files", "tests"]);
  await fixture.behavior.replaceOutputFields("reviewer", ["decision"]);

  const planner = await fixture.builder.build({ sessionId, agent: "planner" });
  const coder = await fixture.builder.build({ sessionId, agent: "coder" });
  const reviewer = await fixture.builder.build({ sessionId, agent: "reviewer" });

  assert.equal(planner.plan?.current?.content, "accepted-v2");
  assert.equal(planner.plan?.draft?.content, "pending-v3");
  assert.equal(planner.artifacts.questionerContext?.hasContext, true);
  assert.deepEqual(planner.artifacts.research, [research]);
  assert.equal(planner.artifacts.latestReviewerReport?.id, expectedLatest?.id);
  assert.deepEqual(planner.artifacts.latestReviewerReport?.review, {
    status: "FAIL",
    warnings: ["Plan and implementation disagree."],
    failureOrigin: "mixed",
  });
  assert.deepEqual(planner.artifacts.coderWorkRecords, []);

  assert.equal(coder.plan?.current?.content, "accepted-v2");
  assert.equal(coder.plan?.hasPendingDraft, true);
  assert.equal(coder.plan?.draft, null);
  assert.equal(coder.artifacts.questionerContext, null);
  assert.deepEqual(coder.artifacts.latestReviewerReport?.review, {
    status: "FAIL",
    warnings: ["Plan and implementation disagree."],
    failureOrigin: "mixed",
  });
  assert.deepEqual(coder.behavior?.outputFields, ["files", "tests"]);
  assert.equal(JSON.stringify(coder).includes("accepted-v1"), false);

  assert.deepEqual(
    new Set(reviewer.artifacts.coderWorkRecords.map(({ id }) => id)),
    new Set([coderOne.id, coderTwo.id]),
  );
  assert.equal(reviewer.artifacts.latestReviewerReport?.id, expectedLatest?.id);
  assert.deepEqual(reviewer.artifacts.latestReviewerReport?.review, {
    status: "FAIL",
    warnings: ["Plan and implementation disagree."],
    failureOrigin: "mixed",
  });
  assert.deepEqual(reviewer.artifacts.research, [research]);
  assert.deepEqual(reviewer.behavior?.outputFields, ["decision"]);
});

test("explicit handoff artifact references resolve within accepted project/task scope", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "handoff-artifact";
  await bindTask(fixture, sessionId);
  const projectArtifact = await fixture.artifacts.saveResearchArtifact(
    { kind: "project", projectId: fixture.projectA.id },
    { project: true },
  );

  const context = await fixture.builder.build({
    sessionId,
    agent: "examiner",
    handoff: {
      caller: "researcher",
      target: "examiner",
      purpose: "memory_update",
      summary: "Distill this project research.",
      artifactRefs: [projectArtifact.id],
    },
  });

  assert.deepEqual(context.artifacts.explicitlyReferenced, [projectArtifact]);
  assert.equal(context.artifacts.research.length, 0);
});

test("handoff rejects malformed, missing, cross-project, and other-task artifact references", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "invalid-handoff-artifact";
  await bindTask(fixture, sessionId);
  const otherTaskArtifact = await fixture.artifacts.saveResearchArtifact(
    taskScope(fixture, fixture.otherTaskA),
    { otherTask: true },
  );
  const crossProject = await fixture.artifacts.saveResearchArtifact(
    { kind: "project", projectId: fixture.projectB.id },
    { otherProject: true },
  );
  const handoff = (artifactRefs: readonly ArtifactId[]) => ({
    caller: "researcher" as const,
    target: "examiner" as const,
    purpose: "memory_update" as const,
    summary: "Scoped evidence.",
    artifactRefs,
  });

  // A canonical-shaped id that was never persisted: shape validation cannot
  // catch this, so context building is where it must fail -- before any
  // provider process is constructed for the helper.
  await assert.rejects(
    fixture.builder.build({
      sessionId,
      agent: "examiner",
      handoff: handoff([
        `artifact_${"c7e72d96c96e46719959066f979f9a69"}` as ArtifactId,
      ]),
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "ARTIFACT_NOT_FOUND",
  );

  await assert.rejects(
    fixture.builder.build({
      sessionId,
      agent: "examiner",
      handoff: handoff([otherTaskArtifact.id]),
    }),
    InvalidAgentHandoffError,
  );
  await assert.rejects(
    fixture.builder.build({
      sessionId,
      agent: "examiner",
      handoff: handoff([crossProject.id]),
    }),
    InvalidAgentHandoffError,
  );
  await assert.rejects(
    fixture.builder.build({
      sessionId,
      agent: "examiner",
      handoff: handoff([
        "artifact_00000000000000000000000000000000" as ArtifactId,
      ]),
    }),
    ArtifactNotFoundError,
  );
  await assert.rejects(
    fixture.builder.build({
      sessionId,
      agent: "examiner",
      handoff: handoff(["not-an-artifact" as ArtifactId]),
    }),
    InvalidAgentHandoffError,
  );
});

test("ContextBuilder reads do not mutate Synaphex state or user source", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "read-only-context";
  await bindTask(fixture, sessionId);
  await writeFile(join(fixture.sourceRoot, "a", "sentinel.txt"), "source", "utf8");
  assert.equal(await fixture.store.exists("agent_behavior.jsonc"), false);
  const beforeState = await snapshotFiles(fixture.stateRoot);
  const beforeSource = await snapshotFiles(fixture.sourceRoot);

  await fixture.builder.build({ sessionId, agent: "researcher" });

  assert.deepEqual(await snapshotFiles(fixture.stateRoot), beforeState);
  assert.deepEqual(await snapshotFiles(fixture.sourceRoot), beforeSource);
  assert.equal(await fixture.store.exists("agent_behavior.jsonc"), false);
});

async function snapshotFiles(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  await walk(root, "", snapshot);
  return snapshot;
}

async function walk(
  root: string,
  relative: string,
  snapshot: Record<string, string>,
): Promise<void> {
  const directory = join(root, relative);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const childRelative = relative === "" ? entry.name : join(relative, entry.name);
    if (entry.isDirectory()) {
      await walk(root, childRelative, snapshot);
    } else if (entry.isFile()) {
      snapshot[childRelative] = await readFile(join(root, childRelative), "utf8");
    }
  }
}
