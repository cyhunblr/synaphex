import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { parse } from "jsonc-parser";
import { AgentConfigManager } from "../src/core/agent-config-manager.js";
import { ensureGlobalRuleState } from "../src/core/rule-store.js";
import { AGENT_NAMES } from "../src/domain/agent.js";
import { InvalidConfigurationFileError } from "../src/domain/errors.js";
import { StateStore } from "../src/infrastructure/state-store.js";
import {
  AGENT_BEHAVIOR_FILE,
  AGENT_CONFIG_FILE,
  GLOBAL_RULES_FILE,
  MANAGED_CONFIG_FILES,
} from "../src/installer/config-lifecycle.js";
import { TEMPLATE_MARKER } from "../src/installer/config-templates.js";
import { SynaphexStateInitializer } from "../src/installer/synaphex-state-initializer.js";

interface Fixture {
  readonly root: string;
  readonly store: StateStore;
  install(): Promise<void>;
  read(file: string): Promise<string>;
  values(file: string): Promise<Record<string, unknown>>;
}

async function fixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new StateStore(root);
  return {
    root,
    store,
    async install() {
      await new SynaphexStateInitializer({
        stateStore: store,
        agentConfigs: new AgentConfigManager(store),
        seedGlobalRules: async () => ensureGlobalRuleState(store),
      }).initialize();
    },
    async read(file) {
      return readFile(join(root, file), "utf8");
    },
    async values(file) {
      return parse(await readFile(join(root, file), "utf8")) as Record<string, unknown>;
    },
  };
}

// ---------------------------------------------------------------------------
// First install
// ---------------------------------------------------------------------------

test("first install creates all three managed configs with comments", async (t) => {
  const f = await fixture(t);
  await f.install();

  for (const file of MANAGED_CONFIG_FILES) {
    const contents = await f.read(file);
    const comments = contents.split("\n").filter((line) => line.startsWith("//"));
    assert.ok(comments.length > 0, `${file} must carry maintainer comments`);
    assert.ok(contents.includes(TEMPLATE_MARKER), `${file} must be marked managed`);
    // Comments are documentation, not a manual: the file stays usable.
    assert.ok(comments.length < 40, `${file} comment block is too long`);
    // And it must still parse as JSONC.
    assert.deepEqual(parse(contents) === undefined, false, `${file} must parse`);
  }
});

test("agents start unconfigured and no model is invented", async (t) => {
  const f = await fixture(t);
  await f.install();
  const config = await f.values(AGENT_CONFIG_FILE);
  const agents = config.agents as Record<string, { status: string }>;
  assert.deepEqual(Object.keys(agents).sort(), [...AGENT_NAMES].sort());
  for (const [agent, entry] of Object.entries(agents)) {
    assert.equal(entry.status, "unconfigured", `${agent} must start unconfigured`);
    assert.equal(Object.hasOwn(entry, "model"), false);
  }
});

test("config templates never mention a credential field", async (t) => {
  const f = await fixture(t);
  await f.install();
  for (const file of MANAGED_CONFIG_FILES) {
    const contents = (await f.read(file)).toLowerCase();
    for (const forbidden of ["apikey", "api_key", "token", "password", "secret", "bearer"]) {
      assert.equal(
        contents.includes(forbidden),
        false,
        `${file} must not mention ${forbidden}; authentication is provider-owned`,
      );
    }
  }
});

test("comments describe only capabilities that actually work", async (t) => {
  const f = await fixture(t);
  await f.install();
  const config = await f.read(AGENT_CONFIG_FILE);
  // v0.1 truth after Phase 8B: vscode targets are refused, Google execution is
  // unavailable. Comments must not advertise either as working.
  assert.match(config, /vscode\s+NOT supported/);
  assert.match(config, /google\s+recognised, but execution is currently/);
  const rules = await f.read(GLOBAL_RULES_FILE);
  assert.match(rules, /task\s+>\s+project\s+>\s+global\s+>\s+default deny/);
  assert.match(rules, /allow \| ask \| deny/);
  // git_push and ci are classified but inert; say so rather than imply they run.
  assert.match(rules, /`git_push` and `ci` are classified but not executed/);
});

// ---------------------------------------------------------------------------
// Reinstall: values survive, comments refresh
// ---------------------------------------------------------------------------

