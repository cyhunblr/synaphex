import { AGENT_NAMES } from "../domain/agent.js";
import { BEHAVIOR_AGENT_NAMES, DEFAULT_AGENT_BEHAVIOR_FIELDS } from "../domain/agent-behavior.js";
import { InvalidConfigurationFileError } from "../domain/errors.js";
import type { StateStore } from "../infrastructure/state-store.js";
import {
  renderAgentBehavior,
  renderAgentConfig,
  renderRules,
} from "./config-templates.js";

export const AGENT_CONFIG_FILE = "agent_config.jsonc";
export const AGENT_BEHAVIOR_FILE = "agent_behavior.jsonc";
export const GLOBAL_RULES_FILE = "rules.jsonc";

export const MANAGED_CONFIG_FILES: readonly string[] = Object.freeze([
  AGENT_CONFIG_FILE,
  AGENT_BEHAVIOR_FILE,
  GLOBAL_RULES_FILE,
]);

/**
 * One managed configuration file: how to seed it, and how to validate whatever
 * a user currently has.
 */
interface ManagedConfig {
  readonly path: string;
  readonly initial: () => unknown;
  /** Throws when the parsed document is not semantically usable. */
  readonly validate: (value: unknown) => void;
  readonly render: (value: unknown) => string;
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidConfigurationFileError(path, "expected a JSON object");
  }
  return value as Record<string, unknown>;
}

function requireVersionOne(value: unknown, path: string): Record<string, unknown> {
  const object = requireObject(value, path);
  if (object.version !== 1) {
    throw new InvalidConfigurationFileError(path, "expected \"version\": 1");
  }
  return object;
}

/**
 * Rejects fields Synaphex does not understand.
 *
 * Canonical regeneration re-renders the document from the values it parsed, so
 * an unrecognised key would be silently dropped -- destroying configuration the
 * user deliberately wrote. Refusing before any write is the honest option: the
 * user is told rather than quietly losing data.
 */
function rejectUnknownKeys(
  object: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      throw new InvalidConfigurationFileError(path, `unknown field "${key}"`);
    }
  }
}

const MANAGED: readonly ManagedConfig[] = Object.freeze([
  {
    path: AGENT_CONFIG_FILE,
    initial: () => ({
      version: 1,
      agents: Object.fromEntries(
        AGENT_NAMES.map((agent) => [agent, { status: "unconfigured" }]),
      ),
    }),
    validate: (value) => {
      const object = requireVersionOne(value, AGENT_CONFIG_FILE);
      rejectUnknownKeys(object, ["version", "agents"], AGENT_CONFIG_FILE);
      const agents = requireObject(object.agents, AGENT_CONFIG_FILE);
      rejectUnknownKeys(agents, [...AGENT_NAMES], AGENT_CONFIG_FILE);
      for (const [agent, entry] of Object.entries(agents)) {
        const config = requireObject(entry, AGENT_CONFIG_FILE);
        if (config.status === "configured") {
          // Every configured agent must name a model; nothing is invented.
          if (typeof config.model !== "string" || config.model.length === 0) {
            throw new InvalidConfigurationFileError(
              AGENT_CONFIG_FILE,
              `agent "${agent}" is configured without a model`,
            );
          }
        } else if (config.status !== "unconfigured") {
          throw new InvalidConfigurationFileError(
            AGENT_CONFIG_FILE,
            `agent "${agent}" has an unrecognised status`,
          );
        }
      }
    },
    render: renderAgentConfig,
  },
  {
    path: AGENT_BEHAVIOR_FILE,
    initial: () => ({
      version: 1,
      behaviors: Object.fromEntries(
        BEHAVIOR_AGENT_NAMES.map((agent) => [
          agent,
          { outputFields: [...DEFAULT_AGENT_BEHAVIOR_FIELDS[agent]] },
        ]),
      ),
    }),
    validate: (value) => {
      const object = requireVersionOne(value, AGENT_BEHAVIOR_FILE);
      rejectUnknownKeys(object, ["version", "behaviors"], AGENT_BEHAVIOR_FILE);
      const behaviors = requireObject(object.behaviors, AGENT_BEHAVIOR_FILE);
      rejectUnknownKeys(behaviors, [...BEHAVIOR_AGENT_NAMES], AGENT_BEHAVIOR_FILE);
      for (const [agent, entry] of Object.entries(behaviors)) {
        const behavior = requireObject(entry, AGENT_BEHAVIOR_FILE);
        rejectUnknownKeys(behavior, ["outputFields"], AGENT_BEHAVIOR_FILE);
        if (
          !Array.isArray(behavior.outputFields) ||
          behavior.outputFields.some((field) => typeof field !== "string")
        ) {
          throw new InvalidConfigurationFileError(
            AGENT_BEHAVIOR_FILE,
            `agent "${agent}" must list outputFields as strings`,
          );
        }
      }
    },
    render: renderAgentBehavior,
  },
  {
    path: GLOBAL_RULES_FILE,
    // Seeded by RuleStore, which owns the accepted initial rule document.
    initial: () => null,
    validate: (value) => {
      const object = requireObject(value, GLOBAL_RULES_FILE);
      rejectUnknownKeys(object, ["agent_calls", "actions"], GLOBAL_RULES_FILE);
      for (const decisions of Object.values(object)) {
        const group = requireObject(decisions, GLOBAL_RULES_FILE);
        for (const entry of Object.values(group)) {
          const values =
            typeof entry === "object" && entry !== null
              ? Object.values(entry as Record<string, unknown>)
              : [entry];
          for (const decision of values) {
            if (!["allow", "ask", "deny"].includes(decision as string)) {
              throw new InvalidConfigurationFileError(
                GLOBAL_RULES_FILE,
                `"${String(decision)}" is not allow, ask or deny`,
              );
            }
          }
        }
      }
    },
    render: renderRules,
  },
]);

export interface ConfigLifecycleResult {
  readonly created: readonly string[];
  readonly refreshed: readonly string[];
}

/**
 * Creates the managed configuration files, or refreshes their maintainer
 * comments around the user's existing values.
 *
 * Sequence per file: parse -> validate -> re-render canonically -> atomic
 * replace. An invalid file FAILS CLOSED with its original bytes untouched,
 * because replacing a broken config with defaults would destroy work the user
 * meant to keep.
 */
export class ConfigLifecycle {
  constructor(private readonly stateStore: StateStore) {}

  async apply(): Promise<ConfigLifecycleResult> {
    const created: string[] = [];
    const refreshed: string[] = [];

    for (const managed of MANAGED) {
      const existing = await this.stateStore.readJson<unknown>(managed.path);
      if (existing === null) {
        const initial = managed.initial();
        if (initial === null) {
          // Another component owns seeding this file; nothing to render yet.
          continue;
        }
        await this.stateStore.writeText(managed.path, managed.render(initial));
        created.push(managed.path);
        continue;
      }
      // Throws before any write when the document is unusable.
      managed.validate(existing);
      await this.stateStore.writeText(managed.path, managed.render(existing));
      refreshed.push(managed.path);
    }
    return { created, refreshed };
  }
}
