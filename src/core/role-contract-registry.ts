import type { AgentName } from "../domain/agent.js";
import type { TaskStatus } from "../domain/task.js";
import type {
  AgentCallPurpose,
  RoleContractSnapshot,
} from "../domain/agent-context.js";
import { ImmutableContractViolationError } from "../domain/errors.js";
import type { RuleDecision, RuleKey } from "../domain/rule.js";

export type CoderPlannerCallPurpose = Extract<
  AgentCallPurpose,
  "plan_clarification" | "implementation_deviation" | "plan_revision"
>;

export const CODER_PLANNER_CALL_PURPOSES = [
  "plan_clarification",
  "implementation_deviation",
  "plan_revision",
] as const satisfies readonly CoderPlannerCallPurpose[];

export interface AgentCallContractContext {
  readonly acceptedPlanExists: boolean;
  readonly purpose?: CoderPlannerCallPurpose;
}

export type RoleContractEvaluationReason =
  | "no_immutable_restriction"
  | "forbidden_edge"
  | "accepted_plan_required"
  | "unsupported_call_purpose"
  | "conditional_contract_satisfied";

export interface RoleContractEvaluation {
  readonly allowed: boolean;
  readonly reason: RoleContractEvaluationReason;
}

export interface AgentInvocationLifecycleContract {
  readonly taskBinding: "required" | "optional";
  readonly allowedTaskStatuses: readonly TaskStatus[];
}

const INVOCATION_LIFECYCLE_CONTRACTS = {
  questioner: {
    taskBinding: "required",
    allowedTaskStatuses: ["active"],
  },
  researcher: {
    taskBinding: "optional",
    allowedTaskStatuses: ["active", "completed"],
  },
  examiner: {
    taskBinding: "optional",
    allowedTaskStatuses: ["active", "completed"],
  },
  planner: {
    taskBinding: "required",
    allowedTaskStatuses: ["active"],
  },
  coder: {
    taskBinding: "required",
    allowedTaskStatuses: ["active"],
  },
  reviewer: {
    taskBinding: "required",
    allowedTaskStatuses: ["active"],
  },
} as const satisfies Readonly<
  Record<AgentName, AgentInvocationLifecycleContract>
>;

const SOURCE_MUTATION_CAPABILITIES: Readonly<Record<AgentName, boolean>> =
  Object.freeze({
    questioner: false,
    researcher: false,
    examiner: false,
    planner: false,
    coder: true,
    reviewer: false,
  });

const CANONICAL_MEMORY_CAPABILITIES: Readonly<Record<AgentName, boolean>> =
  Object.freeze({
    questioner: false,
    researcher: false,
    examiner: true,
    planner: false,
    coder: false,
    reviewer: false,
  });

const FORBIDDEN_OUTGOING_TARGETS = {
  questioner: [],
  researcher: [],
  examiner: [],
  planner: ["coder"],
  coder: ["reviewer"],
  reviewer: [],
} as const satisfies Readonly<Record<AgentName, readonly AgentName[]>>;

const FORBIDDEN_EDGES = new Set<string>(
  Object.entries(FORBIDDEN_OUTGOING_TARGETS).flatMap(([caller, targets]) =>
    targets.map((target) => edgeId(caller as AgentName, target)),
  ),
);

export class RoleContractRegistry {
  getInvocationLifecycleContract(
    agent: AgentName,
  ): AgentInvocationLifecycleContract {
    const contract = INVOCATION_LIFECYCLE_CONTRACTS[agent];
    return {
      taskBinding: contract.taskBinding,
      allowedTaskStatuses: [...contract.allowedTaskStatuses],
    };
  }

  canModifySourceCode(agent: AgentName): boolean {
    return SOURCE_MUTATION_CAPABILITIES[agent];
  }

  canWriteCanonicalMemory(agent: AgentName): boolean {
    return CANONICAL_MEMORY_CAPABILITIES[agent];
  }

  getSnapshot(agent: AgentName): RoleContractSnapshot {
    return {
      agent,
      mayModifySourceCode: this.canModifySourceCode(agent),
      mayWriteCanonicalMemory: this.canWriteCanonicalMemory(agent),
      forbiddenOutgoingTargets: [...FORBIDDEN_OUTGOING_TARGETS[agent]],
      conditionalOutgoingContracts:
        agent === "coder"
          ? [
              {
                target: "planner",
                allowedPurposes: [...CODER_PLANNER_CALL_PURPOSES],
                requiresAcceptedPlan: true,
              },
            ]
          : [],
    };
  }

  evaluateAgentCall(
    caller: AgentName,
    target: AgentName,
    context?: AgentCallContractContext,
  ): RoleContractEvaluation {
    if (FORBIDDEN_EDGES.has(edgeId(caller, target))) {
      return { allowed: false, reason: "forbidden_edge" };
    }

    if (caller === "coder" && target === "planner") {
      if (context?.acceptedPlanExists !== true) {
        return { allowed: false, reason: "accepted_plan_required" };
      }
      if (
        context.purpose === undefined ||
        !(CODER_PLANNER_CALL_PURPOSES as readonly string[]).includes(
          context.purpose,
        )
      ) {
        return { allowed: false, reason: "unsupported_call_purpose" };
      }
      return { allowed: true, reason: "conditional_contract_satisfied" };
    }

    return { allowed: true, reason: "no_immutable_restriction" };
  }

  assertConfigurableRuleAllowed(key: RuleKey, decision: RuleDecision): void {
    if (
      key.kind === "agent_call" &&
      decision !== "deny" &&
      FORBIDDEN_EDGES.has(edgeId(key.caller, key.target))
    ) {
      throw new ImmutableContractViolationError(key, decision);
    }
  }
}

function edgeId(caller: AgentName, target: AgentName): string {
  return `${caller}:${target}`;
}
