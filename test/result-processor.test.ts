import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { AgentBehaviorManager } from "../src/core/agent-behavior-manager.js";
import { ArtifactManager } from "../src/core/artifact-manager.js";
import { MemoryManager } from "../src/core/memory-manager.js";
import { PlanManager } from "../src/core/plan-manager.js";
import { ProjectManager } from "../src/core/project-manager.js";
import { ResultProcessor } from "../src/core/result-processor.js";
import { SessionManager } from "../src/core/session-manager.js";
import { TaskManager } from "../src/core/task-manager.js";
import type { TaskArtifactScope } from "../src/domain/artifact.js";
import {
  InvalidAgentResultError,
  TaskArchivedError,
  TaskCompletedError,
} from "../src/domain/errors.js";
import type { MemoryScope, MemorySourceIdentity } from "../src/domain/memory.js";
import type { Project } from "../src/domain/project.js";
import type { Task } from "../src/domain/task.js";
import { StateStore } from "../src/infrastructure/state-store.js";

interface Fixture {
  readonly root: string;
  readonly stateRoot: string;
  readonly homeDirectory: string;
  readonly store: StateStore;
  readonly projects: ProjectManager;
  readonly sessions: SessionManager;
  readonly tasks: TaskManager;
  readonly artifacts: ArtifactManager;
  readonly memory: MemoryManager;
  readonly plans: PlanManager;
  readonly behavior: AgentBehaviorManager;
  readonly processor: ResultProcessor;
  readonly projectA: Project;
  readonly projectB: Project;
  readonly taskA: Task;
  readonly otherTaskA: Task;
  readonly taskB: Task;
}

async function createFixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-result-processor-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateRoot = join(root, "state-root");
  const homeDirectory = join(root, "home");
  const sourcesDirectory = join(root, "sources");
  await Promise.all([
    mkdir(homeDirectory, { recursive: true }),
    mkdir(sourcesDirectory, { recursive: true }),
  ]);
  const sourceA = join(sourcesDirectory, "a");
  const sourceB = join(sourcesDirectory, "b");
  await Promise.all([mkdir(sourceA), mkdir(sourceB)]);

  const store = new StateStore(stateRoot);
  const projects = new ProjectManager(store, { homeDirectory });
  const sessions = new SessionManager(store);
  const tasks = new TaskManager(store, projects);
  const [projectA, projectB] = await Promise.all([
    projects.create("Processor A", sourceA),
    projects.create("Processor B", sourceB),
  ]);
  const [taskA, otherTaskA, taskB] = await Promise.all([
    tasks.create(projectA.id, "Primary processing task"),
    tasks.create(projectA.id, "Other processing task"),
    tasks.create(projectB.id, "Foreign processing task"),
  ]);
  const artifacts = new ArtifactManager(store, projects, tasks);
  const memory = new MemoryManager(store, projects, tasks);
  const plans = new PlanManager(store, tasks);
  const behavior = new AgentBehaviorManager(store);
  return {
    root,
    stateRoot,
    homeDirectory,
    store,
    projects,
    sessions,
    tasks,
    artifacts,
    memory,
    plans,
    behavior,
    processor: new ResultProcessor({ synaphexRoot: stateRoot, homeDirectory }),
    projectA,
    projectB,
    taskA,
    otherTaskA,
    taskB,
  };
}

function newManagers(fixture: Fixture): {
  readonly projects: ProjectManager;
  readonly tasks: TaskManager;
  readonly sessions: SessionManager;
  readonly artifacts: ArtifactManager;
  readonly memory: MemoryManager;
  readonly plans: PlanManager;
} {
  const store = new StateStore(fixture.stateRoot);
  const projects = new ProjectManager(store, {
    homeDirectory: fixture.homeDirectory,
  });
  const tasks = new TaskManager(store, projects);
  return {
    projects,
    tasks,
    sessions: new SessionManager(store),
    artifacts: new ArtifactManager(store, projects, tasks),
    memory: new MemoryManager(store, projects, tasks),
    plans: new PlanManager(store, tasks),
  };
}

function taskScope(fixture: Fixture): TaskArtifactScope {
  return {
    kind: "task",
    projectId: fixture.projectA.id,
    taskId: fixture.taskA.id,
  };
}

function projectMemoryScope(fixture: Fixture, project = fixture.projectA): MemoryScope {
  return { kind: "project", projectId: project.id };
}

function taskMemoryScope(fixture: Fixture, task = fixture.taskA): MemoryScope {
  return { kind: "task", projectId: task.projectId, taskId: task.id };
}

async function bindProject(fixture: Fixture, sessionId: string): Promise<void> {
  await fixture.sessions.bindProject(sessionId, fixture.projectA.id);
}

