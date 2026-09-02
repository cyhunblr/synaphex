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
    const unsupportedSetting = Object.keys(config.settings ?? {})[0];
    if (unsupportedSetting !== undefined) {
      throw new InvalidAgentSettingError(
        agent,
        unsupportedSetting,
        "no optional settings are supported by the static v0 capability model",
      );
    }
    return { agent, ...config };
  }
}
