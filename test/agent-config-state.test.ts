import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { AgentConfigManager } from "../src/core/agent-config-manager.js";
import type {
  AgentConfigState,
  ConfiguredAgentInput,
} from "../src/domain/agent-config.js";
import { AGENT_NAMES, type AgentName } from "../src/domain/agent.js";
import {
  AgentConfigurationRemovedError,
  AgentTargetSurfaceUnsupportedError,
  AgentUnconfiguredError,
  InvalidAgentConfigError,
  InvalidAgentModelError,
  InvalidAgentSettingError,
  ProviderExecutionPolicyUnsupportedError,
} from "../src/domain/errors.js";
import { StateStore } from "../src/infrastructure/state-store.js";

interface Fixture {
  readonly root: string;
  readonly store: StateStore;
  readonly manager: AgentConfigManager;
}

async function createFixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-agent-config-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new StateStore(root);
  return { root, store, manager: new AgentConfigManager(store) };
}

function newManager(fixture: Fixture): AgentConfigManager {
  return new AgentConfigManager(new StateStore(fixture.root));
}

async function readStoredConfig(
  fixture: Fixture,
): Promise<{ version: 1; agents: Record<string, unknown> }> {
  const value = await fixture.store.readJson<unknown>("agent_config.jsonc");
  assert.ok(value !== null && typeof value === "object");
  return value as { version: 1; agents: Record<string, unknown> };
}

async function seedHistoricalConfig(
  fixture: Fixture,
  agent: AgentName,
  input: ConfiguredAgentInput,
): Promise<void> {
  await fixture.manager.getAllConfigs();
  const stored = await readStoredConfig(fixture);
  await fixture.store.writeJson("agent_config.jsonc", {
    ...stored,
    agents: {
      ...stored.agents,
      [agent]: { status: "configured", ...input },
    },
  });
}

test("absent agent config initializes all six agents without provider or model defaults", async (t) => {
  const fixture = await createFixture(t);

  const state = await fixture.manager.getAllConfigs();

  assert.deepEqual(Object.keys(state), [...AGENT_NAMES]);
  for (const agent of AGENT_NAMES) {
    assert.deepEqual(state[agent], { status: "unconfigured" });
    assert.equal("provider" in state[agent], false);
    assert.equal("model" in state[agent], false);
  }
  assert.equal(await fixture.store.exists("agent_config.jsonc"), true);
});

test("initialized agent configuration persists across manager instances", async (t) => {
  const fixture = await createFixture(t);
  const initial = await fixture.manager.getAllConfigs();

  assert.deepEqual(await newManager(fixture).getAllConfigs(), initial);
});

test("authoring accepts callable CLIs while parsing preserves historical targets", async (t) => {
  const fixture = await createFixture(t);
  const questioner = await fixture.manager.setConfigured("questioner", {
    provider: "openai",
    surface: "cli",
    model: "gpt-5.6-sol",
  });
  const researcher = await fixture.manager.setConfigured("researcher", {
    provider: "anthropic",
    surface: "cli",
    model: "claude-sonnet-4-5",
  });
  await seedHistoricalConfig(fixture, "planner", {
    provider: "google",
    surface: "cli",
    model: "gemini-example",
  });
  await seedHistoricalConfig(fixture, "examiner", {
    provider: "anthropic",
    surface: "vscode",
    model: "claude-sonnet-4-5",
  });

  assert.equal(questioner.provider, "openai");
  assert.equal(researcher.surface, "cli");
  const planner = await fixture.manager.getConfig("planner");
  const examiner = await fixture.manager.getConfig("examiner");
  assert.equal(planner.status === "configured" ? planner.provider : null, "google");
  assert.equal(examiner.status === "configured" ? examiner.surface : null, "vscode");
  assert.deepEqual(await fixture.manager.validateAgent("questioner"), {
    agent: "questioner",
    ...questioner,
  });
  assert.deepEqual(await fixture.manager.validateAgent("researcher"), {
    agent: "researcher",
    ...researcher,
  });
  await assert.rejects(fixture.manager.validateAgent("planner"),
    ProviderExecutionPolicyUnsupportedError);
  await assert.rejects(fixture.manager.validateAgent("examiner"),
    AgentTargetSurfaceUnsupportedError);
});

