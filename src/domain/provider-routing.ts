import type {
  AgentProvider,
  AgentSettings,
  AgentSurface,
  ValidatedAgentConfig,
} from "./agent-config.js";
import type { AgentName } from "./agent.js";

/**
 * The provider runtime hosting this Synaphex MCP server.
 *
 * Provider identity ONLY. The UI origin -- a terminal CLI session or a VS Code
 * extension -- is deliberately absent, because it is not observable: both
 * surfaces of a provider share one MCP registration store and present the same
 * MCP `clientInfo`, so a launcher asserting a UI surface would be asserting
 * something Synaphex cannot verify (ADR 0007, ADR 0009).
 *
 * Distinct from {@link ValidatedAgentConfig}, which carries the *target*
 * execution surface. Host identity and target execution identity are separate
 * questions and must not share a type.
 */
export interface McpHostContext {
  readonly provider: AgentProvider;
}

/**
 * Reachable routing outcomes.
 *
 * `same_provider_native` was removed rather than deprecated: it required
 * `host.surface === "vscode"`, which is no longer expressible, so it could
 * never be produced again. Leaving it would advertise a capability that
 * cannot exist.
 */
export const PROVIDER_ROUTING_REASONS = [
  "same_provider_configured_cli",
  "cross_provider_cli",
] as const;

export type ProviderRoutingReason =
  (typeof PROVIDER_ROUTING_REASONS)[number];

export interface ExecutionRoute {
  readonly agent: AgentName;
  readonly host: McpHostContext;
  readonly provider: AgentProvider;
  readonly configuredSurface: AgentSurface;
  readonly effectiveSurface: AgentSurface;
  readonly cliForcedByCrossProvider: boolean;
  readonly routingReason: ProviderRoutingReason;
  readonly model: string;
  readonly settings?: AgentSettings;
}

export interface ProviderRouteRequest {
  readonly host: McpHostContext;
  readonly targetConfig: ValidatedAgentConfig;
}

export interface RuntimeAvailability {
  isAvailable(
    provider: AgentProvider,
    surface: AgentSurface,
  ): Promise<boolean>;
}