async function bindTask(fixture: Fixture, sessionId: string): Promise<void> {
  await bindProject(fixture, sessionId);
  await fixture.sessions.bindTask(sessionId, fixture.taskA.id);
}

async function seedMemory(
  fixture: Fixture,
  scope: MemoryScope,
  content: string,
): Promise<void> {
  await fixture.store.writeText(
    await fixture.memory.resolveCanonicalSourceLocation(scope),
    content,
  );
}

test("QUESTIONER pending and complete results persist replacement working context", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "questioner-context";
  await bindTask(fixture, sessionId);

  const pending = await fixture.processor.process({
    sessionId,
    expectedAgent: "questioner",
    result: {
      agent: "questioner",
      outcome: "needs_user",
      summary: "One answer remains.",
      state: "pending_question",
      question: "Which retention policy applies?",
      workingContext: { answers: ["first"] },
    },
  });
  assert.deepEqual(pending.stateEffects, [
    { kind: "questioner_context_saved", scope: taskScope(fixture) },
  ]);
  assert.equal(pending.state, "pending_question");
  assert.equal(pending.question, "Which retention policy applies?");

  await fixture.processor.process({
    sessionId,
    expectedAgent: "questioner",
    result: {
      agent: "questioner",
      outcome: "success",
      summary: "Context is complete.",
      state: "context_complete",
      workingContext: { answers: ["first", "second"] },
    },
  });
  const persisted = await newManagers(fixture).artifacts.getQuestionerContext(
    taskScope(fixture),
  );
  assert.deepEqual(persisted.context?.payload, {
    answers: ["first", "second"],
  });
  assert.equal((await fixture.tasks.get(fixture.projectA.id, fixture.taskA.id)).status, "active");
});

test("QUESTIONER without context performs no mutation and returns a helper request without execution", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "questioner-request";
  await bindTask(fixture, sessionId);

  const processed = await fixture.processor.process({
    sessionId,
    expectedAgent: "questioner",
    result: {
      agent: "questioner",
      outcome: "success",
      summary: "Context is complete.",
      state: "context_complete",
      requestedCalls: [
        {
          target: "examiner",
          purpose: "memory_update",
          handoff: {
            caller: "questioner",
            target: "examiner",
            purpose: "memory_update",
            summary: "Distill the collected context.",
          },
        },
      ],
    },
  });

  assert.equal(processed.requestedCalls[0]?.target, "examiner");
  assert.deepEqual(processed.stateEffects, []);
  assert.equal(
    (await fixture.artifacts.getQuestionerContext(taskScope(fixture))).hasContext,
    false,
  );
  assert.equal((await fixture.memory.getTaskCanonicalMemory(fixture.projectA.id, fixture.taskA.id)).hasContent, false);
});

test("completed tasks reject QUESTIONER processing before artifact mutation", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "questioner-completed";
  await bindTask(fixture, sessionId);
  await fixture.tasks.markCompleted(fixture.projectA.id, fixture.taskA.id);

  await assert.rejects(
    fixture.processor.process({
      sessionId,
      expectedAgent: "questioner",
      result: {
        agent: "questioner",
        outcome: "success",
        summary: "Late context.",
        state: "context_complete",
        workingContext: { late: true },
      },
    }),
    TaskCompletedError,
  );
  assert.equal(
    (await fixture.artifacts.getQuestionerContext(taskScope(fixture))).hasContext,
    false,
  );
});

test("RESEARCHER persists project and task artifacts using current session scope", async (t) => {
  const fixture = await createFixture(t);
  const projectSession = "research-project";
  await bindProject(fixture, projectSession);
  const projectResult = await fixture.processor.process({
    sessionId: projectSession,
    expectedAgent: "researcher",
    result: {
      agent: "researcher",
      outcome: "success",
      summary: "Project findings captured.",
      researchArtifact: { findings: ["project"] },
    },
  });
  assert.equal(projectResult.persistedArtifacts[0]?.scope.kind, "project");

  const taskSession = "research-task";
  await bindTask(fixture, taskSession);
  const taskResult = await fixture.processor.process({
    sessionId: taskSession,
    expectedAgent: "researcher",
    result: {
      agent: "researcher",
      outcome: "success",
      summary: "Task findings captured.",
      researchArtifact: { sources: ["task"] },
    },
  });
  assert.deepEqual(taskResult.persistedArtifacts[0]?.scope, taskScope(fixture));
  assert.equal((await newManagers(fixture).artifacts.listResearchArtifacts(taskScope(fixture))).length, 1);
});

