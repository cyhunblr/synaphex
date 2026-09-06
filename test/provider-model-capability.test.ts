import assert from "node:assert/strict";
import test from "node:test";
import {
  StaticAgentAuthoringCapabilityValidator,
  StaticAgentRuntimeCapabilityValidator,
} from "../src/core/agent-capability-validator.js";
import {
  EXECUTION_TARGET_CAPABILITIES,
  PROVIDER_CAPABILITY_CATALOG_VERSION,
  PROVIDER_INTEGRATION_CAPABILITIES,
  findExecutionTargetCapability,
  getProviderIntegrationCapability,
  getProviderModelCapability,
} from "../src/core/provider-model-capability-registry.js";
import {
  AgentTargetSurfaceUnsupportedError,
  InvalidAgentConfigError,
  InvalidAgentModelError,
  InvalidAgentSettingError,
  ProviderExecutionPolicyUnsupportedError,
} from "../src/domain/errors.js";

const authoring = new StaticAgentAuthoringCapabilityValidator();
const runtime = new StaticAgentRuntimeCapabilityValidator();

const OPENAI_MODELS = [
  "gpt-5.6-sol",
  "gpt-6-astra",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
] as const;

const ANTHROPIC_MODELS = [
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-fable-5-1",
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-opus-4-5-20251101",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-haiku-4-5-20251001",
] as const;

test("the versioned authority separates provider integrations, hosts, and targets", () => {
  assert.equal(PROVIDER_CAPABILITY_CATALOG_VERSION, 1);
  assert.equal(PROVIDER_INTEGRATION_CAPABILITIES.length, 3);
  assert.equal(EXECUTION_TARGET_CAPABILITIES.length, 3);

  for (const integration of PROVIDER_INTEGRATION_CAPABILITIES) {
    assert.ok(integration.hostSurfaces.length > 0);
    assert.ok(integration.executionTargets.length > 0);
    for (const host of integration.hostSurfaces) {
      assert.equal(host.hostSupport, "supported");
      assert.equal(host.callableTarget, false);
    }
  }
});

test("VS Code is a shared-registration host integration and never a target", () => {
  for (const provider of ["openai", "anthropic"] as const) {
    const vscode = getProviderIntegrationCapability(provider).hostSurfaces.find(
      (surface) => surface.surface === "vscode",
    );
    assert.equal(vscode?.detection, "shared_provider_registration");
    assert.equal(vscode?.callableTarget, false);
    assert.equal(findExecutionTargetCapability(provider, "vscode"), undefined);
  }
  assert.equal(
    EXECUTION_TARGET_CAPABILITIES.some((target) =>
      target.label.toLowerCase().includes("vs code"),
    ),
    false,
  );
});

test("Google hosting is supported while its execution target fails closed", () => {
  const google = getProviderIntegrationCapability("google");
  assert.equal(google.hostSurfaces[0]?.hostSupport, "supported");
  const target = findExecutionTargetCapability("google", "cli")!;
  assert.equal(target.support, "unavailable");
  assert.equal(target.executionPolicy.sourceModification, "unavailable");
  assert.equal(target.executionPolicy.network, "unavailable");
  assert.deepEqual(target.models, []);
  assert.match(target.unavailableReason ?? "", /invocation-scoped/);
});

test("the offline target catalogs contain the certified multi-model sets", () => {
  assert.deepEqual(
    findExecutionTargetCapability("openai", "cli")?.models.map((model) => model.id),
    OPENAI_MODELS,
  );
  assert.deepEqual(
    findExecutionTargetCapability("anthropic", "cli")?.models.map((model) => model.id),
    ANTHROPIC_MODELS,
  );
});

test("every active model carries complete compatibility evidence and a support tier", () => {
  for (const target of EXECUTION_TARGET_CAPABILITIES) {
    for (const model of target.models) {
      assert.equal(model.targetId, target.id);
      assert.ok(["recommended", "supported"].includes(model.supportTier));
      assert.deepEqual(model.compatibility, {
        providerRecognition: "official_current_documentation",
        cliInvocation: "official_cli_documentation",
        structuredResult: "provider_schema_contract",
        executionPolicy: "target_policy_enforced",
        deterministicAdapterCoverage: true,
      });
    }
  }
});

