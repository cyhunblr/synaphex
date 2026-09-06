import type {
  AgentProvider,
  AgentSettings,
  AgentSurface,
} from "../domain/agent-config.js";
import {
  PROVIDER_CAPABILITY_CATALOG_VERSION,
  type ExecutionTargetCapability,
  type ExecutionTargetId,
  type HostSurfaceCapability,
  type ModelCapability,
  type ModelCompatibilityEvidence,
  type ProviderIntegrationCapability,
  type SettingCapability,
} from "../domain/provider-capability.js";

export { PROVIDER_CAPABILITY_CATALOG_VERSION };
export type {
  ExecutionTargetCapability,
  HostSurfaceCapability,
  ModelCapability,
  ProviderIntegrationCapability,
  SettingCapability,
};

const COMPATIBILITY_EVIDENCE: ModelCompatibilityEvidence = Object.freeze({
  providerRecognition: "official_current_documentation",
  cliInvocation: "official_cli_documentation",
  structuredResult: "provider_schema_contract",
  executionPolicy: "target_policy_enforced",
  deterministicAdapterCoverage: true,
});

const OPENAI_REASONING_EFFORT: SettingCapability = Object.freeze({
  key: "reasoning_effort",
  label: "Reasoning effort",
  description: "Controls how much reasoning effort Codex applies.",
  scope: "model",
  type: "enum",
  values: Object.freeze(
    ["low", "medium", "high", "xhigh"].map((value) =>
      Object.freeze({ value, label: value }),
    ),
  ),
  required: false,
  omission: "provider_native",
  executorBinding: Object.freeze({
    kind: "codex_config",
    key: "model_reasoning_effort",
  }),
});

export const GOOGLE_EXECUTION_UNAVAILABLE_REASON =
  "Antigravity exposes no invocation-scoped execution policy, so Synaphex cannot enforce its immutable role contract for a single invocation.";

const HOST_SURFACES: readonly HostSurfaceCapability[] = Object.freeze([
  host("codex_cli", "openai", "Codex CLI", "cli", "shared_provider_registration"),
  host(
    "codex_vscode",
    "openai",
    "Codex VS Code extension",
    "vscode",
    "shared_provider_registration",
  ),
  host("claude_cli", "anthropic", "Claude Code CLI", "cli", "shared_provider_registration"),
  host(
    "claude_vscode",
    "anthropic",
    "Claude Code VS Code extension",
    "vscode",
    "shared_provider_registration",
  ),
  host("antigravity_cli", "google", "Antigravity CLI", "cli", "provider_registration"),
]);

const OPENAI_MODELS: readonly ModelCapability[] = Object.freeze([
  model("gpt-5.6-sol", "GPT-5.6 Sol", "codex_cli", "recommended", [OPENAI_REASONING_EFFORT]),
  model("gpt-6-astra", "GPT-6 Astra", "codex_cli", "supported", [OPENAI_REASONING_EFFORT]),
  model("gpt-5.6-terra", "GPT-5.6 Terra", "codex_cli", "supported", [OPENAI_REASONING_EFFORT]),
  model("gpt-5.6-luna", "GPT-5.6 Luna", "codex_cli", "supported", [OPENAI_REASONING_EFFORT]),
]);

const ANTHROPIC_MODELS: readonly ModelCapability[] = Object.freeze([
  model("claude-opus-5", "Claude Opus 5", "claude_code_cli", "recommended", []),
  model("claude-sonnet-5", "Claude Sonnet 5", "claude_code_cli", "recommended", []),
  model("claude-fable-5-1", "Claude Fable 5.1", "claude_code_cli", "supported", []),
  model("claude-fable-5", "Claude Fable 5", "claude_code_cli", "supported", []),
  model("claude-opus-4-8", "Claude Opus 4.8", "claude_code_cli", "supported", []),
  model("claude-opus-4-7", "Claude Opus 4.7", "claude_code_cli", "supported", []),
  model("claude-opus-4-6", "Claude Opus 4.6", "claude_code_cli", "supported", []),
  model(
    "claude-opus-4-5-20251101",
    "Claude Opus 4.5",
    "claude_code_cli",
    "supported",
    [],
  ),
  model("claude-sonnet-4-6", "Claude Sonnet 4.6", "claude_code_cli", "supported", []),
  // This official alias is the existing live-validated v0.1 value. Removing
  // it in a later catalog preserves it as historical rather than rewriting it.
  model(
    "claude-sonnet-4-5",
    "Claude Sonnet 4.5",
    "claude_code_cli",
    "supported",
    [],
  ),
  model(
    "claude-haiku-4-5-20251001",
    "Claude Haiku 4.5",
    "claude_code_cli",
    "supported",
    [],
  ),
]);