test("RESEARCHER supports completed tasks without canonical-memory or lifecycle mutation", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "research-completed";
  await bindTask(fixture, sessionId);
  await seedMemory(fixture, taskMemoryScope(fixture), "original memory");
  await fixture.tasks.markCompleted(fixture.projectA.id, fixture.taskA.id);

  const processed = await fixture.processor.process({
    sessionId,
    expectedAgent: "researcher",
    result: {
      agent: "researcher",
      outcome: "success",
      summary: "Post-completion research.",
      researchArtifact: { evidence: ["additional"] },
      requestedCalls: [
        {
          target: "examiner",
          purpose: "memory_update",
          handoff: {
            caller: "researcher",
            target: "examiner",
            purpose: "memory_update",
            summary: "Consider the additional evidence.",
          },
        },
      ],
    },
  });

  assert.equal(processed.requestedCalls[0]?.target, "examiner");
  assert.equal((await fixture.tasks.get(fixture.projectA.id, fixture.taskA.id)).status, "completed");
  assert.equal((await fixture.memory.getTaskCanonicalMemory(fixture.projectA.id, fixture.taskA.id)).content, "original memory");
});

test("RESEARCHER behavior accepts subsets and rejects unconfigured fields before persistence", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "research-behavior";
  await bindProject(fixture, sessionId);
  await fixture.behavior.replaceOutputFields("researcher", [
    "custom_findings",
    "optional_sources",
  ]);

  await fixture.processor.process({
    sessionId,
    expectedAgent: "researcher",
    result: {
      agent: "researcher",
      outcome: "success",
      summary: "Configured subset.",
      researchArtifact: { custom_findings: ["accepted"] },
    },
  });
  await assert.rejects(
    fixture.processor.process({
      sessionId,
      expectedAgent: "researcher",
      result: {
        agent: "researcher",
        outcome: "success",
        summary: "Unexpected output.",
        researchArtifact: { custom_findings: [], extra: true },
      },
    }),
    (error: unknown) =>
      error instanceof InvalidAgentResultError &&
      error.code === "INVALID_AGENT_RESULT",
  );
  assert.equal(
    (await fixture.artifacts.listResearchArtifacts({
      kind: "project",
      projectId: fixture.projectA.id,
    })).length,
    1,
  );
});

test("archived task state rejects RESEARCHER processing", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "research-archived";
  await bindTask(fixture, sessionId);
  await fixture.tasks.markCompleted(fixture.projectA.id, fixture.taskA.id);
  await fixture.tasks.archive(fixture.projectA.id, fixture.taskA.id);

  await assert.rejects(
    fixture.processor.process({
      sessionId,
      expectedAgent: "researcher",
      result: {
        agent: "researcher",
        outcome: "success",
        summary: "Too late.",
        researchArtifact: { findings: [] },
      },
    }),
    TaskArchivedError,
  );
});

test("EXAMINER replaces and clears current project canonical memory", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "examiner-project";
  await bindProject(fixture, sessionId);

  const replaced = await fixture.processor.process({
    sessionId,
    expectedAgent: "examiner",
    result: {
      agent: "examiner",
      outcome: "success",
      summary: "Replace project memory.",
      memoryIntent: {
        kind: "replace_project",
        projectId: fixture.projectA.id,
        content: "# Canonical project memory\n",
      },
    },
  });
  assert.equal(replaced.stateEffects[0]?.kind, "project_memory_replaced");
  assert.equal((await fixture.memory.getProjectCanonicalMemory(fixture.projectA.id)).content, "# Canonical project memory\n");

  const cleared = await fixture.processor.process({
    sessionId,
    expectedAgent: "examiner",
    result: {
      agent: "examiner",
      outcome: "success",
      summary: "Clear project memory.",
      memoryIntent: { kind: "clear_project", projectId: fixture.projectA.id },
    },
  });
  assert.equal(cleared.stateEffects[0]?.kind, "project_memory_cleared");
  assert.equal((await fixture.memory.getProjectCanonicalMemory(fixture.projectA.id)).hasContent, false);
});

