import { isAgentName, type AgentName } from "../domain/agent.js";
import {
  InvalidRuleError,
  InvalidRuleValueError,
} from "../domain/errors.js";
import {
  formatRuleKey,
  isRuleDecision,
  type RuleDecision,
  type RuleKey,
  type ScopedRule,
} from "../domain/rule.js";
import { StateStore } from "../infrastructure/state-store.js";

export interface RuleDocument {
  readonly agent_calls: Partial<
    Record<AgentName, Partial<Record<AgentName, RuleDecision>>>
  >;
  readonly actions: Record<string, RuleDecision>;
}

export const GLOBAL_RULES_PATH = "rules.jsonc";

const INITIAL_GLOBAL_RULES: RuleDocument = {
  agent_calls: {
    questioner: {
      examiner: "allow",
      researcher: "ask",
    },
    researcher: {
      examiner: "ask",
    },
    examiner: {
      researcher: "ask",
    },
    planner: {
      examiner: "ask",
      researcher: "ask",
      questioner: "ask",
      coder: "deny",
    },
    coder: {
      planner: "allow",
      researcher: "ask",
      questioner: "ask",
      reviewer: "deny",
    },
    reviewer: {
      examiner: "ask",
      researcher: "ask",
      planner: "ask",
      coder: "ask",
    },
  },
  actions: {
    git_push: "ask",
    network: "ask",
    ci: "ask",
  },
};

export async function ensureGlobalRuleState(
  stateStore: StateStore,
): Promise<void> {
  await stateStore.createJsonExclusive(GLOBAL_RULES_PATH, INITIAL_GLOBAL_RULES);
}

export async function readRuleDocument(
  stateStore: StateStore,
  relativePath: string,
): Promise<RuleDocument> {
  const value = await stateStore.readJson<unknown>(relativePath);
  return parseRuleDocument(value ?? {});
}

export function validateRuleKey(key: unknown): asserts key is RuleKey {
  if (key === null || typeof key !== "object") {
    throw new InvalidRuleError("rule key must be an object");
  }

  const candidate = key as Partial<RuleKey>;
  if (candidate.kind === "agent_call") {
    if (!isAgentName(candidate.caller) || !isAgentName(candidate.target)) {
      throw new InvalidRuleError(
        "agent-call rules require recognized caller and target agents",
      );
    }
    return;
  }

  if (candidate.kind === "action") {
    if (!isValidActionName(candidate.action)) {
      throw new InvalidRuleError(
        "action rules require a non-empty, trimmed action name",
      );
    }
    return;
  }

  throw new InvalidRuleError("rule kind must be agent_call or action");
}

export function listDocumentRules(document: RuleDocument): ScopedRule[] {
  const rules: ScopedRule[] = [];
  for (const [caller, targets] of Object.entries(document.agent_calls)) {
    for (const [target, decision] of Object.entries(targets ?? {})) {
      rules.push({
        key: {
          kind: "agent_call",
          caller: caller as AgentName,
          target: target as AgentName,
        },
        decision,
      });
    }
  }
  for (const [action, decision] of Object.entries(document.actions)) {
    rules.push({ key: { kind: "action", action }, decision });
  }

  return rules.sort((left, right) =>
    formatRuleKey(left.key).localeCompare(formatRuleKey(right.key)),
  );
}

export function getDocumentDecision(
  document: RuleDocument,
  key: RuleKey,
): RuleDecision | undefined {
  return key.kind === "agent_call"
    ? document.agent_calls[key.caller]?.[key.target]
    : document.actions[key.action];
}

export function withRule(
  document: RuleDocument,
  key: RuleKey,
  decision: RuleDecision,
): RuleDocument {
  const next = cloneRuleDocument(document);
  if (key.kind === "agent_call") {
    const targets = next.agent_calls[key.caller] ?? {};
    targets[key.target] = decision;
    next.agent_calls[key.caller] = targets;
  } else {
    next.actions[key.action] = decision;
  }
  return next;
}

export function withoutRule(
  document: RuleDocument,
  key: RuleKey,
): RuleDocument {
  const next = cloneRuleDocument(document);
  if (key.kind === "agent_call") {
    const targets = next.agent_calls[key.caller];
    if (targets !== undefined) {
      delete targets[key.target];
      if (Object.keys(targets).length === 0) {
        delete next.agent_calls[key.caller];
      }
    }
  } else {
    delete next.actions[key.action];
  }
  return next;
}

function parseRuleDocument(value: unknown): RuleDocument {
  if (!isPlainObject(value)) {
    throw new InvalidRuleError("rule state must be a JSON object");
  }

  const allowedRootKeys = new Set(["agent_calls", "actions"]);
  for (const key of Object.keys(value)) {
    if (!allowedRootKeys.has(key)) {
      throw new InvalidRuleError(`unknown rule section: ${key}`);
    }
  }

  const agentCallsValue = value.agent_calls ?? {};
  const actionsValue = value.actions ?? {};
  if (!isPlainObject(agentCallsValue)) {
    throw new InvalidRuleError("agent_calls must be a JSON object");
  }
  if (!isPlainObject(actionsValue)) {
    throw new InvalidRuleError("actions must be a JSON object");
  }

  const document = emptyRuleDocument();
  for (const [caller, targetsValue] of Object.entries(agentCallsValue)) {
    if (!isAgentName(caller) || !isPlainObject(targetsValue)) {
      throw new InvalidRuleError(`invalid agent_calls entry: ${caller}`);
    }
    const targets: Partial<Record<AgentName, RuleDecision>> = {};
    for (const [target, decision] of Object.entries(targetsValue)) {
      if (!isAgentName(target)) {
        throw new InvalidRuleError(`invalid target agent: ${target}`);
      }
      if (!isRuleDecision(decision)) {
        throw new InvalidRuleValueError(decision);
      }
      targets[target] = decision;
    }
    if (Object.keys(targets).length > 0) {
      document.agent_calls[caller] = targets;
    }
  }

  for (const [action, decision] of Object.entries(actionsValue)) {
    if (!isValidActionName(action)) {
      throw new InvalidRuleError(`invalid action name: ${action}`);
    }
    if (!isRuleDecision(decision)) {
      throw new InvalidRuleValueError(decision);
    }
    document.actions[action] = decision;
  }

  return document;
}

function cloneRuleDocument(document: RuleDocument): RuleDocument {
  const clone = emptyRuleDocument();
  for (const [caller, targets] of Object.entries(document.agent_calls)) {
    clone.agent_calls[caller as AgentName] = { ...targets };
  }
  Object.assign(clone.actions, document.actions);
  return clone;
}

function emptyRuleDocument(): {
  agent_calls: Partial<Record<AgentName, Partial<Record<AgentName, RuleDecision>>>>;
  actions: Record<string, RuleDecision>;
} {
  return { agent_calls: {}, actions: {} };
}

function isValidActionName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