test("configured model is required and must be non-empty", async (t) => {
  const fixture = await createFixture(t);
  const missingModel = {
    provider: "openai",
    surface: "cli",
  } as unknown as ConfiguredAgentInput;

  await assert.rejects(
    fixture.manager.setConfigured("coder", missingModel),
    (error: unknown) =>
      error instanceof InvalidAgentModelError &&
      error.code === "INVALID_AGENT_MODEL",
  );
  await assert.rejects(
    fixture.manager.setConfigured("coder", {
      provider: "openai",
      surface: "cli",
      model: "   ",
    }),
    InvalidAgentModelError,
  );
});

test("credential-like top-level data is outside the supported schema", async (t) => {
  const fixture = await createFixture(t);
  const withToken = {
    provider: "openai",
    surface: "cli",
    model: "gpt-5.6-sol",
    apiKey: "must-not-be-persisted",
  } as unknown as ConfiguredAgentInput;

  await assert.rejects(
    fixture.manager.setConfigured("questioner", withToken),
    (error: unknown) =>
      error instanceof InvalidAgentConfigError &&
      error.code === "INVALID_AGENT_CONFIG",
  );
  assert.deepEqual(await fixture.manager.getConfig("questioner"), {
    status: "unconfigured",
  });
});

test("authoring rejects unavailable targets before settings can widen them", async (t) => {
  const fixture = await createFixture(t);

  await assert.rejects(
    fixture.manager.setConfigured("coder", {
      provider: "anthropic",
      surface: "vscode",
      model: "claude-sonnet-4-5",
      settings: { temperature: 0.2 },
    }),
    (error: unknown) =>
      error instanceof InvalidAgentConfigError &&
      error.code === "INVALID_AGENT_CONFIG",
  );
});

test("settings must be safely JSON-compatible before capability validation", async (t) => {
  const fixture = await createFixture(t);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;

  await assert.rejects(
    fixture.manager.setConfigured("coder", {
      provider: "openai",
      surface: "cli",
      model: "gpt-5.6-sol",
      settings: cyclic,
    }),
    (error: unknown) =>
      error instanceof InvalidAgentSettingError &&
      error.code === "INVALID_AGENT_SETTING",
  );
});

test("invalid CODER capabilities do not prevent validating QUESTIONER", async (t) => {
  const fixture = await createFixture(t);
  await fixture.manager.setConfigured("questioner", {
    provider: "openai",
    surface: "cli",
    model: "gpt-5.6-sol",
  });
  await fixture.manager.getAllConfigs();
  const stored = await readStoredConfig(fixture);
  await fixture.store.writeJson("agent_config.jsonc", {
    ...stored,
    agents: {
      ...stored.agents,
      coder: {
        status: "configured",
        provider: "openai",
        surface: "cli",
        model: "gpt-5.6-sol",
        settings: { unsupported: true },
      },
    },
  });

  assert.equal(
    (await fixture.manager.validateAgent("questioner")).agent,
    "questioner",
  );
  await assert.rejects(
    fixture.manager.validateAgent("coder"),
    InvalidAgentSettingError,
  );
});

test("valid siblings remain usable when one persisted entry is malformed", async (t) => {
  const fixture = await createFixture(t);
  await fixture.manager.setConfigured("questioner", {
    provider: "openai",
    surface: "cli",
    model: "gpt-5.6-sol",
  });
  const stored = await readStoredConfig(fixture);
  await fixture.store.writeJson("agent_config.jsonc", {
    ...stored,
    agents: { ...stored.agents, coder: { status: "broken" } },
  });

  assert.equal(
    (await fixture.manager.validateAgent("questioner")).provider,
    "openai",
  );
  await assert.rejects(
    fixture.manager.getConfig("coder"),
    (error: unknown) =>
      error instanceof InvalidAgentConfigError &&
      error.code === "INVALID_AGENT_CONFIG",
  );
});

test("unconfigured agents return a stable validation error", async (t) => {
  const fixture = await createFixture(t);

  await assert.rejects(
    fixture.manager.validateAgent("examiner"),
    (error: unknown) =>
      error instanceof AgentUnconfiguredError &&
      error.code === "AGENT_UNCONFIGURED",
  );
});

