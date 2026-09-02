import {
  AGENT_PROVIDERS,
  AGENT_SURFACES,
  type AgentConfig,
  type AgentConfigState,
  type AgentProvider,
  type ConfiguredAgentConfig,
  type ConfiguredAgentInput,
  type ValidatedAgentConfig,
} from "../domain/agent-config.js";
import { AGENT_NAMES, type AgentName } from "../domain/agent.js";
import {
  AgentConfigurationRemovedError,
  AgentUnconfiguredError,
  InvalidAgentConfigError,
  InvalidAgentModelError,
  InvalidAgentSettingError,
} from "../domain/errors.js";
import { StateStore } from "../infrastructure/state-store.js";
import {
  StaticAgentCapabilityValidator,
  type AgentCapabilityValidator,
} from "./agent-capability-validator.js";

interface StoredAgentConfigState {
  readonly version: 1;
  readonly agents: Readonly<Record<string, unknown>>;
}

const AGENT_CONFIG_PATH = "agent_config.jsonc";

export class AgentConfigManager {
  constructor(
    private readonly stateStore: StateStore,
    private readonly capabilityValidator: AgentCapabilityValidator =
      new StaticAgentCapabilityValidator(),
  ) {}

  async getConfig(agent: AgentName): Promise<AgentConfig> {
    const stored = await this.readStoredState();
    return parseAgentConfig(agent, stored.agents[agent]);
  }

  async getAllConfigs(): Promise<AgentConfigState> {
    const stored = await this.readStoredState();
    assertOnlyKnownAgents(stored.agents);
    return Object.fromEntries(
      AGENT_NAMES.map((agent) => [
        agent,
        parseAgentConfig(agent, stored.agents[agent]),
      ]),
    ) as unknown as AgentConfigState;
  }

  async validateAgent(agent: AgentName): Promise<ValidatedAgentConfig> {
    const config = await this.getConfig(agent);
    if (config.status === "unconfigured") {
      throw new AgentUnconfiguredError(agent);
    }
    if (config.status === "removed") {
      throw new AgentConfigurationRemovedError(
        agent,
        config.previousProvider,
      );
    }
    return this.capabilityValidator.validate(agent, config);
  }

  async setConfigured(
    agent: AgentName,
    input: ConfiguredAgentInput,
  ): Promise<ConfiguredAgentConfig> {
    const config = parseConfiguredInput(agent, input);
    this.capabilityValidator.validate(agent, config);
    await this.replaceAgentConfig(agent, config);
    return config;
  }

  async markUnconfigured(agent: AgentName): Promise<void> {
    await this.replaceAgentConfig(agent, { status: "unconfigured" });
  }

  async removeProvider(provider: AgentProvider): Promise<AgentConfigState> {
    if (!(AGENT_PROVIDERS as readonly unknown[]).includes(provider)) {
      throw new InvalidAgentConfigError(null, "provider is not supported");
    }
    const current = await this.getAllConfigs();
    let changed = false;
    const next = Object.fromEntries(
      AGENT_NAMES.map((agent) => {
        const config = current[agent];
        if (config.status === "configured" && config.provider === provider) {
          changed = true;
          return [
            agent,
            {
              status: "removed",
              reason: "provider_removed",
              previousProvider: provider,
            },
          ];
        }
        return [agent, config];
      }),
    ) as unknown as AgentConfigState;

    if (changed) {
      await this.writeState(next);
    }
    return next;
  }

  private async replaceAgentConfig(
    agent: AgentName,
    config: AgentConfig,
  ): Promise<void> {
    const current = await this.getAllConfigs();
    await this.writeState({ ...current, [agent]: config });
  }

  private async writeState(agents: AgentConfigState): Promise<void> {
    await this.stateStore.writeJson(AGENT_CONFIG_PATH, {
      version: 1,
      agents,
    } satisfies StoredAgentConfigState);
  }

  private async readStoredState(): Promise<StoredAgentConfigState> {
    await this.ensureInitialized();
    let value: unknown;
    try {
      value = await this.stateStore.readJson<unknown>(AGENT_CONFIG_PATH);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new InvalidAgentConfigError(null, "file contains malformed JSONC");
      }
      throw error;
    }
    if (!isStoredStateContainer(value)) {
      throw new InvalidAgentConfigError(
        null,
        "file must contain a version 1 agents object",
      );
    }
    return value;
  }

  private async ensureInitialized(): Promise<void> {
    await this.stateStore.createJsonAtomicExclusive(
      AGENT_CONFIG_PATH,
      createDefaultState(),
    );
  }
}

function createDefaultState(): StoredAgentConfigState {
  return {
    version: 1,
    agents: Object.fromEntries(
      AGENT_NAMES.map((agent) => [agent, { status: "unconfigured" }]),
    ),
  };
}

function isStoredStateContainer(value: unknown): value is StoredAgentConfigState {
  if (!isPlainObject(value) || !hasExactKeys(value, ["version", "agents"])) {
    return false;
  }
  return value.version === 1 && isPlainObject(value.agents);
}

function assertOnlyKnownAgents(agents: Readonly<Record<string, unknown>>): void {
  const keys = Object.keys(agents).sort();
  const expected = [...AGENT_NAMES].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new InvalidAgentConfigError(
      null,
      "agents object must contain exactly the six supported agents",
    );
  }
}

