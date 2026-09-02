import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { AGENT_NAMES } from "../src/domain/agent.js";
import {
  ImmutableContractViolationError,
  InvalidRuleError,
  InvalidRuleValueError,
  NoProjectBoundError,
  NoTaskBoundError,
} from "../src/domain/errors.js";
import {
  formatRuleKey,
  type EffectiveRule,
  type RuleDecision,
  type RuleKey,
  type ScopedRule,
} from "../src/domain/rule.js";
import { ProjectManager } from "../src/core/project-manager.js";
import {
  CODER_PLANNER_CALL_PURPOSES,
  RoleContractRegistry,
} from "../src/core/role-contract-registry.js";
import { RuleResolver } from "../src/core/rule-resolver.js";
import { SessionManager } from "../src/core/session-manager.js";
import { TaskManager } from "../src/core/task-manager.js";
import type { Project } from "../src/domain/project.js";
import type { Task } from "../src/domain/task.js";
import { StateStore } from "../src/infrastructure/state-store.js";
import { RuleOperations } from "../src/operations/rule-operations.js";

const CODER_RESEARCHER: RuleKey = {
  kind: "agent_call",
  caller: "coder",
  target: "researcher",
};
const PLANNER_CODER: RuleKey = {
  kind: "agent_call",
  caller: "planner",
  target: "coder",
};
const CODER_REVIEWER: RuleKey = {
  kind: "agent_call",
  caller: "coder",
  target: "reviewer",
};

interface Fixture {
  readonly root: string;
  readonly stateRoot: string;
  readonly homeDirectory: string;
  readonly sourcesDirectory: string;
  readonly store: StateStore;
  readonly projects: ProjectManager;
  readonly sessions: SessionManager;
  readonly tasks: TaskManager;
  readonly resolver: RuleResolver;
  readonly operations: RuleOperations;
  readonly project: Project;
}

async function createFixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-rule-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const stateRoot = join(root, "state-root");
  const homeDirectory = join(root, "home");
  const sourcesDirectory = join(root, "sources");
  await Promise.all([
    mkdir(homeDirectory, { recursive: true }),
    mkdir(sourcesDirectory, { recursive: true }),
  ]);

  const store = new StateStore(stateRoot);
  const projects = new ProjectManager(store, { homeDirectory });
  const sessions = new SessionManager(store);
  const tasks = new TaskManager(store, projects);
  const sourcePath = join(sourcesDirectory, "primary");
  await mkdir(sourcePath);
  const project = await projects.create("Rules Project", sourcePath);

  return {
    root,
    stateRoot,
    homeDirectory,
    sourcesDirectory,
    store,
    projects,
    sessions,
    tasks,
    resolver: new RuleResolver(store, projects, tasks),
    operations: new RuleOperations({ synaphexRoot: stateRoot, homeDirectory }),
    project,
  };
}

async function bindProject(fixture: Fixture, sessionId: string): Promise<void> {
  await fixture.sessions.bindProject(sessionId, fixture.project.id);
}

async function bindNewTask(
  fixture: Fixture,
  sessionId: string,
  description = "Rule test task",
): Promise<Task> {
  await bindProject(fixture, sessionId);
  const task = await fixture.tasks.create(fixture.project.id, description);
  await fixture.sessions.bindTask(sessionId, task.id);
  return task;
}

function findRule<T extends ScopedRule>(rules: readonly T[], key: RuleKey): T {
  const rule = rules.find(
    (candidate) => formatRuleKey(candidate.key) === formatRuleKey(key),
  );
  assert.notEqual(rule, undefined, `Missing rule ${formatRuleKey(key)}`);
  return rule as T;
}

