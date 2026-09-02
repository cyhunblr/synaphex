import {
  BEHAVIOR_AGENT_NAMES,
  DEFAULT_AGENT_BEHAVIOR_FIELDS,
  isBehaviorAgentName,
  type AgentBehavior,
  type AgentBehaviorState,
  type BehaviorAgentName,
} from "../domain/agent-behavior.js";
import type { AgentName } from "../domain/agent.js";
import {
  InvalidAgentBehaviorError,
  UnsupportedAgentBehaviorError,
} from "../domain/errors.js";
import { StateStore } from "../infrastructure/state-store.js";

interface StoredAgentBehaviorState {
  readonly version: 1;
  readonly behaviors: Readonly<Record<string, unknown>>;
}

const AGENT_BEHAVIOR_PATH = "agent_behavior.jsonc";
const MAX_FIELD_NAME_LENGTH = 128;
const UNSAFE_FIELD_NAMES = new Set(["__proto__", "constructor", "prototype"]);
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;

export class AgentBehaviorManager {
  constructor(private readonly stateStore: StateStore) {}

  async getResearcherBehavior(): Promise<AgentBehavior> {
    return this.getBehavior("researcher");
  }

  async getCoderBehavior(): Promise<AgentBehavior> {
    return this.getBehavior("coder");
  }

  async getReviewerBehavior(): Promise<AgentBehavior> {
    return this.getBehavior("reviewer");
  }

  async getBehavior(agent: AgentName): Promise<AgentBehavior> {
    assertSupportedBehaviorAgent(agent);
    const stored = await this.readStoredState();
    return parseBehavior(agent, stored.behaviors[agent]);
  }

  async peekBehavior(agent: AgentName): Promise<AgentBehavior> {
    assertSupportedBehaviorAgent(agent);
    if (!(await this.stateStore.exists(AGENT_BEHAVIOR_PATH))) {
      return {
        outputFields: [...DEFAULT_AGENT_BEHAVIOR_FIELDS[agent]],
      };
    }
    const stored = await this.readStoredState(false);
    return parseBehavior(agent, stored.behaviors[agent]);
  }

  async getAllBehavior(): Promise<AgentBehaviorState> {
    const stored = await this.readStoredState();
    assertOnlyBehaviorAgents(stored.behaviors);
    return Object.fromEntries(
      BEHAVIOR_AGENT_NAMES.map((agent) => [
        agent,
        parseBehavior(agent, stored.behaviors[agent]),
      ]),
    ) as unknown as AgentBehaviorState;
  }

  async replaceOutputFields(
    agent: AgentName,
    outputFields: readonly string[],
  ): Promise<AgentBehavior> {
    assertSupportedBehaviorAgent(agent);
    const behavior = {
      outputFields: normalizeOutputFields(agent, outputFields, false),
    };
    const current = await this.getAllBehavior();
    await this.stateStore.writeJson(AGENT_BEHAVIOR_PATH, {
      version: 1,
      behaviors: { ...current, [agent]: behavior },
    } satisfies StoredAgentBehaviorState);
    return behavior;
  }

  private async readStoredState(
    initialize = true,
  ): Promise<StoredAgentBehaviorState> {
    if (initialize) {
      await this.ensureInitialized();
    }
    let value: unknown;
    try {
      value = await this.stateStore.readJson<unknown>(AGENT_BEHAVIOR_PATH);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new InvalidAgentBehaviorError(
          null,
          "file contains malformed JSONC",
        );
      }
      throw error;
    }
    if (!isStoredStateContainer(value)) {
      throw new InvalidAgentBehaviorError(
        null,
        "file must contain a version 1 behaviors object",
      );
    }
    return value;
  }

  private async ensureInitialized(): Promise<void> {
    await this.stateStore.createJsonAtomicExclusive(
      AGENT_BEHAVIOR_PATH,
      createDefaultState(),
    );
  }
}

function createDefaultState(): StoredAgentBehaviorState {
  return {
    version: 1,
    behaviors: Object.fromEntries(
      BEHAVIOR_AGENT_NAMES.map((agent) => [
        agent,
        { outputFields: [...DEFAULT_AGENT_BEHAVIOR_FIELDS[agent]] },
      ]),
    ),
  };
}

function isStoredStateContainer(
  value: unknown,
): value is StoredAgentBehaviorState {
  if (!isPlainObject(value) || !hasExactKeys(value, ["version", "behaviors"])) {
    return false;
  }
  return value.version === 1 && isPlainObject(value.behaviors);
}

function assertOnlyBehaviorAgents(
  behaviors: Readonly<Record<string, unknown>>,
): void {
  const keys = Object.keys(behaviors).sort();
  const expected = [...BEHAVIOR_AGENT_NAMES].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new InvalidAgentBehaviorError(
      null,
      "behaviors object must contain exactly researcher, coder, and reviewer",
    );
  }
}

function parseBehavior(
  agent: BehaviorAgentName,
  value: unknown,
): AgentBehavior {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ["outputFields"]) ||
    !Array.isArray(value.outputFields)
  ) {
    throw new InvalidAgentBehaviorError(
      agent,
      "entry must contain only an outputFields array",
    );
  }
  return {
    outputFields: normalizeOutputFields(agent, value.outputFields, true),
  };
}

function normalizeOutputFields(
  agent: BehaviorAgentName,
  fields: readonly unknown[],
  requireAlreadyNormalized: boolean,
): readonly string[] {
  if (!Array.isArray(fields)) {
    throw new InvalidAgentBehaviorError(agent, "output fields must be an array");
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    if (typeof field !== "string") {
      throw new InvalidAgentBehaviorError(
        agent,
        "every output field must be a string",
      );
    }
    const trimmed = field.trim();
    if (trimmed.length === 0) {
      throw new InvalidAgentBehaviorError(
        agent,
        "output fields must not be empty",
      );
    }
    if (trimmed.length > MAX_FIELD_NAME_LENGTH) {
      throw new InvalidAgentBehaviorError(
        agent,
        `output fields must not exceed ${MAX_FIELD_NAME_LENGTH} characters`,
      );
    }
    if (CONTROL_CHARACTER.test(trimmed)) {
      throw new InvalidAgentBehaviorError(
        agent,
        "output fields must not contain control characters",
      );
    }
    if (UNSAFE_FIELD_NAMES.has(trimmed)) {
      throw new InvalidAgentBehaviorError(
        agent,
        `output field is reserved: ${trimmed}`,
      );
    }
    if (requireAlreadyNormalized && trimmed !== field) {
      throw new InvalidAgentBehaviorError(
        agent,
        "persisted output fields must already be trimmed",
      );
    }
    if (seen.has(trimmed)) {
      throw new InvalidAgentBehaviorError(
        agent,
        `duplicate output field: ${trimmed}`,
      );
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function assertSupportedBehaviorAgent(
  agent: AgentName,
): asserts agent is BehaviorAgentName {
  if (!isBehaviorAgentName(agent)) {
    throw new UnsupportedAgentBehaviorError(agent);
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
