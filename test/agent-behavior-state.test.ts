import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { AgentBehaviorManager } from "../src/core/agent-behavior-manager.js";
import { AgentConfigManager } from "../src/core/agent-config-manager.js";
import { RoleContractRegistry } from "../src/core/role-contract-registry.js";
import {
  DEFAULT_AGENT_BEHAVIOR_FIELDS,
  type AgentBehaviorState,
} from "../src/domain/agent-behavior.js";
import {
  InvalidAgentBehaviorError,
  UnsupportedAgentBehaviorError,
} from "../src/domain/errors.js";
import { StateStore } from "../src/infrastructure/state-store.js";

interface Fixture {
  readonly root: string;
  readonly store: StateStore;
  readonly manager: AgentBehaviorManager;
}

async function createFixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-agent-behavior-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new StateStore(root);
  return { root, store, manager: new AgentBehaviorManager(store) };
}

function newManager(fixture: Fixture): AgentBehaviorManager {
  return new AgentBehaviorManager(new StateStore(fixture.root));
}

test("absent behavior state initializes the accepted Researcher defaults", async (t) => {
  const fixture = await createFixture(t);

  assert.deepEqual(
    (await fixture.manager.getResearcherBehavior()).outputFields,
    DEFAULT_AGENT_BEHAVIOR_FIELDS.researcher,
  );
  assert.equal(await fixture.store.exists("agent_behavior.jsonc"), true);
});

test("absent behavior state initializes the accepted Coder defaults", async (t) => {
  const fixture = await createFixture(t);

  assert.deepEqual(
    (await fixture.manager.getCoderBehavior()).outputFields,
    DEFAULT_AGENT_BEHAVIOR_FIELDS.coder,
  );
});

test("absent behavior state initializes the accepted Reviewer defaults", async (t) => {
  const fixture = await createFixture(t);

  assert.deepEqual(
    (await fixture.manager.getReviewerBehavior()).outputFields,
    DEFAULT_AGENT_BEHAVIOR_FIELDS.reviewer,
  );
});

test("users can remove and add fields while preserving normalized ordering", async (t) => {
  const fixture = await createFixture(t);
  const fields = [
    "files_changed",
    " custom-field ",
    "tests and validation",
    "remaining_concerns",
  ];

  const behavior = await fixture.manager.replaceOutputFields("coder", fields);

  assert.deepEqual(behavior.outputFields, [
    "files_changed",
    "custom-field",
    "tests and validation",
    "remaining_concerns",
  ]);
  assert.equal(behavior.outputFields.includes("commands_run"), false);
  assert.deepEqual(await newManager(fixture).getCoderBehavior(), behavior);
});

test("behavior mutations persist across manager instances", async (t) => {
  const fixture = await createFixture(t);
  await fixture.manager.replaceOutputFields("researcher", [
    "sources",
    "custom_evidence",
  ]);
  await fixture.manager.replaceOutputFields("reviewer", [
    "warnings",
    "ship_decision",
  ]);

  const state = await newManager(fixture).getAllBehavior();

  assert.deepEqual(state.researcher.outputFields, [
    "sources",
    "custom_evidence",
  ]);
  assert.deepEqual(state.reviewer.outputFields, [
    "warnings",
    "ship_decision",
  ]);
});

test("duplicate behavior fields are rejected after trimming", async (t) => {
  const fixture = await createFixture(t);

  await assert.rejects(
    fixture.manager.replaceOutputFields("reviewer", ["warnings", " warnings "]),
    (error: unknown) =>
      error instanceof InvalidAgentBehaviorError &&
      error.code === "INVALID_AGENT_BEHAVIOR",
  );
});

test("empty, control-character, reserved, overlong, and non-string fields are rejected", async (t) => {
  const fixture = await createFixture(t);
  const invalidLists: readonly unknown[][] = [
    ["   "],
    ["unsafe\nfield"],
    ["__proto__"],
    ["x".repeat(129)],
    [42],
  ];

  for (const fields of invalidLists) {
    await assert.rejects(
      fixture.manager.replaceOutputFields(
        "researcher",
        fields as readonly string[],
      ),
      InvalidAgentBehaviorError,
    );
  }
});

test("unsupported agents cannot receive configurable output behavior", async (t) => {
  const fixture = await createFixture(t);

  for (const agent of ["questioner", "examiner", "planner"] as const) {
    await assert.rejects(
      fixture.manager.replaceOutputFields(agent, ["field"]),
      (error: unknown) =>
        error instanceof UnsupportedAgentBehaviorError &&
        error.code === "UNSUPPORTED_AGENT_BEHAVIOR",
    );
  }
});

