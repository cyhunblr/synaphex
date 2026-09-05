import type {
  ExecutionRoute,
  ProviderRouteRequest,
  ProviderRoutingReason,
  RuntimeAvailability,
} from "../domain/provider-routing.js";
import {
  AgentTargetSurfaceUnsupportedError,
  ProviderCliUnavailableError,
} from "../domain/errors.js";

export class ProviderRouter {
  constructor(private readonly runtimeAvailability: RuntimeAvailability) {}

  /**
   * Resolves a target agent configuration against the hosting provider.
   *
   * The host contributes only its PROVIDER identity; no UI surface
   * participates, because none is observable. Every executable v0.1 route is
   * therefore a provider CLI route -- the same provider's CLI when the target
   * matches the host, another provider's CLI when it does not.
   */
  async resolve(request: ProviderRouteRequest): Promise<ExecutionRoute> {
    const { host, targetConfig } = request;

    // Checked FIRST, before any cross-provider consideration. Previously the
    // cross-provider branch ran first and silently rewrote a `vscode` target
    // to `cli`, executing something the user never configured. An unsupported
    // target surface must fail deterministically before provider execution.
    if (targetConfig.surface !== "cli") {
      throw new AgentTargetSurfaceUnsupportedError(
        targetConfig.agent,
        targetConfig.provider,
        targetConfig.surface,
      );
    }

    const isCrossProvider = host.provider !== targetConfig.provider;
    const routingReason: ProviderRoutingReason = isCrossProvider
      ? "cross_provider_cli"
      : "same_provider_configured_cli";

    if (!(await this.runtimeAvailability.isAvailable(targetConfig.provider, "cli"))) {
      throw new ProviderCliUnavailableError(
        host,
        targetConfig.provider,
        targetConfig.surface,
      );
    }

    return {
      agent: targetConfig.agent,
      host: { ...host },
      provider: targetConfig.provider,
      configuredSurface: targetConfig.surface,
      effectiveSurface: "cli",
      // Nothing is ever forced any more: a non-CLI target is refused above
      // rather than rewritten.
      cliForcedByCrossProvider: false,
      routingReason,
      model: targetConfig.model,
      ...(targetConfig.settings === undefined
        ? {}
        : { settings: targetConfig.settings }),
    };
  }
}
