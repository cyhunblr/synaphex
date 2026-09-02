import type {
  ExecutionRoute,
  ProviderRouteRequest,
  ProviderRoutingReason,
  RuntimeAvailability,
} from "../domain/provider-routing.js";
import {
  InvalidProviderRouteError,
  ProviderCliUnavailableError,
} from "../domain/errors.js";
import type { AgentSurface } from "../domain/agent-config.js";

export class ProviderRouter {
  constructor(private readonly runtimeAvailability: RuntimeAvailability) {}

  async resolve(request: ProviderRouteRequest): Promise<ExecutionRoute> {
    const { host, targetConfig } = request;
    const isCrossProvider = host.provider !== targetConfig.provider;

    let effectiveSurface: AgentSurface;
    let routingReason: ProviderRoutingReason;
    if (isCrossProvider) {
      effectiveSurface = "cli";
      routingReason = "cross_provider_cli";
    } else if (host.surface === "cli" && targetConfig.surface === "vscode") {
      throw new InvalidProviderRouteError(
        host,
        targetConfig.provider,
        targetConfig.surface,
        "vscode",
      );
    } else if (targetConfig.surface === "vscode") {
      effectiveSurface = "vscode";
      routingReason = "same_provider_native";
    } else {
      effectiveSurface = "cli";
      routingReason = "same_provider_configured_cli";
    }

    const activeNativeVscodeRoute =
      !isCrossProvider &&
      host.surface === "vscode" &&
      effectiveSurface === "vscode";
    if (
      !activeNativeVscodeRoute &&
      !(await this.runtimeAvailability.isAvailable(
        targetConfig.provider,
        effectiveSurface,
      ))
    ) {
      if (effectiveSurface === "cli") {
        throw new ProviderCliUnavailableError(
          host,
          targetConfig.provider,
          targetConfig.surface,
        );
      }
    }

    return {
      agent: targetConfig.agent,
      host: { ...host },
      provider: targetConfig.provider,
      configuredSurface: targetConfig.surface,
      effectiveSurface,
      cliForcedByCrossProvider:
        isCrossProvider && targetConfig.surface !== "cli",
      routingReason,
      model: targetConfig.model,
      ...(targetConfig.settings === undefined
        ? {}
        : { settings: targetConfig.settings }),
    };
  }
}
