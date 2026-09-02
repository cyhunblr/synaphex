import type { AgentName } from "./agent.js";

export const AGENT_PROVIDERS = ["openai", "anthropic", "google"] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];
export type Provider = AgentProvider;

export const AGENT_SURFACES = ["cli", "vscode"] as const;
export type AgentSurface = (typeof AGENT_SURFACES)[number];
export type Surface = AgentSurface;

export type AgentSettings = Readonly<Record<string, unknown>>;

export interface UnconfiguredAgentConfig {
  readonly status: "unconfigured";
}

export interface RemovedAgentConfig {
  readonly status: "removed";
  readonly reason: "provider_removed";
  readonly previousProvider: AgentProvider;
}

export interface ConfiguredAgentConfig {
  readonly status: "configured";
  readonly provider: AgentProvider;
  readonly surface: AgentSurface;
  readonly model: string;
  readonly settings?: AgentSettings;
}

export interface ConfiguredAgentInput {
  readonly provider: AgentProvider;
  readonly surface: AgentSurface;
  readonly model: string;
  readonly settings?: AgentSettings;
}

export type AgentConfig =
  | UnconfiguredAgentConfig
  | RemovedAgentConfig
  | ConfiguredAgentConfig;

export type AgentConfigState = Readonly<Record<AgentName, AgentConfig>>;

export interface ValidatedAgentConfig extends ConfiguredAgentConfig {
  readonly agent: AgentName;
}
