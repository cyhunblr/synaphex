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
  "gpt-5.5",
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

const OPENAI_EFFORT_MATRIX: Record<
  (typeof OPENAI_MODELS)[number],
  readonly string[]
> = {
  "gpt-5.6-sol": ["low", "medium", "high", "xhigh"],
  "gpt-6-astra": ["low", "medium", "high", "xhigh"],
  "gpt-5.6-terra": ["low", "medium", "high", "xhigh"],
  "gpt-5.6-luna": ["low", "medium", "high", "xhigh"],
  "gpt-5.5": ["low", "medium", "high", "xhigh"],
};

const ANTHROPIC_EFFORT_MATRIX: Record<
  (typeof ANTHROPIC_MODELS)[number],
  readonly string[]
> = {
  "claude-opus-5": ["low", "medium", "high", "xhigh", "max"],
  "claude-sonnet-5": ["low", "medium", "high", "xhigh", "max"],
  "claude-fable-5-1": ["low", "medium", "high", "xhigh", "max"],
  "claude-fable-5": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-4-8": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-4-7": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-4-6": ["low", "medium", "high", "max"],
  "claude-opus-4-5-20251101": ["low", "medium", "high"],
  "claude-sonnet-4-6": ["low", "medium", "high", "max"],
  "claude-sonnet-4-5": [],
  "claude-haiku-4-5-20251001": [],
};

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

test("each OpenAI model exposes only its certified Codex reasoning effort domain", () => {
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
        values: OPENAI_EFFORT_MATRIX[modelId],
        required: false,
        omission: "provider_native",
        executorBinding: {
          kind: "codex_config",
          key: "model_reasoning_effort",
        },
      },
    );
  }
});

test("each Anthropic model exposes its exact certified effort domain", () => {
  for (const modelId of ANTHROPIC_MODELS) {
    const expectedValues = ANTHROPIC_EFFORT_MATRIX[modelId];
    const setting = getProviderModelCapability(
      "anthropic",
      "cli",
      modelId,
    )?.settings[0];
    if (expectedValues.length === 0) {
      assert.deepEqual(
        getProviderModelCapability("anthropic", "cli", modelId)?.settings,
        [],
      );
      continue;
    }
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
        key: "effort",
        scope: "model",
        type: "enum",
        values: expectedValues,
        required: false,
        omission: "provider_native",
        executorBinding: {
          kind: "claude_argument",
          flag: "--effort",
        },
      },
    );
  }
});

test("gpt-5.5 is supported explicitly but is not a recommended default", () => {
  const model = getProviderModelCapability("openai", "cli", "gpt-5.5");
  assert.equal(model?.supportTier, "supported");
  assert.deepEqual(
    model?.settings[0]?.values.map((entry) => entry.value),
    OPENAI_EFFORT_MATRIX["gpt-5.5"],
  );
});

test("retired, deprecated, preview, and duplicate OpenAI IDs are not authorable", () => {
  for (const model of [
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.2",
    "gpt-5.3-codex",
    "gpt-5.3-codex-spark",
    "gpt-5.6",
  ]) {
    assert.throws(
      () => authoring.validateForAuthoring("coder", {
        status: "configured",
        provider: "openai",
        surface: "cli",
        model,
      }),
      InvalidAgentModelError,
      model,
    );
  }
});

test("authoring accepts every active model with a value from its own setting domain", () => {
  for (const model of OPENAI_MODELS) {
    assert.equal(
      authoring.validateForAuthoring("researcher", {
        status: "configured",
        provider: "openai",
        surface: "cli",
        model,
        settings: { reasoning_effort: OPENAI_EFFORT_MATRIX[model][0]! },
      }).model,
      model,
    );
  }
  for (const model of ANTHROPIC_MODELS) {
    const effort = ANTHROPIC_EFFORT_MATRIX[model][0];
    assert.equal(
      authoring.validateForAuthoring("researcher", {
        status: "configured",
        provider: "anthropic",
        surface: "cli",
        model,
        ...(effort === undefined ? {} : { settings: { effort } }),
      }).model,
      model,
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
  assert.equal(
    authoring.validateForAuthoring("researcher", {
      status: "configured",
      provider: "openai",
      surface: "cli",
      model: "gpt-5.5",
      settings: { reasoning_effort: "xhigh" },
    }).model,
    "gpt-5.5",
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

test("mutation guard: OpenAI model constraints reject API-only and uncertified values", () => {
  for (const [model, value] of [
    ["gpt-6-astra", "max"],
    ["gpt-5.6-sol", "none"],
    ["gpt-5.5", "minimal"],
  ] as const) {
    assert.throws(
      () => runtime.validateForExecution("coder", {
        status: "configured",
        provider: "openai",
        surface: "cli",
        model,
        settings: { reasoning_effort: value },
      }),
      InvalidAgentSettingError,
      `${model}:${value}`,
    );
  }
});

test("mutation guard: Anthropic xhigh/max constraints and no-effort models fail closed", () => {
  assert.throws(
    () => authoring.validateForAuthoring("coder", {
      status: "configured",
      provider: "anthropic",
      surface: "cli",
      model: "claude-opus-4-6",
      settings: { effort: "xhigh" },
    }),
    InvalidAgentSettingError,
  );
  assert.throws(
    () => authoring.validateForAuthoring("coder", {
      status: "configured",
      provider: "anthropic",
      surface: "cli",
      model: "claude-opus-4-5-20251101",
      settings: { effort: "max" },
    }),
    InvalidAgentSettingError,
  );
  assert.throws(
    () => runtime.validateForExecution("coder", {
      status: "configured",
      provider: "anthropic",
      surface: "cli",
      model: "claude-sonnet-4-5",
      settings: { effort: "low" },
    }),
    InvalidAgentSettingError,
  );
});