test("task-bound EXAMINER replaces and clears current task memory and may target current project", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "examiner-task";
  await bindTask(fixture, sessionId);

  await fixture.processor.process({
    sessionId,
    expectedAgent: "examiner",
    result: {
      agent: "examiner",
      outcome: "success",
      summary: "Replace task memory.",
      memoryIntent: {
        kind: "replace_task",
        projectId: fixture.projectA.id,
        taskId: fixture.taskA.id,
        content: "task truth",
      },
    },
  });
  assert.equal((await fixture.memory.getTaskCanonicalMemory(fixture.projectA.id, fixture.taskA.id)).content, "task truth");

  await fixture.processor.process({
    sessionId,
    expectedAgent: "examiner",
    result: {
      agent: "examiner",
      outcome: "success",
      summary: "Replace current project memory.",
      memoryIntent: {
        kind: "replace_project",
        projectId: fixture.projectA.id,
        content: "project truth",
      },
    },
  });
  assert.equal((await fixture.memory.getProjectCanonicalMemory(fixture.projectA.id)).content, "project truth");

  await fixture.processor.process({
    sessionId,
    expectedAgent: "examiner",
    result: {
      agent: "examiner",
      outcome: "success",
      summary: "Clear task memory.",
      memoryIntent: {
        kind: "clear_task",
        projectId: fixture.projectA.id,
        taskId: fixture.taskA.id,
      },
    },
  });
  assert.equal((await fixture.memory.getTaskCanonicalMemory(fixture.projectA.id, fixture.taskA.id)).hasContent, false);
});

test("EXAMINER rejects project-only task targets and all foreign scopes before mutation", async (t) => {
  const fixture = await createFixture(t);
  const projectSession = "examiner-project-scope";
  await bindProject(fixture, projectSession);
  await seedMemory(fixture, projectMemoryScope(fixture), "project original");
  await seedMemory(fixture, taskMemoryScope(fixture, fixture.otherTaskA), "other original");
  await seedMemory(fixture, projectMemoryScope(fixture, fixture.projectB), "foreign original");

  const invalidIntents = [
    {
      kind: "replace_task",
      projectId: fixture.projectA.id,
      taskId: fixture.otherTaskA.id,
      content: "forbidden",
    },
    {
      kind: "replace_project",
      projectId: fixture.projectB.id,
      content: "forbidden",
    },
  ] as const;
  for (const memoryIntent of invalidIntents) {
    await assert.rejects(
      fixture.processor.process({
        sessionId: projectSession,
        expectedAgent: "examiner",
        result: {
          agent: "examiner",
          outcome: "success",
          summary: "Invalid target.",
          memoryIntent,
        },
      }),
      InvalidAgentResultError,
    );
  }

  const taskSession = "examiner-bound-scope";
  await bindTask(fixture, taskSession);
  await assert.rejects(
    fixture.processor.process({
      sessionId: taskSession,
      expectedAgent: "examiner",
      result: {
        agent: "examiner",
        outcome: "success",
        summary: "Other task target.",
        memoryIntent: {
          kind: "replace_task",
          projectId: fixture.projectA.id,
          taskId: fixture.otherTaskA.id,
          content: "forbidden",
        },
      },
    }),
    InvalidAgentResultError,
  );

  assert.equal((await fixture.memory.getProjectCanonicalMemory(fixture.projectA.id)).content, "project original");
  assert.equal((await fixture.memory.getTaskCanonicalMemory(fixture.projectA.id, fixture.otherTaskA.id)).content, "other original");
  assert.equal((await fixture.memory.getProjectCanonicalMemory(fixture.projectB.id)).content, "foreign original");
});

test("EXAMINER changes only current canonical scope and never a loaded source", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "examiner-loaded-source";
  await bindTask(fixture, sessionId);
  await seedMemory(fixture, projectMemoryScope(fixture, fixture.projectB), "loaded source truth");
  const source: MemorySourceIdentity = {
    kind: "project",
    projectId: fixture.projectB.id,
    projectName: fixture.projectB.name,
  };
  await fixture.memory.load(taskMemoryScope(fixture), source);

  await fixture.processor.process({
    sessionId,
    expectedAgent: "examiner",
    result: {
      agent: "examiner",
      outcome: "success",
      summary: "Update current task only.",
      memoryIntent: {
        kind: "replace_task",
        projectId: fixture.projectA.id,
        taskId: fixture.taskA.id,
        content: "current task truth",
      },
    },
  });

  assert.equal((await fixture.memory.getTaskCanonicalMemory(fixture.projectA.id, fixture.taskA.id)).content, "current task truth");
  assert.equal((await fixture.memory.getProjectCanonicalMemory(fixture.projectB.id)).content, "loaded source truth");
});