test("provider removal transitions only matching configured agents", async (t) => {
  const fixture = await createFixture(t);
  await fixture.manager.setConfigured("questioner", {
    provider: "openai",
    surface: "cli",
    model: "gpt-5.6-sol",
  });
  await seedHistoricalConfig(fixture, "researcher", {
    provider: "openai",
    surface: "vscode",
    model: "gpt-research",
  });
  const coder = await fixture.manager.setConfigured("coder", {
    provider: "anthropic",
    surface: "cli",
    model: "claude-sonnet-4-5",
  });
  await seedHistoricalConfig(fixture, "reviewer", {
    provider: "google",
    surface: "vscode",
    model: "gemini-example",
  });
  const reviewer = await fixture.manager.getConfig("reviewer");

  const state = await fixture.manager.removeProvider("openai");

  assert.deepEqual(state.questioner, {
    status: "removed",
    reason: "provider_removed",
    previousProvider: "openai",
  });
  assert.deepEqual(state.researcher, state.questioner);
  assert.deepEqual(state.coder, coder);
  assert.deepEqual(state.reviewer, reviewer);
  assert.deepEqual(state.examiner, { status: "unconfigured" });
});

test("removed state persists, validates stably, and is not automatically restored", async (t) => {
  const fixture = await createFixture(t);
  await fixture.manager.setConfigured("questioner", {
    provider: "openai",
    surface: "cli",
    model: "gpt-5.6-sol",
  });
  await fixture.manager.removeProvider("openai");
  const beforeRepeat = await readFile(
    join(fixture.root, "agent_config.jsonc"),
    "utf8",
  );
  await newManager(fixture).removeProvider("openai");
  assert.equal(
    await readFile(join(fixture.root, "agent_config.jsonc"), "utf8"),
    beforeRepeat,
  );

  await newManager(fixture).setConfigured("examiner", {
    provider: "openai",
    surface: "cli",
    model: "gpt-5.6-terra",
  });
  assert.equal((await newManager(fixture).getConfig("questioner")).status, "removed");
  await assert.rejects(
    newManager(fixture).validateAgent("questioner"),
    (error: unknown) =>
      error instanceof AgentConfigurationRemovedError &&
      error.code === "AGENT_CONFIGURATION_REMOVED" &&
      error.details?.previousProvider === "openai" &&
      error.details.reason === "provider_removed",
  );
});

test("marking an agent unconfigured discards its previous configuration", async (t) => {
  const fixture = await createFixture(t);
  await seedHistoricalConfig(fixture, "planner", {
    provider: "google",
    surface: "cli",
    model: "gemini-example",
  });

  await fixture.manager.markUnconfigured("planner");

  assert.deepEqual(await fixture.manager.getConfig("planner"), {
    status: "unconfigured",
  });
});

test("malformed JSONC returns a stable global config error", async (t) => {
  const fixture = await createFixture(t);
  await writeFile(join(fixture.root, "agent_config.jsonc"), "{ malformed", "utf8");

  await assert.rejects(
    fixture.manager.getConfig("questioner"),
    (error: unknown) =>
      error instanceof InvalidAgentConfigError &&
      error.code === "INVALID_AGENT_CONFIG",
  );
});

test("existing user-edited JSONC is not overwritten during initialization", async (t) => {
  const fixture = await createFixture(t);
  const manual = `{
  // User-owned formatting and comments remain until an explicit mutation.
  "version": 1,
  "agents": {
    "questioner": { "status": "configured", "provider": "openai", "surface": "cli", "model": "manual-model" },
    "researcher": { "status": "unconfigured" },
    "examiner": { "status": "unconfigured" },
    "planner": { "status": "unconfigured" },
    "coder": { "status": "unconfigured" },
    "reviewer": { "status": "unconfigured" },
  },
}\n`;
  await writeFile(join(fixture.root, "agent_config.jsonc"), manual, "utf8");

  const configured = await fixture.manager.getConfig("questioner");
  assert.equal(configured.status === "configured" ? configured.model : null, "manual-model");
  await assert.rejects(
    fixture.manager.validateAgent("questioner"),
    InvalidAgentModelError,
  );
  assert.equal(
    await readFile(join(fixture.root, "agent_config.jsonc"), "utf8"),
    manual,
  );
});

test("concurrent whole-file mutations leave a complete valid configuration", async (t) => {
  const fixture = await createFixture(t);
  await fixture.manager.getAllConfigs();
  await Promise.all([
    fixture.manager.setConfigured("questioner", {
      provider: "openai",
      surface: "cli",
      model: "gpt-5.6-sol",
    }),
    newManager(fixture).setConfigured("coder", {
      provider: "anthropic",
      surface: "cli",
      model: "claude-sonnet-5",
    }),
  ]);

  const state: AgentConfigState = await newManager(fixture).getAllConfigs();
  assert.equal(Object.keys(state).length, 6);
  assert.ok(
    state.questioner.status === "configured" ||
      state.coder.status === "configured",
  );
});
