import assert from "node:assert/strict";
import test from "node:test";
import { StaticAgentCapabilityValidator } from "../src/core/agent-capability-validator.js";
import {
  getProviderModelCapability,
  getProviderTargetCapability,
  PROVIDER_TARGET_CAPABILITIES,
} from "../src/core/provider-model-capability-registry.js";
import {
  InvalidAgentModelError,
  InvalidAgentSettingError,
} from "../src/domain/errors.js";

const validator = new StaticAgentCapabilityValidator();

test("the offline registry exposes the supported OpenAI and Anthropic CLI models", () => {
  assert.deepEqual(
    getProviderTargetCapability("openai", "cli").models.map((model) => model.model),
    ["gpt-5.6-sol"],
  );
  assert.deepEqual(
    getProviderTargetCapability("anthropic", "cli").models.map((model) => model.model),
    ["claude-sonnet-4-5"],
  );
  assert.equal(PROVIDER_TARGET_CAPABILITIES.length, 6);
});

test("unavailable surfaces and the Google target have no executable models", () => {
  for (const target of [
    getProviderTargetCapability("openai", "vscode"),
    getProviderTargetCapability("anthropic", "vscode"),
    getProviderTargetCapability("google", "cli"),
    getProviderTargetCapability("google", "vscode"),
  ]) {
    assert.equal(target.executionAvailability, "unavailable");
    assert.deepEqual(target.models, []);
    assert.ok((target.unavailableReason?.length ?? 0) > 20);
  }
});

test("gpt-5.6-sol projects its exact optional reasoning effort domain", () => {
  const model = getProviderModelCapability("openai", "cli", "gpt-5.6-sol")!;
  assert.deepEqual(model.settings.map((setting) => ({
    key: setting.key,
    type: setting.type,
    values: setting.values.map((value) => value.value),
    required: setting.required,
    defaultBehavior: setting.defaultBehavior,
  })), [{
    key: "reasoning_effort",
    type: "enum",
    values: ["low", "medium", "high", "xhigh"],
    required: false,
    defaultBehavior: "provider_native",
  }]);
});

test("omitted optional settings remain omitted and explicit valid settings survive", () => {
  const omitted = validator.validate("coder", {
    status: "configured",
    provider: "openai",
    surface: "cli",
    model: "gpt-5.6-sol",
  });
  assert.equal(Object.hasOwn(omitted, "settings"), false);
  const explicit = validator.validate("coder", {
    status: "configured",
    provider: "openai",
    surface: "cli",
    model: "gpt-5.6-sol",
    settings: { reasoning_effort: "high" },
  });
  assert.deepEqual(explicit.settings, { reasoning_effort: "high" });
});

test("unknown setting names, invalid values, and model-incompatible settings fail closed", () => {
  for (const config of [
    {
      status: "configured" as const,
      provider: "openai" as const,
      surface: "cli" as const,
      model: "gpt-5.6-sol",
      settings: { temperature: 1 },
    },
    {
      status: "configured" as const,
      provider: "openai" as const,
      surface: "cli" as const,
      model: "gpt-5.6-sol",
      settings: { reasoning_effort: "maximum" },
    },
    {
      status: "configured" as const,
      provider: "anthropic" as const,
      surface: "cli" as const,
      model: "claude-sonnet-4-5",
      settings: { reasoning_effort: "high" },
    },
  ]) {
    assert.throws(() => validator.validate("coder", config), InvalidAgentSettingError);
  }
});

test("an unknown model on an executable target is rejected without widening the catalog", () => {
  assert.throws(
    () => validator.validate("coder", {
      status: "configured",
      provider: "openai",
      surface: "cli",
      model: "future-model",
    }),
    InvalidAgentModelError,
  );
});

test("historical unavailable-target entries remain readable but cannot gain settings", () => {
  assert.equal(validator.validate("coder", {
    status: "configured",
    provider: "google",
    surface: "cli",
    model: "historical-google-model",
  }).model, "historical-google-model");
  assert.throws(() => validator.validate("coder", {
    status: "configured",
    provider: "google",
    surface: "cli",
    model: "historical-google-model",
    settings: { effort: "high" },
  }), InvalidAgentSettingError);
});
