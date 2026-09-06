import type {
  AgentProvider,
  AgentSettings,
  AgentSurface,
} from "../domain/agent-config.js";

export type ModelSettingCapability = Readonly<{
  key: string;
  label: string;
  description: string;
  type: "enum";
  values: readonly Readonly<{ value: string; label: string }>[];
  required: false;
  defaultBehavior: "provider_native";
  execution: Readonly<{ kind: "codex_config"; key: string }>;
}>;

export interface ProviderModelCapability {
  readonly provider: AgentProvider;
  readonly surface: AgentSurface;
  readonly model: string;
  readonly label: string;
  readonly settings: readonly ModelSettingCapability[];
}

export interface ProviderTargetCapability {
  readonly provider: AgentProvider;
  readonly surface: AgentSurface;
  readonly executionAvailability: "available" | "unavailable";
  readonly unavailableReason?: string;
  readonly models: readonly ProviderModelCapability[];
}

const OPENAI_REASONING_EFFORT: ModelSettingCapability = Object.freeze({
  key: "reasoning_effort",
  label: "Reasoning effort",
  description: "Controls how much reasoning effort Codex applies.",
  type: "enum",
  values: Object.freeze(
    ["low", "medium", "high", "xhigh"].map((value) =>
      Object.freeze({ value, label: value }),
    ),
  ),
  required: false,
  defaultBehavior: "provider_native",
  execution: Object.freeze({
    kind: "codex_config",
    key: "model_reasoning_effort",
  }),
});

const TARGET_UNAVAILABLE = Object.freeze({
  vscode:
    "VS Code is an interactive host surface, not a Synaphex invocation target.",
  google:
    "Antigravity exposes no invocation-scoped execution policy, so Synaphex cannot establish the required per-invocation contract and refuses to run agents on it.",
});

/**
 * Offline, versioned model support for this Synaphex release.
 *
 * This is deliberately not provider discovery: account entitlements and newly
 * released provider models do not widen Synaphex's tested execution contract.
 */
export const PROVIDER_TARGET_CAPABILITIES: readonly ProviderTargetCapability[] =
  Object.freeze([
    available("openai", "cli", [
      model("openai", "cli", "gpt-5.6-sol", [OPENAI_REASONING_EFFORT]),
    ]),
    unavailable("openai", "vscode", TARGET_UNAVAILABLE.vscode),
    available("anthropic", "cli", [
      model("anthropic", "cli", "claude-sonnet-4-5", []),
    ]),
    unavailable("anthropic", "vscode", TARGET_UNAVAILABLE.vscode),
    unavailable("google", "cli", TARGET_UNAVAILABLE.google),
    unavailable("google", "vscode", TARGET_UNAVAILABLE.vscode),
  ]);

export function getProviderTargetCapability(
  provider: AgentProvider,
  surface: AgentSurface,
): ProviderTargetCapability {
  return PROVIDER_TARGET_CAPABILITIES.find(
    (entry) => entry.provider === provider && entry.surface === surface,
  )!;
}

export function getProviderModelCapability(
  provider: AgentProvider,
  surface: AgentSurface,
  modelId: string,
): ProviderModelCapability | undefined {
  return getProviderTargetCapability(provider, surface).models.find(
    (entry) => entry.model === modelId,
  );
}

export function validateModelSettings(
  capability: ProviderModelCapability,
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

function available(
  provider: AgentProvider,
  surface: AgentSurface,
  models: readonly ProviderModelCapability[],
): ProviderTargetCapability {
  return Object.freeze({
    provider,
    surface,
    executionAvailability: "available" as const,
    models: Object.freeze([...models]),
  });
}

function unavailable(
  provider: AgentProvider,
  surface: AgentSurface,
  unavailableReason: string,
): ProviderTargetCapability {
  return Object.freeze({
    provider,
    surface,
    executionAvailability: "unavailable" as const,
    unavailableReason,
    models: Object.freeze([]),
  });
}

function model(
  provider: AgentProvider,
  surface: AgentSurface,
  modelId: string,
  settings: readonly ModelSettingCapability[],
): ProviderModelCapability {
  return Object.freeze({
    provider,
    surface,
    model: modelId,
    label: modelId,
    settings: Object.freeze([...settings]),
  });
}