test("behavior changes do not alter immutable role capabilities", async (t) => {
  const fixture = await createFixture(t);
  const contracts = new RoleContractRegistry();
  const before = {
    coderSource: contracts.canModifySourceCode("coder"),
    coderMemory: contracts.canWriteCanonicalMemory("coder"),
    examinerMemory: contracts.canWriteCanonicalMemory("examiner"),
    plannerCoder: contracts.evaluateAgentCall("planner", "coder"),
  };

  await fixture.manager.replaceOutputFields("coder", []);
  await fixture.manager.replaceOutputFields("reviewer", []);

  assert.deepEqual(
    {
      coderSource: contracts.canModifySourceCode("coder"),
      coderMemory: contracts.canWriteCanonicalMemory("coder"),
      examinerMemory: contracts.canWriteCanonicalMemory("examiner"),
      plannerCoder: contracts.evaluateAgentCall("planner", "coder"),
    },
    before,
  );
});

test("existing user-edited behavior JSONC is not overwritten during initialization", async (t) => {
  const fixture = await createFixture(t);
  const manual = `{
  // Existing behavior remains authoritative.
  "version": 1,
  "behaviors": {
    "researcher": { "outputFields": ["manual_research"] },
    "coder": { "outputFields": ["manual_code"] },
    "reviewer": { "outputFields": ["manual_review"] },
  },
}\n`;
  await writeFile(join(fixture.root, "agent_behavior.jsonc"), manual, "utf8");

  assert.deepEqual(
    (await fixture.manager.getResearcherBehavior()).outputFields,
    ["manual_research"],
  );
  assert.equal(
    await readFile(join(fixture.root, "agent_behavior.jsonc"), "utf8"),
    manual,
  );
});

test("malformed behavior state returns a stable error", async (t) => {
  const fixture = await createFixture(t);
  await writeFile(join(fixture.root, "agent_behavior.jsonc"), "{ malformed", "utf8");

  await assert.rejects(
    fixture.manager.getCoderBehavior(),
    (error: unknown) =>
      error instanceof InvalidAgentBehaviorError &&
      error.code === "INVALID_AGENT_BEHAVIOR",
  );
});

test("persisted untrimmed or duplicate fields are rejected without rewriting", async (t) => {
  const fixture = await createFixture(t);
  await fixture.manager.getAllBehavior();
  const state = await fixture.store.readJson<{
    version: 1;
    behaviors: Record<string, unknown>;
  }>("agent_behavior.jsonc");
  assert.ok(state !== null);
  await fixture.store.writeJson("agent_behavior.jsonc", {
    ...state,
    behaviors: {
      ...state.behaviors,
      coder: { outputFields: ["tests_run", " tests_run "] },
    },
  });
  const before = await readFile(join(fixture.root, "agent_behavior.jsonc"), "utf8");

  await assert.rejects(
    fixture.manager.getCoderBehavior(),
    InvalidAgentBehaviorError,
  );
  assert.equal(
    await readFile(join(fixture.root, "agent_behavior.jsonc"), "utf8"),
    before,
  );
});

test("config and behavior state remain isolated from source and workflow state", async (t) => {
  const fixture = await createFixture(t);
  const source = join(fixture.root, "user-source");
  await mkdir(source);
  await writeFile(join(source, "source.txt"), "source sentinel", "utf8");
  await fixture.store.writeText(
    "projects/project-sentinel/tasks/open/task-sentinel/task.jsonc",
    "workflow sentinel",
  );
  const sourceBefore = await readdir(source);
  const workflowPath = join(
    fixture.root,
    "projects/project-sentinel/tasks/open/task-sentinel/task.jsonc",
  );

  await new AgentConfigManager(fixture.store).setConfigured("questioner", {
    provider: "openai",
    surface: "cli",
    model: "gpt-5.6-sol",
  });
  await fixture.manager.replaceOutputFields("researcher", ["findings"]);

  assert.deepEqual(await readdir(source), sourceBefore);
  assert.equal(await readFile(join(source, "source.txt"), "utf8"), "source sentinel");
  assert.equal(await readFile(workflowPath, "utf8"), "workflow sentinel");
  assert.deepEqual(
    (await readdir(fixture.root)).sort(),
    ["agent_behavior.jsonc", "agent_config.jsonc", "projects", "user-source"],
  );
});

test("concurrent behavior replacements leave one complete valid state", async (t) => {
  const fixture = await createFixture(t);
  await fixture.manager.getAllBehavior();
  const first = ["findings", "first_tail"];
  const second = ["sources", "second_tail"];

  await Promise.all([
    fixture.manager.replaceOutputFields("researcher", first),
    newManager(fixture).replaceOutputFields("researcher", second),
  ]);

  const state: AgentBehaviorState = await newManager(fixture).getAllBehavior();
  assert.ok(
    JSON.stringify(state.researcher.outputFields) === JSON.stringify(first) ||
      JSON.stringify(state.researcher.outputFields) === JSON.stringify(second),
  );
});