test("accepted global defaults initialize once and resolve from global scope", async (t) => {
  const fixture = await createFixture(t);

  assert.deepEqual(
    Object.fromEntries(
      (await fixture.operations.showRules("defaults-session", "global")).map(
        (rule) => [formatRuleKey(rule.key), rule.decision],
      ),
    ),
    {
      "action.ci": "ask",
      "action.git_push": "ask",
      "action.network": "ask",
      "agent-call.coder.planner": "allow",
      "agent-call.coder.questioner": "ask",
      "agent-call.coder.researcher": "ask",
      "agent-call.coder.reviewer": "deny",
      "agent-call.examiner.researcher": "ask",
      "agent-call.planner.coder": "deny",
      "agent-call.planner.examiner": "ask",
      "agent-call.planner.questioner": "ask",
      "agent-call.planner.researcher": "ask",
      "agent-call.questioner.examiner": "allow",
      "agent-call.questioner.researcher": "ask",
      "agent-call.researcher.examiner": "ask",
      "agent-call.reviewer.coder": "ask",
      "agent-call.reviewer.examiner": "ask",
      "agent-call.reviewer.planner": "ask",
      "agent-call.reviewer.researcher": "ask",
    },
  );

  assert.deepEqual(await fixture.resolver.resolveRule(CODER_RESEARCHER), {
    key: CODER_RESEARCHER,
    decision: "ask",
    source: "global",
  });
  assert.deepEqual(
    await fixture.resolver.resolveRule({ kind: "action", action: "git_push" }),
    {
      key: { kind: "action", action: "git_push" },
      decision: "ask",
      source: "global",
    },
  );
});

test("project and task overrides follow exact precedence and removal inherits", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "precedence-session";
  const task = await bindNewTask(fixture, sessionId);
  const context = { projectId: fixture.project.id, taskId: task.id };

  await fixture.operations.setRule(
    sessionId,
    "project",
    CODER_RESEARCHER,
    "deny",
  );
  assert.deepEqual(await fixture.resolver.resolveRule(CODER_RESEARCHER, context), {
    key: CODER_RESEARCHER,
    decision: "deny",
    source: "project",
  });

  await fixture.operations.setRule(
    sessionId,
    "task",
    CODER_RESEARCHER,
    "allow",
  );
  assert.deepEqual(await fixture.resolver.resolveRule(CODER_RESEARCHER, context), {
    key: CODER_RESEARCHER,
    decision: "allow",
    source: "task",
  });

  await fixture.operations.removeRule(sessionId, "task", CODER_RESEARCHER);
  assert.equal(
    (await fixture.resolver.resolveRule(CODER_RESEARCHER, context)).source,
    "project",
  );

  await fixture.operations.removeRule(sessionId, "project", CODER_RESEARCHER);
  assert.deepEqual(await fixture.resolver.resolveRule(CODER_RESEARCHER, context), {
    key: CODER_RESEARCHER,
    decision: "ask",
    source: "global",
  });
});

test("effective rule listing preserves each winning source scope", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "effective-session";
  await bindNewTask(fixture, sessionId);
  await fixture.operations.setRule(
    sessionId,
    "project",
    CODER_RESEARCHER,
    "deny",
  );
  const taskAction: RuleKey = { kind: "action", action: "deploy" };
  await fixture.operations.setRule(sessionId, "task", taskAction, "allow");

  const effective = await fixture.operations.showRules(sessionId, "effective");

  assert.equal(findRule<EffectiveRule>(effective, CODER_RESEARCHER).source, "project");
  assert.equal(findRule<EffectiveRule>(effective, taskAction).source, "task");
  assert.equal(
    findRule<EffectiveRule>(effective, { kind: "action", action: "network" })
      .source,
    "global",
  );
});

test("unspecified agent-call and action rules resolve to explicit default deny", async (t) => {
  const fixture = await createFixture(t);
  const unspecifiedAgentCall: RuleKey = {
    kind: "agent_call",
    caller: "questioner",
    target: "coder",
  };
  const unspecifiedAction: RuleKey = {
    kind: "action",
    action: "unconfigured_action",
  };

  assert.deepEqual(await fixture.resolver.resolveRule(unspecifiedAgentCall), {
    key: unspecifiedAgentCall,
    decision: "deny",
    source: "default_deny",
  });
  assert.deepEqual(await fixture.resolver.resolveRule(unspecifiedAction), {
    key: unspecifiedAction,
    decision: "deny",
    source: "default_deny",
  });
});

test("global mutation works without any project binding", async (t) => {
  const fixture = await createFixture(t);
  const key: RuleKey = { kind: "action", action: "release" };

  await fixture.operations.setRule("unknown-session", "global", key, "allow");

  assert.deepEqual(
    findRule(await fixture.operations.showRules("unknown-session", "global"), key),
    { key, decision: "allow" },
  );
});

