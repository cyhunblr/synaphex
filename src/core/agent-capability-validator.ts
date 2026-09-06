import {
  AGENT_PROVIDERS,
  AGENT_SURFACES,
  type ConfiguredAgentConfig,
  type ValidatedAgentConfig,
} from "../domain/agent-config.js";
import type { AgentName } from "../domain/agent.js";
import {
  InvalidAgentConfigError,
  InvalidAgentModelError,
  InvalidAgentSettingError,
} from "../domain/errors.js";
import {
  getProviderModelCapability,
  getProviderTargetCapability,
  validateModelSettings,
} from "./provider-model-capability-registry.js";

export interface AgentCapabilityValidator {
  validate(
    agent: AgentName,
    config: ConfiguredAgentConfig,
  ): ValidatedAgentConfig;
}

export class StaticAgentCapabilityValidator
  implements AgentCapabilityValidator
{
  validate(
    agent: AgentName,
    config: ConfiguredAgentConfig,
  ): ValidatedAgentConfig {
    if (!(AGENT_PROVIDERS as readonly string[]).includes(config.provider)) {
      throw new InvalidAgentConfigError(agent, "provider is not supported");
    }
    if (!(AGENT_SURFACES as readonly string[]).includes(config.surface)) {
      throw new InvalidAgentConfigError(agent, "surface is not supported");
    }
    if (config.model.trim().length === 0) {
      throw new InvalidAgentModelError(agent, "model must be non-empty");
    }
    const target = getProviderTargetCapability(config.provider, config.surface);
    if (target.executionAvailability !== "available") {
      const unsupportedSetting = Object.keys(config.settings ?? {})[0];
      if (unsupportedSetting !== undefined) {
        throw new InvalidAgentSettingError(
          agent,
          unsupportedSetting,
          "settings cannot be validated for an unavailable target",
        );
      }
      // Historical Google/VS Code entries remain parseable and visible. The
      // router still refuses them, and Configure cannot create new ones.
      return { agent, ...config };
    }
    const capability = getProviderModelCapability(
      config.provider,
      config.surface,
      config.model,
    );
    if (capability === undefined) {
      throw new InvalidAgentModelError(
        agent,
        "model is not supported for this provider and surface",
      );
    }
    const invalid = validateModelSettings(capability, config.settings);
    if (invalid.setting !== undefined) {
      throw new InvalidAgentSettingError(
        agent,
        invalid.setting,
        invalid.reason ?? "setting is invalid",
      );
    }
    return { agent, ...config };
  }
}