function parseAgentConfig(agent: AgentName, value: unknown): AgentConfig {
  if (!isPlainObject(value) || typeof value.status !== "string") {
    throw new InvalidAgentConfigError(agent, "entry must be a status object");
  }
  if (value.status === "unconfigured") {
    if (!hasExactKeys(value, ["status"])) {
      throw new InvalidAgentConfigError(
        agent,
        "unconfigured entry contains unexpected properties",
      );
    }
    return { status: "unconfigured" };
  }
  if (value.status === "removed") {
    if (
      !hasExactKeys(value, ["status", "reason", "previousProvider"]) ||
      value.reason !== "provider_removed" ||
      !isAgentProvider(value.previousProvider)
    ) {
      throw new InvalidAgentConfigError(
        agent,
        "removed entry has invalid provider-removal metadata",
      );
    }
    return {
      status: "removed",
      reason: "provider_removed",
      previousProvider: value.previousProvider,
    };
  }
  if (value.status === "configured") {
    const allowedKeys = Object.hasOwn(value, "settings")
      ? ["status", "provider", "surface", "model", "settings"]
      : ["status", "provider", "surface", "model"];
    if (
      !hasExactKeys(value, allowedKeys) ||
      !isAgentProvider(value.provider) ||
      !isAgentSurface(value.surface) ||
      typeof value.model !== "string"
    ) {
      throw new InvalidAgentConfigError(
        agent,
        "configured entry has invalid or unexpected properties",
      );
    }
    if (Object.hasOwn(value, "settings")) {
      if (!isJsonCompatibleObject(value.settings)) {
        throw new InvalidAgentConfigError(
          agent,
          "settings must be a JSON-compatible object",
        );
      }
      return {
        status: "configured",
        provider: value.provider,
        surface: value.surface,
        model: value.model,
        settings: value.settings,
      };
    }
    return {
      status: "configured",
      provider: value.provider,
      surface: value.surface,
      model: value.model,
    };
  }
  throw new InvalidAgentConfigError(agent, "status is not supported");
}

function parseConfiguredInput(
  agent: AgentName,
  input: ConfiguredAgentInput,
): ConfiguredAgentConfig {
  if (!isPlainObject(input)) {
    throw new InvalidAgentConfigError(agent, "configuration must be an object");
  }
  const allowedKeys = new Set(["provider", "surface", "model", "settings"]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new InvalidAgentConfigError(
      agent,
      "configuration contains unsupported properties",
    );
  }
  if (!isAgentProvider(input.provider)) {
    throw new InvalidAgentConfigError(agent, "provider is not supported");
  }
  if (!isAgentSurface(input.surface)) {
    throw new InvalidAgentConfigError(agent, "surface is not supported");
  }
  if (!Object.hasOwn(input, "model") || typeof input.model !== "string") {
    throw new InvalidAgentModelError(
      agent,
      "model is required and must be a string",
    );
  }
  if (Object.hasOwn(input, "settings")) {
    if (!isJsonCompatibleObject(input.settings)) {
      throw new InvalidAgentSettingError(
        agent,
        "settings",
        "settings must be a JSON-compatible object",
      );
    }
    return {
      status: "configured",
      provider: input.provider,
      surface: input.surface,
      model: input.model,
      settings: snapshotJsonObject(agent, input.settings),
    };
  }
  return {
    status: "configured",
    provider: input.provider,
    surface: input.surface,
    model: input.model,
  };
}

function isAgentProvider(value: unknown): value is AgentProvider {
  return (
    typeof value === "string" &&
    (AGENT_PROVIDERS as readonly string[]).includes(value)
  );
}

function isAgentSurface(
  value: unknown,
): value is (typeof AGENT_SURFACES)[number] {
  return (
    typeof value === "string" &&
    (AGENT_SURFACES as readonly string[]).includes(value)
  );
}

function isJsonCompatibleObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  if (!isPlainObject(value)) {
    return false;
  }
  try {
    return (
      isJsonValue(value, new WeakSet<object>()) &&
      JSON.stringify(value) !== undefined
    );
  } catch {
    return false;
  }
}

function isJsonValue(value: unknown, ancestors: WeakSet<object>): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    return false;
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    return false;
  }
  ancestors.add(value);
  if (Object.getOwnPropertySymbols(value).length > 0) {
    ancestors.delete(value);
    return false;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  let valid: boolean;
  if (Array.isArray(value)) {
    const keys = Object.keys(descriptors).filter((key) => key !== "length");
    valid = keys.length === value.length;
    for (let index = 0; valid && index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      valid =
        descriptor !== undefined &&
        "value" in descriptor &&
        descriptor.enumerable === true &&
        isJsonValue(descriptor.value, ancestors);
    }
  } else {
    valid = Object.values(descriptors).every(
      (descriptor) =>
        descriptor.enumerable === true &&
        "value" in descriptor &&
        isJsonValue(descriptor.value, ancestors),
    );
  }
  ancestors.delete(value);
  return valid;
}

function snapshotJsonObject(
  agent: AgentName,
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  try {
    return JSON.parse(JSON.stringify(value)) as Readonly<
      Record<string, unknown>
    >;
  } catch {
    throw new InvalidAgentSettingError(
      agent,
      "settings",
      "settings could not be serialized safely",
    );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  );
}