test("project mutation without a project binding is rejected", async (t) => {
  const fixture = await createFixture(t);

  await assert.rejects(
    fixture.operations.setRule(
      "no-project-session",
      "project",
      CODER_RESEARCHER,
      "deny",
    ),
    (error: unknown) =>
      error instanceof NoProjectBoundError && error.code === "NO_PROJECT_BOUND",
  );
});

test("task mutation without a task binding is rejected", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "project-only-session";
  await bindProject(fixture, sessionId);

  await assert.rejects(
    fixture.operations.setRule(
      sessionId,
      "task",
      CODER_RESEARCHER,
      "deny",
    ),
    (error: unknown) =>
      error instanceof NoTaskBoundError && error.code === "NO_TASK_BOUND",
  );
});

test("explicit project and task mutations write only their requested scopes", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "explicit-scope-session";
  await bindNewTask(fixture, sessionId);
  const projectKey: RuleKey = { kind: "action", action: "project_action" };
  const taskKey: RuleKey = { kind: "action", action: "task_action" };

  assert.deepEqual(
    await fixture.operations.showRules(sessionId, "project"),
    [],
  );
  assert.deepEqual(await fixture.operations.showRules(sessionId, "task"), []);

  await fixture.operations.setRule(sessionId, "project", projectKey, "ask");
  await fixture.operations.setRule(sessionId, "task", taskKey, "deny");

  const projectRules = await fixture.operations.showRules(sessionId, "project");
  const taskRules = await fixture.operations.showRules(sessionId, "task");
  assert.deepEqual(findRule(projectRules, projectKey), {
    key: projectKey,
    decision: "ask",
  });
  assert.equal(
    taskRules.some(({ key }) => formatRuleKey(key) === formatRuleKey(projectKey)),
    false,
  );
  assert.deepEqual(findRule(taskRules, taskKey), {
    key: taskKey,
    decision: "deny",
  });
});

test("global scope is not inferred from a task-bound session", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "global-explicit-session";
  await bindNewTask(fixture, sessionId);
  const key: RuleKey = { kind: "action", action: "global_only" };

  await fixture.operations.setRule(sessionId, "global", key, "allow");

  assert.deepEqual(
    findRule(await fixture.operations.showRules(sessionId, "global"), key),
    { key, decision: "allow" },
  );
  assert.equal(
    (await fixture.operations.showRules(sessionId, "task")).some(
      (rule) => formatRuleKey(rule.key) === formatRuleKey(key),
    ),
    false,
  );
});

test("forbidden planner-to-coder decisions reject allow and ask", async (t) => {
  const fixture = await createFixture(t);

  for (const decision of ["allow", "ask"] as const) {
    await assert.rejects(
      fixture.operations.setRule(
        "contract-session",
        "global",
        PLANNER_CODER,
        decision,
      ),
      (error: unknown) =>
        error instanceof ImmutableContractViolationError &&
        error.code === "IMMUTABLE_CONTRACT_VIOLATION",
    );
  }
});

test("forbidden coder-to-reviewer decisions reject allow and ask", async (t) => {
  const fixture = await createFixture(t);

  for (const decision of ["allow", "ask"] as const) {
    await assert.rejects(
      fixture.operations.setRule(
        "contract-session",
        "global",
        CODER_REVIEWER,
        decision,
      ),
      ImmutableContractViolationError,
    );
  }
});

test("immutable source-code mutation capabilities are queryable", () => {
  const registry = new RoleContractRegistry();

  for (const agent of AGENT_NAMES) {
    assert.equal(registry.canModifySourceCode(agent), agent === "coder");
  }
});

test("only Examiner has canonical-memory write capability", () => {
  const registry = new RoleContractRegistry();

  for (const agent of AGENT_NAMES) {
    assert.equal(registry.canWriteCanonicalMemory(agent), agent === "examiner");
  }
});

test("coder-to-planner contract validates plan presence and allowed purposes", () => {
  const registry = new RoleContractRegistry();

  assert.deepEqual(registry.evaluateAgentCall("coder", "planner"), {
    allowed: false,
    reason: "accepted_plan_required",
  });
  assert.deepEqual(
    registry.evaluateAgentCall("coder", "planner", {
      acceptedPlanExists: true,
    }),
    { allowed: false, reason: "unsupported_call_purpose" },
  );
  for (const purpose of CODER_PLANNER_CALL_PURPOSES) {
    assert.deepEqual(
      registry.evaluateAgentCall("coder", "planner", {
        acceptedPlanExists: true,
        purpose,
      }),
      { allowed: true, reason: "conditional_contract_satisfied" },
    );
  }
});