test("EXAMINER none and conflict/needs-user results do not mutate memory", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "examiner-no-change";
  await bindTask(fixture, sessionId);
  await seedMemory(fixture, taskMemoryScope(fixture), "unchanged");

  const none = await fixture.processor.process({
    sessionId,
    expectedAgent: "examiner",
    result: {
      agent: "examiner",
      outcome: "success",
      summary: "No change needed.",
      memoryIntent: { kind: "none" },
    },
  });
  assert.deepEqual(none.stateEffects, []);

  const conflict = await fixture.processor.process({
    sessionId,
    expectedAgent: "examiner",
    result: {
      agent: "examiner",
      outcome: "needs_user",
      summary: "Sources conflict.",
      memoryConflict: { summary: "Two retention periods disagree." },
      memoryIntent: {
        kind: "replace_task",
        projectId: fixture.projectA.id,
        taskId: fixture.taskA.id,
        content: "must not be written",
      },
    },
  });
  assert.deepEqual(conflict.memoryConflict, {
    summary: "Two retention periods disagree.",
  });
  assert.deepEqual(conflict.stateEffects, []);
  assert.equal((await fixture.memory.getTaskCanonicalMemory(fixture.projectA.id, fixture.taskA.id)).content, "unchanged");
});

test("completed bound tasks support EXAMINER mutation persisted across instances", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "examiner-completed";
  await bindTask(fixture, sessionId);
  await fixture.tasks.markCompleted(fixture.projectA.id, fixture.taskA.id);

  await fixture.processor.process({
    sessionId,
    expectedAgent: "examiner",
    result: {
      agent: "examiner",
      outcome: "success",
      summary: "Final canonical task memory.",
      memoryIntent: {
        kind: "replace_task",
        projectId: fixture.projectA.id,
        taskId: fixture.taskA.id,
        content: "persisted final truth",
      },
    },
  });

  assert.equal(
    (await newManagers(fixture).memory.getTaskCanonicalMemory(fixture.projectA.id, fixture.taskA.id)).content,
    "persisted final truth",
  );
});

test("PLANNER saves only draft while preserving an accepted current plan", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "planner-draft";
  await bindTask(fixture, sessionId);
  const noDraft = await fixture.processor.process({
    sessionId,
    expectedAgent: "planner",
    result: {
      agent: "planner",
      outcome: "success",
      summary: "No plan change needed.",
    },
  });
  assert.deepEqual(noDraft.stateEffects, []);
  await fixture.plans.saveDraft(fixture.taskA.id, "# Accepted plan\n");
  await fixture.plans.acceptDraft(fixture.taskA.id);

  const processed = await fixture.processor.process({
    sessionId,
    expectedAgent: "planner",
    result: {
      agent: "planner",
      outcome: "success",
      summary: "Revision drafted.",
      draftPlanMarkdown: "# Proposed revision\n",
    },
  });

  assert.deepEqual(processed.stateEffects, [
    { kind: "plan_draft_saved", taskId: fixture.taskA.id },
  ]);
  const persisted = newManagers(fixture).plans;
  assert.equal((await persisted.getCurrent(fixture.taskA.id))?.content, "# Accepted plan\n");
  assert.equal((await persisted.getDraft(fixture.taskA.id))?.content, "# Proposed revision\n");
});

test("PLANNER consultation is preserved in the processed result", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "planner-consultation";
  await bindTask(fixture, sessionId);

  const processed = await fixture.processor.process({
    sessionId,
    expectedAgent: "planner",
    result: {
      agent: "planner",
      outcome: "success",
      summary: "The accepted plan remains valid.",
      consultation: {
        disposition: "plan_still_valid",
        message: "Continue without changing the plan.",
      },
    },
  });

  assert.deepEqual(processed.consultation, {
    disposition: "plan_still_valid",
    message: "Continue without changing the plan.",
  });
  assert.deepEqual(processed.stateEffects, []);
  assert.equal(await fixture.plans.getDraft(fixture.taskA.id), null);
});

test("PLANNER never creates current plan and invalid drafts cause no mutation", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "planner-no-accept";
  await bindTask(fixture, sessionId);

  await fixture.processor.process({
    sessionId,
    expectedAgent: "planner",
    result: {
      agent: "planner",
      outcome: "success",
      summary: "Draft prepared.",
      draftPlanMarkdown: "# Draft only\n",
    },
  });
  assert.equal(await fixture.plans.getCurrent(fixture.taskA.id), null);

  await assert.rejects(
    fixture.processor.process({
      sessionId,
      expectedAgent: "planner",
      result: {
        agent: "planner",
        outcome: "success",
        summary: "Invalid empty draft.",
        draftPlanMarkdown: "   ",
      },
    }),
    InvalidAgentResultError,
  );
  assert.equal((await fixture.plans.getDraft(fixture.taskA.id))?.content, "# Draft only\n");
});

test("completed tasks reject PLANNER processing before plan mutation", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "planner-completed";
  await bindTask(fixture, sessionId);
  await fixture.tasks.markCompleted(fixture.projectA.id, fixture.taskA.id);

  await assert.rejects(
    fixture.processor.process({
      sessionId,
      expectedAgent: "planner",
      result: {
        agent: "planner",
        outcome: "success",
        summary: "Late draft.",
        draftPlanMarkdown: "# Late\n",
      },
    }),
    TaskCompletedError,
  );
  assert.equal(await fixture.plans.getDraft(fixture.taskA.id), null);
});

