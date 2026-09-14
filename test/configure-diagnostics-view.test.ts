import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DiagnosticsView } from "../web/src/DiagnosticsView.js";
import type {
  DiagnosticsModel,
  ModelCapabilityCatalog,
} from "../web/src/api.js";

test("Diagnostics separates installation, host integration, targets, models, and capabilities", () => {
  const diagnostics: DiagnosticsModel = {
    nodeVersion: "v22.21.0",
    platform: "linux",
    providers: [
      provider("openai", "codex", "0.153.0", "codex_cli", "Codex CLI", true, [
        ["openai_cli", "Codex CLI"],
        ["openai_vscode", "Codex VS Code extension"],
      ]),
      provider("anthropic", "claude", "2.1.260", "claude_code_cli", "Claude Code CLI", true, [
        ["anthropic_cli", "Claude Code CLI"],
        ["anthropic_vscode", "Claude Code VS Code extension"],
      ]),
      provider("google", "agy", "1.1.27", "antigravity_cli", "Antigravity CLI", false, [
        ["google_cli", "Antigravity CLI"],
      ]),
    ],
  };
  const catalog: ModelCapabilityCatalog = {
    catalogVersion: 1,
    targets: [
      target("openai", "codex_cli", "Codex CLI", [
        model("openai-recommended", "OpenAI Recommended", "recommended", "Reasoning effort"),
        model("openai-supported", "OpenAI Supported", "supported", "Reasoning effort"),
      ]),
      target("anthropic", "claude_code_cli", "Claude Code CLI", [
        model("anthropic-recommended", "Anthropic Recommended", "recommended", "Effort"),
        model("anthropic-supported", "Anthropic Supported", "supported", "Effort"),
      ]),
      {
        ...target("google", "antigravity_cli", "Antigravity CLI", []),
        support: "unavailable",
        executionPolicy: {
          sourceModification: "unavailable",
          network: "unavailable",
          toolRestrictions: "unavailable",
        },
        unavailableReason: "Invocation policy unavailable.",
      },
    ],
  };

  const html = renderToStaticMarkup(
    createElement(DiagnosticsView, { diagnostics, catalog, status: null }),
  );

  for (const expected of [
    "System",
    "Installation",
    "Host Integration",
    "Execution Targets",
    "Models",
    "Capabilities",
    "Runtime readiness",
    "Recommended (1)",
    "Other supported (1)",
    "Reasoning effort",
    "Effort",
    "Codex VS Code extension",
    "Claude Code VS Code extension",
    "Host only",
    "No executable model catalog",
  ]) {
    assert.ok(html.includes(expected), expected);
  }

  const googleCard = /<article class="provider-card" data-provider="google">([\s\S]*?)<\/article>/.exec(html)?.[1];
  assert.ok(googleCard, "Google provider card");
  assert.ok(googleCard.includes("Antigravity CLI"));
  assert.ok(googleCard.includes("Unavailable"));
  assert.ok(googleCard.includes("Invocation policy unavailable"));
  assert.equal(html.includes("Configured executable agents"), false);
  assert.equal(html.includes(">true<"), false);
  assert.equal(html.includes(">false<"), false);
});

function provider(
  providerName: string,
  runtime: string,
  version: string,
  targetId: string,
  targetLabel: string,
  supportedAsTarget: boolean,
  surfaces: [string, string][],
) {
  return {
    provider: providerName,
    runtime: { id: runtime, installed: true, version },
    hostIntegration: {
      support: "supported" as const,
      registrationMinimum: version,
      registration: { state: "recorded" as const, source: "installation_manifest" as const },
      surfaces: surfaces.map(([id, label]) => ({
        id,
        label,
        surface: id.endsWith("vscode") ? "vscode" : "cli",
        detection: "shared_provider_registration",
        callableTarget: false as const,
      })),
    },
    executionTargets: [{
      id: targetId,
      label: targetLabel,
      support: supportedAsTarget ? "supported" as const : "unavailable" as const,
      executionPolicySupport: supportedAsTarget ? "supported" as const : "unavailable" as const,
      targetRuntimeReadiness: supportedAsTarget ? "ready" as const : "unavailable" as const,
      ...(supportedAsTarget ? {} : { unavailableReason: "Invocation policy unavailable." }),
    }],
  };
}

function target(
  provider: string,
  id: string,
  label: string,
  models: ModelCapabilityCatalog["targets"][number]["models"],
) {
  return {
    id,
    provider,
    label,
    runtime: id,
    persistedSurface: "cli" as const,
    support: "supported" as const,
    executionPolicy: {
      sourceModification: "invocation_scoped" as const,
      network: "invocation_scoped" as const,
      toolRestrictions: "invocation_scoped" as const,
    },
    models,
  };
}

function model(
  id: string,
  label: string,
  supportTier: "recommended" | "supported",
  settingLabel: string,
) {
  return {
    id,
    label,
    supportTier,
    settings: [{
      key: settingLabel.toLowerCase().replace(" ", "_"),
      label: settingLabel,
      description: "Configurable.",
      scope: "model" as const,
      type: "enum" as const,
      values: [{ value: "high", label: "high" }],
      required: false as const,
      omission: "provider_native" as const,
    }],
  };
}
