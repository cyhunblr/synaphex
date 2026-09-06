import type { AgentProvider, AgentSurface } from "./agent-config.js";

/** Version of the offline capability authority shipped by this release. */
export const PROVIDER_CAPABILITY_CATALOG_VERSION = 1 as const;

export const PROVIDER_RUNTIME_IDS = ["codex", "claude", "agy"] as const;
export type ProviderRuntimeId = (typeof PROVIDER_RUNTIME_IDS)[number];

export const HOST_SURFACE_IDENTITIES = [
  "codex_cli",
  "codex_vscode",
  "claude_cli",
  "claude_vscode",
  "antigravity_cli",
] as const;
export type HostSurfaceIdentity = (typeof HOST_SURFACE_IDENTITIES)[number];

export const EXECUTION_TARGET_IDS = [
  "codex_cli",
  "claude_code_cli",
  "antigravity_cli",
] as const;
export type ExecutionTargetId = (typeof EXECUTION_TARGET_IDS)[number];

export type HostDetectionSemantics =
  | "shared_provider_registration"
  | "provider_registration";

/**
 * An interactive surface that can host Synaphex over MCP.
 *
 * Host surfaces are deliberately never callable targets. In particular, a
 * VS Code extension may consume shared provider registration without giving
 * Synaphex an invocation bridge into that editor session.
 */
export interface HostSurfaceCapability {
  readonly id: HostSurfaceIdentity;
  readonly provider: AgentProvider;
  readonly label: string;
  readonly surface: AgentSurface;
  readonly hostSupport: "supported";
  readonly detection: HostDetectionSemantics;
  readonly callableTarget: false;
}

export interface ExecutionPolicyCapability {
  readonly sourceModification: "invocation_scoped" | "unavailable";
  readonly network: "invocation_scoped" | "unavailable";
  readonly toolRestrictions: "invocation_scoped" | "unavailable";
}

export type SettingExecutorBinding = Readonly<{
  readonly kind: "codex_config";
  readonly key: string;
}>;

export interface SettingCapability {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly scope: "target" | "model";
  readonly type: "enum";
  readonly values: readonly Readonly<{ value: string; label: string }>[];
  readonly required: false;
  readonly omission: "provider_native";
  /** Internal adapter mapping. Configure projections must omit this field. */
  readonly executorBinding: SettingExecutorBinding;
}

export interface ModelCompatibilityEvidence {
  readonly providerRecognition: "official_current_documentation";
  readonly cliInvocation: "official_cli_documentation";
  readonly structuredResult: "provider_schema_contract";
  readonly executionPolicy: "target_policy_enforced";
  readonly deterministicAdapterCoverage: true;
}

export interface ModelCapability {
  readonly id: string;
  readonly label: string;
  readonly targetId: ExecutionTargetId;
  readonly supportTier: "recommended" | "supported";
  readonly settings: readonly SettingCapability[];
  readonly compatibility: ModelCompatibilityEvidence;
}

export interface ExecutionTargetCapability {
  readonly id: ExecutionTargetId;
  readonly provider: AgentProvider;
  readonly label: string;
  readonly runtime: ProviderRuntimeId;
  readonly persistedSurface: "cli";
  readonly support: "supported" | "unavailable";
  readonly executionPolicy: ExecutionPolicyCapability;
  readonly unavailableReason?: string;
  readonly models: readonly ModelCapability[];
}

export interface ProviderIntegrationCapability {
  readonly provider: AgentProvider;
  readonly runtime: ProviderRuntimeId;
  readonly hostSurfaces: readonly HostSurfaceCapability[];
  readonly executionTargets: readonly ExecutionTargetCapability[];
}

/** Machine state is observational and cannot widen the definitions above. */
export interface RuntimeObservation {
  readonly runtime: ProviderRuntimeId;
  readonly installed: boolean;
  readonly version?: string;
}

export interface HostRegistrationObservation {
  readonly state: "recorded" | "not_recorded";
  readonly source: "installation_manifest";
}