test("CODER persists configured work record, returns call request, and leaves lifecycle and plan unchanged", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "coder-work";
  await bindTask(fixture, sessionId);
  await fixture.plans.saveDraft(fixture.taskA.id, "# Existing draft\n");
  await seedMemory(fixture, taskMemoryScope(fixture), "canonical before coder");

  const processed = await fixture.processor.process({
    sessionId,
    expectedAgent: "coder",
    result: {
      agent: "coder",
      outcome: "success",
      summary: "Implementation recorded.",
      workRecord: { files_changed: ["src/a.ts"], tests_run: ["npm test"] },
      requestedCalls: [
        {
          target: "reviewer",
          purpose: "review_followup",
          handoff: {
            caller: "coder",
            target: "reviewer",
            purpose: "review_followup",
            summary: "Review the implementation.",
          },
        },
      ],
    },
  });

  assert.equal(processed.persistedArtifacts[0]?.category, "coder");
  assert.equal(processed.requestedCalls[0]?.target, "reviewer");
  assert.equal((await fixture.tasks.get(fixture.projectA.id, fixture.taskA.id)).status, "active");
  assert.equal((await fixture.plans.getDraft(fixture.taskA.id))?.content, "# Existing draft\n");
  assert.equal(
    (
      await fixture.memory.getTaskCanonicalMemory(
        fixture.projectA.id,
        fixture.taskA.id,
      )
    ).content,
    "canonical before coder",
  );
  assert.deepEqual(await fixture.artifacts.listReviewerReports(taskScope(fixture)), []);
  assert.equal((await newManagers(fixture).artifacts.listCoderWorkRecords(taskScope(fixture))).length, 1);
});

test("CODER behavior accepts configured subsets and rejects extra keys before persistence", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "coder-behavior";
  await bindTask(fixture, sessionId);
  await fixture.behavior.replaceOutputFields("coder", ["custom_record", "optional"]);

  await fixture.processor.process({
    sessionId,
    expectedAgent: "coder",
    result: {
      agent: "coder",
      outcome: "success",
      summary: "Configured subset.",
      workRecord: { custom_record: true },
    },
  });
  await assert.rejects(
    fixture.processor.process({
      sessionId,
      expectedAgent: "coder",
      result: {
        agent: "coder",
        outcome: "success",
        summary: "Unexpected field.",
        workRecord: { custom_record: true, unconfigured: true },
      },
    }),
    InvalidAgentResultError,
  );
  assert.equal((await fixture.artifacts.listCoderWorkRecords(taskScope(fixture))).length, 1);
});

test("completed tasks reject CODER processing without artifact or memory mutation", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "coder-completed";
  await bindTask(fixture, sessionId);
  await seedMemory(fixture, taskMemoryScope(fixture), "canonical");
  await fixture.tasks.markCompleted(fixture.projectA.id, fixture.taskA.id);

  await assert.rejects(
    fixture.processor.process({
      sessionId,
      expectedAgent: "coder",
      result: {
        agent: "coder",
        outcome: "success",
        summary: "Late work.",
        workRecord: { files_changed: [] },
      },
    }),
    TaskCompletedError,
  );
  assert.deepEqual(await fixture.artifacts.listCoderWorkRecords(taskScope(fixture)), []);
  assert.equal((await fixture.memory.getTaskCanonicalMemory(fixture.projectA.id, fixture.taskA.id)).content, "canonical");
});

test("REVIEWER FAIL persists every failure origin and keeps task active", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "reviewer-fail";
  await bindTask(fixture, sessionId);

  for (const failureOrigin of ["implementation", "plan", "mixed"] as const) {
    const processed = await fixture.processor.process({
      sessionId,
      expectedAgent: "reviewer",
      result: {
        agent: "reviewer",
        outcome: "success",
        summary: `Failure origin: ${failureOrigin}.`,
        reviewStatus: "FAIL",
        failureOrigin,
        report: { validation_results: [failureOrigin] },
      },
    });
    assert.deepEqual(
      processed.stateEffects.map(({ kind }) => kind),
      ["reviewer_artifact_saved"],
    );
    assert.equal(processed.failureOrigin, failureOrigin);
  }

  assert.equal((await fixture.tasks.get(fixture.projectA.id, fixture.taskA.id)).status, "active");
  assert.deepEqual(
    (await fixture.artifacts.listReviewerReports(taskScope(fixture))).map(
      ({ review }) => review.failureOrigin,
    ),
    ["implementation", "plan", "mixed"],
  );
});

