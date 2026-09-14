import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AgentConfigView,
  draftFor,
  findTarget,
  groupModels,
  saveBodyForDraft,
  selectModel,
  selectProvider,
} from "../web/src/AgentConfigView.js";
import type {
  AgentModel,
  ModelCapability,
  ModelCapabilityCatalog,
  ProviderDiagnostic,
} from "../web/src/api.js";

const reasoning = setting(
  "reasoning_effort",
  "Reasoning effort",
  ["low", "medium", "high", "xhigh"],
);
const extendedEffort = setting(
  "effort",
  "Effort",
  ["low", "medium", "high", "xhigh", "max"],
);
const baseAndMaxEffort = setting(
  "effort",
  "Effort",
  ["low", "medium", "high", "max"],
);

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
      models: [
        model("gpt-test-sol", "GPT Test Sol", "recommended", [reasoning]),
        model("gpt-test-astra", "GPT Test Astra", "supported", [reasoning]),
        model("gpt-test-terra", "GPT Test Terra", "supported", [reasoning]),
        model("gpt-test-luna", "GPT Test Luna", "supported", [reasoning]),
        model("gpt-test-legacy", "GPT Test Legacy", "supported", [reasoning]),
      ],
    },
    {
      id: "claude_code_cli",
      provider: "anthropic",
      label: "Claude Code CLI",
      runtime: "claude",
      persistedSurface: "cli",
      support: "supported",
      executionPolicy: supportedPolicy(),
      models: [
        model("anthropic-test-extended", "Anthropic Test Extended", "recommended", [extendedEffort]),
        model("anthropic-test-max", "Anthropic Test Max", "supported", [baseAndMaxEffort]),
        model("anthropic-test-default", "Anthropic Test Default", "supported", []),
      ],
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
      unavailableReason: "Invocation-scoped execution policy cannot be enforced.",
      models: [],
    },
  ],
};

const providers: ProviderDiagnostic[] = [
  diagnostic("openai", "codex", "codex_cli", "Codex CLI", true),
  diagnostic("anthropic", "claude", "claude_code_cli", "Claude Code CLI", true),
  diagnostic("google", "agy", "antigravity_cli", "Antigravity CLI", false),
];

