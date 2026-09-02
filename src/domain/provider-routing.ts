import type {
  AgentProvider,
  AgentSettings,
  AgentSurface,
  ValidatedAgentConfig,
} from "./agent-config.js";
import type { AgentName } from "./agent.js";

export interface HostRuntime {
  readonly provider: AgentProvider;
  readonly surface: AgentSurface;
}

export const PROVIDER_ROUTING_REASONS = [
  "same_provider_native",
  "same_provider_configured_cli",
  "cross_provider_cli",
] as const;

export type ProviderRoutingReason =
  (typeof PROVIDER_ROUTING_REASONS)[number];

export interface ExecutionRoute {
  readonly agent: AgentName;
  readonly host: HostRuntime;
  readonly provider: AgentProvider;
  readonly configuredSurface: AgentSurface;
  readonly effectiveSurface: AgentSurface;
  readonly cliForcedByCrossProvider: boolean;
  readonly routingReason: ProviderRoutingReason;
  readonly model: string;
  readonly settings?: AgentSettings;
}

export interface ProviderRouteRequest {
  readonly host: HostRuntime;
  readonly targetConfig: ValidatedAgentConfig;
}

export interface RuntimeAvailability {
  isAvailable(
    provider: AgentProvider,
    surface: AgentSurface,
  ): Promise<boolean>;
}