test("REVIEWER PASS persists report then completes while retaining session binding and ownership", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "reviewer-pass";
  await bindTask(fixture, sessionId);
  await fixture.artifacts.saveQuestionerContext(taskScope(fixture), { temporary: true });
  await fixture.plans.saveDraft(fixture.taskA.id, "# Accepted plan\n");
  await fixture.plans.acceptDraft(fixture.taskA.id);

  const processed = await fixture.processor.process({
    sessionId,
    expectedAgent: "reviewer",
    result: {
      agent: "reviewer",
      outcome: "success",
      summary: "Review passed.",
      reviewStatus: "PASS",
      report: { requirement_compliance: true },
    },
  });

  assert.deepEqual(
    processed.stateEffects.map(({ kind }) => kind),
    ["reviewer_artifact_saved", "task_completed"],
  );
  const persisted = newManagers(fixture);
  const persistedReports = await persisted.artifacts.listReviewerReports(
    taskScope(fixture),
  );
  assert.equal(persistedReports.length, 1);
  assert.deepEqual(persistedReports[0]?.review, {
    status: "PASS",
    warnings: [],
  });
  assert.equal((await persisted.tasks.get(fixture.projectA.id, fixture.taskA.id)).status, "completed");
  assert.equal((await persisted.sessions.getCurrentBinding(sessionId)).taskId, fixture.taskA.id);
  assert.equal((await persisted.sessions.findTaskOwner(fixture.taskA.id))?.sessionId, sessionId);
  assert.equal((await persisted.artifacts.getQuestionerContext(taskScope(fixture))).hasContext, true);
  assert.equal((await persisted.plans.getCurrent(fixture.taskA.id))?.content, "# Accepted plan\n");
  assert.equal((await persisted.tasks.listArchived(fixture.projectA.id)).length, 0);
});

test("REVIEWER PASS_WITH_WARNINGS keeps lifecycle warnings outside report payload", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "reviewer-warning-pass";
  await bindTask(fixture, sessionId);
  await fixture.behavior.replaceOutputFields("reviewer", [
    "requirement_compliance",
  ]);

  const processed = await fixture.processor.process({
    sessionId,
    expectedAgent: "reviewer",
    result: {
      agent: "reviewer",
      outcome: "success",
      summary: "Pass with production concern.",
      warnings: ["Crash retry hardening remains deferred."],
      reviewStatus: "PASS_WITH_WARNINGS",
      report: { requirement_compliance: true },
    },
  });

  assert.deepEqual(processed.warnings, [
    "Crash retry hardening remains deferred.",
  ]);
  const report = (await fixture.artifacts.listReviewerReports(taskScope(fixture)))[0];
  assert.deepEqual(report?.review, {
    status: "PASS_WITH_WARNINGS",
    warnings: ["Crash retry hardening remains deferred."],
  });
  assert.equal(report === undefined ? true : "warnings" in report.payload, false);
  assert.equal((await fixture.tasks.get(fixture.projectA.id, fixture.taskA.id)).status, "completed");
});

test("REVIEWER requested EXAMINER call is returned without execution", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "reviewer-request";
  await bindTask(fixture, sessionId);

  const processed = await fixture.processor.process({
    sessionId,
    expectedAgent: "reviewer",
    result: {
      agent: "reviewer",
      outcome: "success",
      summary: "Review failed with a semantic concern.",
      reviewStatus: "FAIL",
      failureOrigin: "mixed",
      report: { recommendations: ["Re-examine memory"] },
      requestedCalls: [
        {
          target: "examiner",
          purpose: "memory_update",
          handoff: {
            caller: "reviewer",
            target: "examiner",
            purpose: "memory_update",
            summary: "Inspect the semantic conflict.",
          },
        },
      ],
    },
  });

  assert.equal(processed.requestedCalls[0]?.target, "examiner");
  assert.equal((await fixture.memory.getTaskCanonicalMemory(fixture.projectA.id, fixture.taskA.id)).hasContent, false);
  assert.equal((await fixture.tasks.get(fixture.projectA.id, fixture.taskA.id)).status, "active");
});