export const EXECUTION_TARGET_CAPABILITIES: readonly ExecutionTargetCapability[] =
  Object.freeze([
    supportedTarget("codex_cli", "openai", "Codex CLI", "codex", OPENAI_MODELS),
    supportedTarget(
      "claude_code_cli",
      "anthropic",
      "Claude Code CLI",
      "claude",
      ANTHROPIC_MODELS,
    ),
    Object.freeze({
      id: "antigravity_cli",
      provider: "google",
      label: "Antigravity CLI",
      runtime: "agy",
      persistedSurface: "cli",
      support: "unavailable",
      executionPolicy: Object.freeze({
        sourceModification: "unavailable",
        network: "unavailable",
        toolRestrictions: "unavailable",
      }),
      unavailableReason: GOOGLE_EXECUTION_UNAVAILABLE_REASON,
      models: Object.freeze([]),
    }),
  ]);

export const PROVIDER_INTEGRATION_CAPABILITIES: readonly ProviderIntegrationCapability[] =
  Object.freeze([
    integration("openai", "codex", ["codex_cli", "codex_vscode"], ["codex_cli"]),
    integration(
      "anthropic",
      "claude",
      ["claude_cli", "claude_vscode"],
      ["claude_code_cli"],
    ),
    integration("google", "agy", ["antigravity_cli"], ["antigravity_cli"]),
  ]);

export function getProviderIntegrationCapability(
  provider: AgentProvider,
): ProviderIntegrationCapability {
  return PROVIDER_INTEGRATION_CAPABILITIES.find(
    (entry) => entry.provider === provider,
  )!;
}

export function getExecutionTargetCapability(
  id: ExecutionTargetId,
): ExecutionTargetCapability {
  return EXECUTION_TARGET_CAPABILITIES.find((entry) => entry.id === id)!;
}

/** Maps the legacy persistence tuple to a canonical CLI execution target. */
export function findExecutionTargetCapability(
  provider: AgentProvider,
  surface: AgentSurface,
): ExecutionTargetCapability | undefined {
  if (surface !== "cli") return undefined;
  return EXECUTION_TARGET_CAPABILITIES.find(
    (entry) => entry.provider === provider,
  );
}

export function getProviderModelCapability(
  provider: AgentProvider,
  surface: AgentSurface,
  modelId: string,
): ModelCapability | undefined {
  return findExecutionTargetCapability(provider, surface)?.models.find(
    (entry) => entry.id === modelId,
  );
}

export function validateModelSettings(
  capability: ModelCapability,
  settings: AgentSettings | undefined,
): Readonly<{ setting?: string; reason?: string }> {
  if (settings === undefined) return {};
  for (const [key, value] of Object.entries(settings)) {
    const setting = capability.settings.find((entry) => entry.key === key);
    if (setting === undefined) {
      return { setting: key, reason: "setting is not supported by this model" };
    }
    if (
      typeof value !== "string" ||
      !setting.values.some((candidate) => candidate.value === value)
    ) {
      return {
        setting: key,
        reason: `value must be one of: ${setting.values.map((entry) => entry.value).join(", ")}`,
      };
    }
  }
  return {};
}

function host(
  id: HostSurfaceCapability["id"],
  provider: AgentProvider,
  label: string,
  surface: AgentSurface,
  detection: HostSurfaceCapability["detection"],
): HostSurfaceCapability {
  return Object.freeze({
    id,
    provider,
    label,
    surface,
    hostSupport: "supported" as const,
    detection,
    callableTarget: false as const,
  });
}

function model(
  id: string,
  label: string,
  targetId: ExecutionTargetId,
  supportTier: ModelCapability["supportTier"],
  settings: readonly SettingCapability[],
): ModelCapability {
  return Object.freeze({
    id,
    label,
    targetId,
    supportTier,
    settings: Object.freeze([...settings]),
    compatibility: COMPATIBILITY_EVIDENCE,
  });
}

function supportedTarget(
  id: ExecutionTargetId,
  provider: AgentProvider,
  label: string,
  runtime: ExecutionTargetCapability["runtime"],
  models: readonly ModelCapability[],
): ExecutionTargetCapability {
  return Object.freeze({
    id,
    provider,
    label,
    runtime,
    persistedSurface: "cli" as const,
    support: "supported" as const,
    executionPolicy: Object.freeze({
      sourceModification: "invocation_scoped" as const,
      network: "invocation_scoped" as const,
      toolRestrictions: "invocation_scoped" as const,
    }),
    models: Object.freeze([...models]),
  });
}

function integration(
  provider: AgentProvider,
  runtime: ProviderIntegrationCapability["runtime"],
  hostIds: readonly HostSurfaceCapability["id"][],
  targetIds: readonly ExecutionTargetId[],
): ProviderIntegrationCapability {
  return Object.freeze({
    provider,
    runtime,
    hostSurfaces: Object.freeze(
      hostIds.map((id) => HOST_SURFACES.find((entry) => entry.id === id)!),
    ),
    executionTargets: Object.freeze(targetIds.map(getExecutionTargetCapability)),
  });
}