function agent(overrides: Partial<AgentModel> = {}): AgentModel {
  return {
    agent: "coder",
    status: "configured",
    provider: "openai",
    surface: "cli",
    model: "gpt-test-sol",
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

function render(value: AgentModel): string {
  return renderToStaticMarkup(
    createElement(AgentConfigView, {
      agent: value,
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

test("Agent panel renders callable target architecture and every backend model in tier groups", () => {
  const html = render(agent({ settings: { reasoning_effort: "high" } }));
  for (const expected of [
    "Agent",
    "Provider",
    "Execution Target",
    "Codex CLI",
    "Recommended",
    "Other supported",
    "GPT Test Sol",
    "GPT Test Astra",
    "GPT Test Terra",
    "GPT Test Luna",
    "GPT Test Legacy",
    "Readiness",
  ]) {
    assert.ok(html.includes(expected), expected);
  }
  assert.match(html, /<optgroup label="Recommended">/);
  assert.match(html, /<optgroup label="Other supported">/);
  assert.match(html, /id="setting-reasoning_effort"/);
  assert.match(html, /<option value="high" selected="">high<\/option>/);
  assert.doesNotMatch(html, /<label for="surface">/);
  assert.doesNotMatch(html, /<option value="vscode"/);
  assert.deepEqual(groupModels(findTarget(catalog, "openai", "cli")).recommended.map((entry) => entry.id), [
    "gpt-test-sol",
  ]);
});

test("provider selection derives its execution target and removes incompatible settings", () => {
  const openai = draftFor(agent({ settings: { reasoning_effort: "high" } }), catalog);
  const anthropic = selectProvider(openai, "anthropic", catalog);
  assert.deepEqual(anthropic, {
    provider: "anthropic",
    targetId: "claude_code_cli",
    surface: "cli",
    model: "anthropic-test-extended",
    settings: {},
  });

  const anthropicHtml = render(agent({
    provider: "anthropic",
    model: "anthropic-test-extended",
    settings: { effort: "xhigh" },
  }));
  assert.match(anthropicHtml, /Claude Code CLI/);
  assert.match(anthropicHtml, /id="setting-effort"/);
  assert.match(anthropicHtml, /<option value="xhigh" selected="">xhigh<\/option>/);

  const googleHtml = render(agent({ provider: "google", model: "", executable: false }));
  assert.match(googleHtml, /Antigravity CLI — unavailable/);
  assert.match(googleHtml, /Invocation-scoped execution policy cannot be enforced/);
  assert.doesNotMatch(googleHtml, /<label for="model">/);
  assert.match(googleHtml, /<button class="btn primary" disabled="">Save<\/button>/);
});

test("Claude setting controls vary by model and omit fake controls for empty metadata", () => {
  const maxHtml = render(agent({
    provider: "anthropic",
    model: "anthropic-test-max",
    settings: { effort: "max" },
  }));
  assert.match(maxHtml, /id="setting-effort"/);
  assert.doesNotMatch(maxHtml, /value="xhigh"/);
  assert.match(maxHtml, /value="max" selected=""/);

  const defaultHtml = render(agent({
    provider: "anthropic",
    model: "anthropic-test-default",
  }));
  assert.doesNotMatch(defaultHtml, /id="setting-effort"/);
  assert.match(defaultHtml, /Provider defaults are used/);
});

test("model switching prunes settings by allowed value as well as setting name", () => {
  const target = findTarget(catalog, "anthropic", "cli");
  const initial = draftFor(agent({
    provider: "anthropic",
    model: "anthropic-test-extended",
    settings: { effort: "xhigh" },
  }), catalog);
  assert.deepEqual(
    selectModel(initial, "anthropic-test-max", target).settings,
    {},
  );
  assert.deepEqual(
    selectModel(
      { ...initial, settings: { effort: "high" } },
      "anthropic-test-max",
      target,
    ).settings,
    { effort: "high" },
  );
});

test("historical surfaces and unknown models remain visible but cannot masquerade as executable", () => {
  const vscode = render(agent({ surface: "vscode", model: "historical-model", executable: false }));
  assert.match(vscode, /Legacy configuration/);
  assert.match(vscode, /VS Code is an interactive host integration/);
  assert.doesNotMatch(vscode, /<option value="vscode"/);
  assert.match(vscode, /<button class="btn primary" disabled="">Save<\/button>/);

  const unknown = render(agent({ model: "future-model", executable: false }));
  assert.match(unknown, /future-model — unvalidated legacy value/);
  assert.match(unknown, /Unvalidated \/ non-executable/);
  assert.match(unknown, /will not replace it automatically/);
});

test("canonical save bodies omit provider-native defaults", () => {
  assert.deepEqual(saveBodyForDraft({
    provider: "openai",
    targetId: "codex_cli",
    surface: "cli",
    model: "gpt-test-sol",
    settings: {},
  }), { provider: "openai", surface: "cli", model: "gpt-test-sol" });
  assert.deepEqual(saveBodyForDraft({
    provider: "anthropic",
    targetId: "claude_code_cli",
    surface: "cli",
    model: "anthropic-test-extended",
    settings: { effort: "low" },
  }), {
    provider: "anthropic",
    surface: "cli",
    model: "anthropic-test-extended",
    settings: { effort: "low" },
  });
});

test("React agent implementation contains no provider model identifiers", async () => {
  const source = await readFile(
    join(process.cwd(), "web", "src", "AgentConfigView.tsx"),
    "utf8",
  );
  assert.doesNotMatch(source, /gpt-[0-9]|claude-(?:opus|sonnet|haiku|fable)/);
});

function setting(key: string, label: string, values: string[]) {
  return {
    key,
    label,
    description: `Controls ${label}.`,
    scope: "model" as const,
    type: "enum" as const,
    values: values.map((value) => ({ value, label: value })),
    required: false as const,
    omission: "provider_native" as const,
  };
}

function model(
  id: string,
  label: string,
  supportTier: ModelCapability["supportTier"],
  settings: ModelCapability["settings"],
): ModelCapability {
  return { id, label, supportTier, settings };
}

function supportedPolicy() {
  return {
    sourceModification: "invocation_scoped" as const,
    network: "invocation_scoped" as const,
    toolRestrictions: "invocation_scoped" as const,
  };
}

function diagnostic(
  provider: string,
  runtime: string,
  targetId: string,
  targetLabel: string,
  supportedAsTarget: boolean,
): ProviderDiagnostic {
  return {
    provider,
    runtime: { id: runtime, installed: true },
    hostIntegration: {
      support: "supported",
      registrationMinimum: "1",
      registration: { state: "recorded", source: "installation_manifest" },
      surfaces: [],
    },
    executionTargets: [{
      id: targetId,
      label: targetLabel,
      support: supportedAsTarget ? "supported" : "unavailable",
      executionPolicySupport: supportedAsTarget ? "supported" : "unavailable",
      targetRuntimeReadiness: supportedAsTarget ? "ready" : "unavailable",
      ...(supportedAsTarget ? {} : { unavailableReason: "Unavailable." }),
    }],
  };
}