test("invalid REVIEWER result and behavior fields cause no report or lifecycle mutation", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "reviewer-invalid";
  await bindTask(fixture, sessionId);

  await assert.rejects(
    fixture.processor.process({
      sessionId,
      expectedAgent: "reviewer",
      result: {
        agent: "reviewer",
        outcome: "success",
        summary: "Malformed pass.",
        reviewStatus: "PASS_WITH_WARNINGS",
        report: { requirement_compliance: true },
      },
    }),
    InvalidAgentResultError,
  );
  await assert.rejects(
    fixture.processor.process({
      sessionId,
      expectedAgent: "reviewer",
      result: {
        agent: "reviewer",
        outcome: "success",
        summary: "Malformed helper request.",
        reviewStatus: "FAIL",
        failureOrigin: "implementation",
        report: { requirement_compliance: false },
        requestedCalls: [
          {
            target: "examiner",
            purpose: "memory_update",
            handoff: {
              caller: "coder",
              target: "examiner",
              purpose: "memory_update",
              summary: "Caller mismatch.",
            },
          },
        ],
      },
    }),
    InvalidAgentResultError,
  );
  await assert.rejects(
    fixture.processor.process({
      sessionId,
      expectedAgent: "reviewer",
      result: {
        agent: "reviewer",
        outcome: "success",
        summary: "Extra report field.",
        reviewStatus: "PASS",
        report: { requirement_compliance: true, secret_extra: true },
      },
    }),
    InvalidAgentResultError,
  );

  assert.deepEqual(await fixture.artifacts.listReviewerReports(taskScope(fixture)), []);
  assert.equal((await fixture.tasks.get(fixture.projectA.id, fixture.taskA.id)).status, "active");
});

test("malformed cross-role authority claims are rejected before every mutation", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "cross-role-protection";
  await bindTask(fixture, sessionId);
  const invalidRequests = [
    {
      expectedAgent: "coder" as const,
      result: {
        agent: "reviewer",
        outcome: "success",
        summary: "Wrong agent discriminator.",
        reviewStatus: "FAIL",
        failureOrigin: "implementation",
        report: { validation_results: [] },
      },
    },
    {
      expectedAgent: "planner" as const,
      result: {
        agent: "planner",
        outcome: "success",
        summary: "Attempt memory write.",
        memoryIntent: { kind: "none" },
      },
    },
    {
      expectedAgent: "coder" as const,
      result: {
        agent: "coder",
        outcome: "success",
        summary: "Attempt plan write.",
        workRecord: { files_changed: [] },
        draftPlanMarkdown: "# Forbidden",
      },
    },
    {
      expectedAgent: "coder" as const,
      result: {
        agent: "coder",
        outcome: "success",
        summary: "Attempt Reviewer lifecycle write.",
        workRecord: { files_changed: [] },
        review: { status: "PASS", warnings: [] },
      },
    },
    {
      expectedAgent: "reviewer" as const,
      result: {
        agent: "reviewer",
        outcome: "success",
        summary: "Attempt archive.",
        reviewStatus: "FAIL",
        failureOrigin: "implementation",
        report: { validation_results: [] },
        archiveTask: true,
      },
    },
    {
      expectedAgent: "researcher" as const,
      result: {
        agent: "researcher",
        outcome: "success",
        summary: "Attempt lifecycle change.",
        researchArtifact: { findings: [] },
        taskStatus: "completed",
      },
    },
    {
      expectedAgent: "questioner" as const,
      result: {
        agent: "questioner",
        outcome: "success",
        summary: "Attempt completion.",
        state: "context_complete",
        reviewStatus: "PASS",
      },
    },
  ];

  for (const request of invalidRequests) {
    await assert.rejects(
      fixture.processor.process({ sessionId, ...request }),
      InvalidAgentResultError,
    );
  }

  assert.equal((await fixture.memory.getTaskCanonicalMemory(fixture.projectA.id, fixture.taskA.id)).hasContent, false);
  assert.equal(await fixture.plans.getDraft(fixture.taskA.id), null);
  assert.deepEqual(await fixture.artifacts.listResearchArtifacts(taskScope(fixture)), []);
  assert.deepEqual(await fixture.artifacts.listCoderWorkRecords(taskScope(fixture)), []);
  assert.deepEqual(await fixture.artifacts.listReviewerReports(taskScope(fixture)), []);
  assert.equal((await fixture.artifacts.getQuestionerContext(taskScope(fixture))).hasContext, false);
  assert.equal((await fixture.tasks.get(fixture.projectA.id, fixture.taskA.id)).status, "active");
});

test("processing never writes into registered project source directories", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "source-isolation";
  await bindTask(fixture, sessionId);
  await fixture.processor.process({
    sessionId,
    expectedAgent: "coder",
    result: {
      agent: "coder",
      outcome: "success",
      summary: "Record only.",
      workRecord: { files_changed: ["future-only.ts"] },
    },
  });

  assert.deepEqual(await readdir(fixture.projectA.sourcePath), []);
  assert.deepEqual(await readdir(fixture.projectB.sourcePath), []);
});
