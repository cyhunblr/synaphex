import {
  AGENT_PROVIDERS,
  AGENT_SURFACES,
  type ConfiguredAgentConfig,
  type ValidatedAgentConfig,
} from "../domain/agent-config.js";
import type { AgentName } from "../domain/agent.js";
import {
  AgentTargetSurfaceUnsupportedError,
  InvalidAgentConfigError,
  InvalidAgentModelError,
  InvalidAgentSettingError,
  ProviderExecutionPolicyUnsupportedError,
} from "../domain/errors.js";
import {
  findExecutionTargetCapability,
  getProviderModelCapability,
  validateModelSettings,
} from "./provider-model-capability-registry.js";

/** Validates a newly authored configuration before persistence. */
export interface AgentAuthoringCapabilityValidator {
  validateForAuthoring(
    agent: AgentName,
    config: ConfiguredAgentConfig,
  ): ValidatedAgentConfig;
}

/** Revalidates persisted configuration immediately before routing/execution. */
export interface AgentRuntimeCapabilityValidator {
  validateForExecution(
    agent: AgentName,
    config: ConfiguredAgentConfig,
  ): ValidatedAgentConfig;
}

export class StaticAgentAuthoringCapabilityValidator
  implements AgentAuthoringCapabilityValidator
{
  validateForAuthoring(
    agent: AgentName,
    config: ConfiguredAgentConfig,
  ): ValidatedAgentConfig {
    assertBasicShape(agent, config);
    const target = findExecutionTargetCapability(config.provider, config.surface);
    if (target === undefined || target.support !== "supported") {
      throw new InvalidAgentConfigError(
        agent,
        target?.unavailableReason ??
          "VS Code is an interactive host surface, not a callable execution target",
      );
    }
    return validateModelAndSettings(agent, config);
  }
}

export class StaticAgentRuntimeCapabilityValidator
  implements AgentRuntimeCapabilityValidator
{
  validateForExecution(
    agent: AgentName,
    config: ConfiguredAgentConfig,
  ): ValidatedAgentConfig {
    assertBasicShape(agent, config);
    if (config.surface !== "cli") {
      throw new AgentTargetSurfaceUnsupportedError(
        agent,
        config.provider,
        config.surface,
      );
    }
    const target = findExecutionTargetCapability(config.provider, config.surface);
    if (target === undefined || target.support !== "supported") {
      throw new ProviderExecutionPolicyUnsupportedError(
        config.provider,
        "execution_target_unavailable",
      );
    }
    return validateModelAndSettings(agent, config);
  }
}

/**
 * Compatibility name for callers that need the strict runtime boundary.
 * Parsing/preservation intentionally lives in AgentConfigManager instead.
 */
export class StaticAgentCapabilityValidator
  extends StaticAgentRuntimeCapabilityValidator
{
  validate(
    agent: AgentName,
    config: ConfiguredAgentConfig,
  ): ValidatedAgentConfig {
    return this.validateForExecution(agent, config);
  }
}

function assertBasicShape(
  agent: AgentName,
  config: ConfiguredAgentConfig,
): void {
  if (!(AGENT_PROVIDERS as readonly string[]).includes(config.provider)) {
    throw new InvalidAgentConfigError(agent, "provider is not supported");
  }
  if (!(AGENT_SURFACES as readonly string[]).includes(config.surface)) {
    throw new InvalidAgentConfigError(agent, "surface is not supported");
  }
  if (config.model.trim().length === 0) {
    throw new InvalidAgentModelError(agent, "model must be non-empty");
  }
}

function validateModelAndSettings(
  agent: AgentName,
  config: ConfiguredAgentConfig,
): ValidatedAgentConfig {
  const capability = getProviderModelCapability(
    config.provider,
    config.surface,
    config.model,
  );
  if (capability === undefined) {
    throw new InvalidAgentModelError(
      agent,
      "model is not supported for this execution target",
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