test("reasoning effort is allowlisted only on certified OpenAI models", () => {
  for (const modelId of OPENAI_MODELS) {
    const setting = getProviderModelCapability(
      "openai",
      "cli",
      modelId,
    )?.settings[0];
    assert.deepEqual(
      setting === undefined
        ? undefined
        : {
            key: setting.key,
            scope: setting.scope,
            type: setting.type,
            values: setting.values.map((value) => value.value),
            required: setting.required,
            omission: setting.omission,
            executorBinding: setting.executorBinding,
          },
      {
        key: "reasoning_effort",
        scope: "model",
        type: "enum",
        values: ["low", "medium", "high", "xhigh"],
        required: false,
        omission: "provider_native",
        executorBinding: {
          kind: "codex_config",
          key: "model_reasoning_effort",
        },
      },
    );
  }
  for (const modelId of ANTHROPIC_MODELS) {
    assert.deepEqual(
      getProviderModelCapability("anthropic", "cli", modelId)?.settings,
      [],
    );
  }
});

test("authoring accepts supported models and rejects unknown, VS Code, and Google targets", () => {
  assert.equal(
    authoring.validateForAuthoring("coder", {
      status: "configured",
      provider: "openai",
      surface: "cli",
      model: "gpt-5.6-terra",
      settings: { reasoning_effort: "high" },
    }).model,
    "gpt-5.6-terra",
  );
  assert.throws(
    () => authoring.validateForAuthoring("coder", {
      status: "configured",
      provider: "openai",
      surface: "cli",
      model: "future-model",
    }),
    InvalidAgentModelError,
  );
  assert.throws(
    () => authoring.validateForAuthoring("coder", {
      status: "configured",
      provider: "openai",
      surface: "vscode",
      model: "gpt-5.6-sol",
    }),
    InvalidAgentConfigError,
  );
  assert.throws(
    () => authoring.validateForAuthoring("coder", {
      status: "configured",
      provider: "google",
      surface: "cli",
      model: "gemini-example",
    }),
    InvalidAgentConfigError,
  );
});

test("runtime defensively revalidates target, model, and settings", () => {
  assert.equal(
    runtime.validateForExecution("researcher", {
      status: "configured",
      provider: "anthropic",
      surface: "cli",
      model: "claude-haiku-4-5-20251001",
    }).model,
    "claude-haiku-4-5-20251001",
  );
  assert.throws(
    () => runtime.validateForExecution("coder", {
      status: "configured",
      provider: "openai",
      surface: "cli",
      model: "future-model",
    }),
    InvalidAgentModelError,
  );
  assert.throws(
    () => runtime.validateForExecution("coder", {
      status: "configured",
      provider: "openai",
      surface: "vscode",
      model: "gpt-5.6-sol",
    }),
    AgentTargetSurfaceUnsupportedError,
  );
  assert.throws(
    () => runtime.validateForExecution("coder", {
      status: "configured",
      provider: "google",
      surface: "cli",
      model: "historical-google-model",
    }),
    ProviderExecutionPolicyUnsupportedError,
  );
});

test("mutation guard: moving an exposed setting to an incompatible model fails closed", () => {
  assert.throws(
    () => authoring.validateForAuthoring("coder", {
      status: "configured",
      provider: "anthropic",
      surface: "cli",
      model: "claude-sonnet-5",
      settings: { reasoning_effort: "high" },
    }),
    InvalidAgentSettingError,
  );
  assert.throws(
    () => runtime.validateForExecution("coder", {
      status: "configured",
      provider: "openai",
      surface: "cli",
      model: "gpt-5.6-luna",
      settings: { reasoning_effort: "maximum" },
    }),
    InvalidAgentSettingError,
  );
});