test("removing a forbidden edge override is allowed but contract stays authoritative", async (t) => {
  const fixture = await createFixture(t);

  await fixture.operations.removeRule(
    "contract-session",
    "global",
    PLANNER_CODER,
  );

  assert.deepEqual(await fixture.resolver.resolveRule(PLANNER_CODER), {
    key: PLANNER_CODER,
    decision: "deny",
    source: "default_deny",
  });
  assert.deepEqual(
    new RoleContractRegistry().evaluateAgentCall("planner", "coder"),
    { allowed: false, reason: "forbidden_edge" },
  );
});

test("invalid rule keys and values return stable domain errors", async (t) => {
  const fixture = await createFixture(t);

  await assert.rejects(
    fixture.operations.setRule(
      "invalid-session",
      "global",
      { kind: "action", action: "" },
      "allow",
    ),
    (error: unknown) =>
      error instanceof InvalidRuleError && error.code === "INVALID_RULE",
  );
  await assert.rejects(
    fixture.operations.setRule(
      "invalid-session",
      "global",
      { kind: "action", action: "valid" },
      "maybe" as RuleDecision,
    ),
    (error: unknown) =>
      error instanceof InvalidRuleValueError &&
      error.code === "INVALID_RULE_VALUE",
  );
});

test("global, project, and task rules survive new service instances", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "persistent-rules-session";
  await bindNewTask(fixture, sessionId, "Persistent rules");
  const globalKey: RuleKey = { kind: "action", action: "persistent_global" };
  const projectKey: RuleKey = { kind: "action", action: "persistent_project" };
  const taskKey: RuleKey = { kind: "action", action: "persistent_task" };
  await fixture.operations.setRule(sessionId, "global", globalKey, "allow");
  await fixture.operations.setRule(sessionId, "project", projectKey, "ask");
  await fixture.operations.setRule(sessionId, "task", taskKey, "deny");

  const newOperations = new RuleOperations({
    synaphexRoot: fixture.stateRoot,
    homeDirectory: fixture.homeDirectory,
  });

  assert.equal(
    findRule(await newOperations.showRules(sessionId, "global"), globalKey)
      .decision,
    "allow",
  );
  assert.equal(
    findRule(await newOperations.showRules(sessionId, "project"), projectKey)
      .decision,
    "ask",
  );
  assert.equal(
    findRule(await newOperations.showRules(sessionId, "task"), taskKey)
      .decision,
    "deny",
  );
});

test("manual JSONC rule state is readable and later project creation does not overwrite it", async (t) => {
  const fixture = await createFixture(t);
  await writeFile(
    join(fixture.stateRoot, "rules.jsonc"),
    `{
      // Manually maintained global policy
      "agent_calls": {
        "questioner": {
          "researcher": "deny",
        },
      },
      "actions": {
        "manual_action": "allow",
      },
    }`,
    "utf8",
  );
  const secondSource = join(fixture.sourcesDirectory, "second");
  await mkdir(secondSource);
  await fixture.projects.create("Second Project", secondSource);

  const newOperations = new RuleOperations({
    synaphexRoot: fixture.stateRoot,
    homeDirectory: fixture.homeDirectory,
  });
  const globalRules = await newOperations.showRules("manual-session", "global");

  assert.deepEqual(
    findRule(globalRules, {
      kind: "agent_call",
      caller: "questioner",
      target: "researcher",
    }),
    {
      key: {
        kind: "agent_call",
        caller: "questioner",
        target: "researcher",
      },
      decision: "deny",
    },
  );
  assert.deepEqual(
    findRule(globalRules, { kind: "action", action: "manual_action" }),
    {
      key: { kind: "action", action: "manual_action" },
      decision: "allow",
    },
  );
  assert.equal(
    globalRules.some(
      ({ key }) =>
        key.kind === "action" && key.action === "git_push",
    ),
    false,
  );
});
