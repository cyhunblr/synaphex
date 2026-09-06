import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AgentConfigView,
  draftFor,
  findTarget,
  saveBodyForDraft,
  selectModel,
  selectProvider,
} from "../web/src/AgentConfigView.js";
import type {
  AgentModel,
  ModelCapabilityCatalog,
  ProviderDiagnostic,
} from "../web/src/api.js";

const catalog: ModelCapabilityCatalog = {
  catalogVersion: 1,
  targets: [
    {
      id: "codex_cli",
      provider: "openai",
      label: "Codex CLI",
      runtime: "codex",
      persistedSurface: "cli",
      support: "supported",
      executionPolicy: supportedPolicy(),
      models: [{
        id: "gpt-5.6-sol",
        label: "gpt-5.6-sol",
        supportTier: "recommended",
        settings: [{
          key: "reasoning_effort",
          label: "Reasoning effort",
          description: "Controls reasoning.",
          scope: "model",
          type: "enum",
          values: ["low", "medium", "high", "xhigh"].map((value) => ({ value, label: value })),
          required: false,
          omission: "provider_native",
        }],
      }],
    },
    {
      id: "claude_code_cli",
      provider: "anthropic",
      label: "Claude Code CLI",
      runtime: "claude",
      persistedSurface: "cli",
      support: "supported",
      executionPolicy: supportedPolicy(),
      models: [{ id: "claude-sonnet-4-5", label: "claude-sonnet-4-5", supportTier: "supported", settings: [] }],
    },
    {
      id: "antigravity_cli",
      provider: "google",
      label: "Antigravity CLI",
      runtime: "agy",
      persistedSurface: "cli",
      support: "unavailable",
      executionPolicy: {
        sourceModification: "unavailable",
        network: "unavailable",
        toolRestrictions: "unavailable",
      },
      unavailableReason: "Google agent execution is unavailable.",
      models: [],
    },
  ],
};

function supportedPolicy() {
  return {
    sourceModification: "invocation_scoped" as const,
    network: "invocation_scoped" as const,
    toolRestrictions: "invocation_scoped" as const,
  };
}

const providers: ProviderDiagnostic[] = [
  diagnostic("openai", true),
  diagnostic("anthropic", true),
  diagnostic("google", false),
];

function diagnostic(provider: string, supportedAsTarget: boolean): ProviderDiagnostic {
  return {
    provider,
    runtime: { id: provider, installed: true },
    hostIntegration: {
      support: "supported",
      registrationMinimum: "1",
      registration: { state: "recorded", source: "installation_manifest" },
      surfaces: [],
    },
    executionTargets: [{
      id: `${provider}_cli`,
      label: `${provider} CLI`,
      support: supportedAsTarget ? "supported" : "unavailable",
      executionPolicySupport: supportedAsTarget ? "supported" : "unavailable",
      targetRuntimeReadiness: supportedAsTarget ? "ready" : "unavailable",
      ...(supportedAsTarget ? {} : { unavailableReason: "Unavailable." }),
    }],
  };
}

function agent(overrides: Partial<AgentModel> = {}): AgentModel {
  return {
    agent: "coder",
    status: "configured",
    provider: "openai",
    surface: "cli",
    model: "gpt-5.6-sol",
    executable: true,
    contract: {
      mayModifySourceCode: true,
      mayWriteCanonicalMemory: false,
      forbiddenOutgoingTargets: [],
      taskBinding: "required",
      allowedTaskStatuses: ["active"],
    },
    ...overrides,
  };
}

function render(model: AgentModel): string {
  return renderToStaticMarkup(
    createElement(AgentConfigView, {
      agent: model,
      providers,
      catalog,
      edges: [],
      onClose: () => undefined,
      onSave: () => undefined,
      onClear: () => undefined,
      onRule: () => undefined,
    }),
  );
}

test("the actual OpenAI panel renders the catalog model and its enum setting", () => {
  const html = render(agent({ settings: { reasoning_effort: "high" } }));
  assert.match(html, /gpt-5\.6-sol · recommended · openai · cli · configurable/);
  assert.match(html, /id="setting-reasoning_effort"/);
  assert.match(html, /<option value="high" selected="">high<\/option>/);
  assert.doesNotMatch(html, /maximum/);
});

test("provider selection filters models and removes incompatible draft settings", () => {
  const openai = draftFor(agent({ settings: { reasoning_effort: "high" } }));
  const anthropic = selectProvider(openai, "anthropic", catalog);
  assert.deepEqual(anthropic, {
    provider: "anthropic",
    surface: "cli",
    model: "claude-sonnet-4-5",
    settings: {},
  });
  const html = render(agent({
    provider: "anthropic",
    model: "claude-sonnet-4-5",
  }));
  assert.match(html, /claude-sonnet-4-5 · supported · anthropic · cli/);
  assert.doesNotMatch(html, /setting-reasoning_effort/);
  assert.match(html, /Provider defaults are used/);
});

test("model selection removes settings not declared by the selected model", () => {
  const draft = draftFor(agent({ settings: { reasoning_effort: "xhigh" } }));
  const changed = selectModel(draft, "not-supported", findTarget(catalog, "openai", "cli"));
  assert.deepEqual(changed.settings, {});
});

test("legacy and unavailable targets are explained without an executable model selector", () => {
  const unknown = render(agent({ model: "future-model" }));
  assert.match(unknown, /future-model — unrecognized legacy value/);
  assert.match(unknown, /Configured model is not recognized/);
  assert.match(unknown, /<button class="btn primary" disabled="">Save<\/button>/);

  const google = render(agent({ provider: "google", model: "legacy-google", executable: false }));
  assert.match(google, /Google agent execution is unavailable/);
  assert.doesNotMatch(google, /<label for="model">Model<\/label>/);

  const vscode = render(agent({ surface: "vscode", model: "legacy", executable: false }));
  assert.match(vscode, /vscode — legacy, not executable/);
  assert.match(vscode, /VS Code is not an invocation target/);
});

test("canonical save bodies omit native defaults and include only selected settings", () => {
  assert.deepEqual(saveBodyForDraft({
    provider: "openai",
    surface: "cli",
    model: "gpt-5.6-sol",
    settings: {},
  }), { provider: "openai", surface: "cli", model: "gpt-5.6-sol" });
  assert.deepEqual(saveBodyForDraft({
    provider: "openai",
    surface: "cli",
    model: "gpt-5.6-sol",
    settings: { reasoning_effort: "low" },
  }), {
    provider: "openai",
    surface: "cli",
    model: "gpt-5.6-sol",
    settings: { reasoning_effort: "low" },
  });
});