test("reinstall preserves user values while regenerating comments", async (t) => {
  const f = await fixture(t);
  await f.install();

  // Non-default user values, including nested settings.
  const config = await f.values(AGENT_CONFIG_FILE);
  (config.agents as Record<string, unknown>).researcher = {
    status: "configured",
    provider: "openai",
    surface: "cli",
    model: "gpt-5.6-sol",
    settings: { reasoning: "high" },
  };
  const behavior = await f.values(AGENT_BEHAVIOR_FILE);
  const behaviors = behavior.behaviors as Record<string, { outputFields: string[] }>;
  behaviors.researcher = { outputFields: ["findings"] };
  const rules = await f.values(GLOBAL_RULES_FILE);
  (rules.actions as Record<string, string>).network = "deny";

  // Seed a stale maintainer comment and a user comment alongside the values.
  await writeFile(
    join(f.root, AGENT_CONFIG_FILE),
    `// OLD-MARKER stale text\n// a note I wrote myself\n${JSON.stringify(config, null, 2)}\n`,
  );
  await writeFile(join(f.root, AGENT_BEHAVIOR_FILE), JSON.stringify(behavior, null, 2));
  await writeFile(join(f.root, GLOBAL_RULES_FILE), JSON.stringify(rules, null, 2));

  await f.install();

  // Semantic values survive exactly -- compared by value, never by bytes,
  // because formatting and comments are intended to change.
  assert.deepEqual(
    (await f.values(AGENT_CONFIG_FILE)).agents,
    config.agents,
    "user agent values must survive",
  );
  assert.deepEqual((await f.values(AGENT_BEHAVIOR_FILE)).behaviors, behavior.behaviors);
  assert.deepEqual((await f.values(GLOBAL_RULES_FILE)).actions, rules.actions);

  // Maintainer comments refreshed: the stale marker is gone, the current one
  // is present. The user's own comment is NOT preserved, by design.
  const refreshed = await f.read(AGENT_CONFIG_FILE);
  assert.equal(refreshed.includes("OLD-MARKER"), false);
  assert.equal(refreshed.includes("a note I wrote myself"), false);
  assert.ok(refreshed.includes(TEMPLATE_MARKER));
});

test("repeated reinstall is stable once canonical", async (t) => {
  const f = await fixture(t);
  await f.install();
  const first = await f.read(AGENT_CONFIG_FILE);
  await f.install();
  // Rendering is deterministic, so a canonical file round-trips byte-identically.
  assert.equal(await f.read(AGENT_CONFIG_FILE), first);
});

// ---------------------------------------------------------------------------
// Fail closed
// ---------------------------------------------------------------------------

test("an invalid config fails closed with its bytes untouched", async (t) => {
  for (const [label, contents] of [
    ["syntax invalid", '{ "version": 1, "agents": {  BROKEN'],
    [
      "semantically invalid",
      JSON.stringify({
        version: 1,
        agents: { coder: { status: "configured", provider: "openai", surface: "cli" } },
      }),
    ],
    [
      "wrong version",
      JSON.stringify({ version: 2, agents: {} }),
    ],
    [
      "unknown field",
      JSON.stringify({ version: 1, agents: {}, mystery: true }),
    ],
    [
      "unknown agent",
      JSON.stringify({ version: 1, agents: { orchestrator: { status: "unconfigured" } } }),
    ],
  ] as const) {
    const f = await fixture(t);
    await f.install();
    await writeFile(join(f.root, AGENT_CONFIG_FILE), contents);
    const before = await f.read(AGENT_CONFIG_FILE);

    await assert.rejects(
      f.install(),
      (error: unknown) => {
        // A precise, safe error -- never a silent reset to defaults.
        assert.ok(
          error instanceof InvalidConfigurationFileError ||
            (error as { code?: string }).code !== undefined,
          `${label} must raise a typed error`,
        );
        return true;
      },
      label,
    );
    assert.equal(
      await f.read(AGENT_CONFIG_FILE),
      before,
      `${label}: the user's file must be left exactly as it was`,
    );
  }
});

test("an unknown field is rejected rather than silently dropped", async (t) => {
  // Canonical regeneration re-renders from parsed values, so an unrecognised
  // key would vanish. Refusing tells the user instead of losing their data.
  const f = await fixture(t);
  await f.install();
  const config = await f.values(AGENT_CONFIG_FILE);
  await writeFile(
    join(f.root, AGENT_CONFIG_FILE),
    JSON.stringify({ ...config, futureOption: { enabled: true } }, null, 2),
  );
  // Either validator may catch it first -- AgentConfigManager's own schema
  // check or ConfigLifecycle's unknown-key check. What matters is that it is
  // refused before any write, with a precise error.
  await assert.rejects(f.install(), /unknown field|version 1 agents object/);
  // Still there: nothing was dropped.
  assert.match(await f.read(AGENT_CONFIG_FILE), /futureOption/);
});
