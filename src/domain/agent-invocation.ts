import type {
  AgentCallPurpose,
  AgentContext,
  AgentHandoff,
} from "./agent-context.js";
import type { AgentName } from "./agent.js";
import type {
  AgentResultOutcome,
  PlannerConsultation,
  RequestedAgentCall,
  ReviewerFailureOrigin,
  ReviewerStatus,
} from "./agent-result.js";
import type {
  PersistedArtifactReference,
  ProcessedAgentResultFor,
} from "./processed-agent-result.js";
import type { ExecutionRoute } from "./provider-routing.js";
import type { HostRuntime } from "./provider-routing.js";
import type { EffectiveRule } from "./rule.js";
import type { SessionId } from "./session.js";
import type { SynaphexErrorCode } from "./errors.js";

export interface AgentExecutionInput {
  readonly route: ExecutionRoute;
  readonly context: AgentContext;
}

export interface AgentExecutor {
  execute(input: AgentExecutionInput): Promise<unknown>;
}

export interface UserAgentInvocationRequest<TAgent extends AgentName = AgentName> {
  readonly sessionId: SessionId;
  readonly agent: TAgent;
  readonly instruction?: string;
  readonly host: HostRuntime;
}

export type InvocationId = `invocation_${string}`;

export interface InvocationLineage {
  readonly rootInvocationId: InvocationId;
  readonly currentInvocationId: InvocationId;
  readonly parentInvocationId: InvocationId | null;
  readonly depth: number;
  readonly agent: AgentName;
}

export const HELPER_CALL_CLASSIFICATIONS = [
  "allowed",
  "approval_required",
  "denied",
  "forbidden",
  "unavailable",
] as const;

export type HelperCallClassificationStatus =
  (typeof HELPER_CALL_CLASSIFICATIONS)[number];

export type HelperCallImmutableReason =
  | "no_immutable_restriction"
  | "forbidden_edge"
  | "accepted_plan_required"
  | "unsupported_call_purpose"
  | "conditional_contract_satisfied";

export interface ConfigurableHelperCallClassification {
  readonly status: "allowed" | "approval_required" | "denied";
  readonly request: RequestedAgentCall;
  readonly immutableReason: HelperCallImmutableReason;
  readonly effectiveRule: EffectiveRule;
}

export interface ForbiddenHelperCallClassification {
  readonly status: "forbidden";
  readonly request: RequestedAgentCall;
  readonly immutableReason: Exclude<
    HelperCallImmutableReason,
    "no_immutable_restriction" | "conditional_contract_satisfied"
  >;
  readonly effectiveRule: null;
}

export type HelperCallUnavailableErrorCode = Extract<
  SynaphexErrorCode,
  | "INVALID_RULE"
  | "INVALID_RULE_VALUE"
  | "AGENT_UNCONFIGURED"
  | "AGENT_CONFIGURATION_REMOVED"
  | "INVALID_AGENT_CONFIG"
  | "INVALID_AGENT_MODEL"
  | "INVALID_AGENT_SETTING"
>;

export interface UnavailableHelperCallClassification {
  readonly status: "unavailable";
  readonly request: RequestedAgentCall;
  readonly immutableReason: HelperCallImmutableReason | null;
  readonly effectiveRule: null;
  readonly errorCode: HelperCallUnavailableErrorCode;
}

export type HelperCallClassification =
  | ConfigurableHelperCallClassification
  | ForbiddenHelperCallClassification
  | UnavailableHelperCallClassification;

export interface AgentInvocationResult<TAgent extends AgentName = AgentName> {
  readonly agent: TAgent;
  readonly lineage: InvocationLineage;
  readonly route: ExecutionRoute;
  readonly processedResult: ProcessedAgentResultFor<TAgent>;
  readonly helperCalls: readonly HelperCallClassification[];
}

export type AnyAgentInvocationResult = {
  readonly [TAgent in AgentName]: AgentInvocationResult<TAgent>;
}[AgentName];

export interface HelperExecutionRequest {
  readonly sessionId: SessionId;
  readonly parentInvocation: AnyAgentInvocationResult;
  readonly helperClassification: HelperCallClassification;
  readonly host: HostRuntime;
  readonly approvalGranted?: boolean;
}

export type HelperContinuationOutcome =
  | {
      readonly agent: "questioner";
      readonly outcome: AgentResultOutcome;
      readonly state: "pending_question" | "context_complete";
      readonly question?: string;
    }
  | {
      readonly agent: "researcher";
      readonly outcome: AgentResultOutcome;
    }
  | {
      readonly agent: "examiner";
      readonly outcome: AgentResultOutcome;
      readonly conflictSummary?: string;
    }
  | {
      readonly agent: "planner";
      readonly outcome: AgentResultOutcome;
      readonly consultation?: PlannerConsultation;
    }
  | {
      readonly agent: "coder";
      readonly outcome: AgentResultOutcome;
    }
  | {
      readonly agent: "reviewer";
      readonly outcome: AgentResultOutcome;
      readonly reviewStatus: ReviewerStatus;
      readonly failureOrigin?: ReviewerFailureOrigin;
    };

export type CallerContinuationStatus =
  | "ready"
  | "blocked_by_pending_plan";

export interface CallerContinuation {
  readonly status: CallerContinuationStatus;
  readonly originalCaller: AgentName;
  readonly helperAgent: AgentName;
  readonly originalPurpose: AgentCallPurpose;
  readonly helperSummary: string;
  readonly helperArtifactRefs: readonly PersistedArtifactReference[];
  readonly helperOutcome: HelperContinuationOutcome;
  readonly message?: string;
  readonly handoff: AgentHandoff;
  readonly lineage: InvocationLineage;
}

export interface HelperExecutionResult {
  readonly previousClassification: HelperCallClassification;
  readonly effectiveClassification: HelperCallClassification;
  readonly helperInvocation: AnyAgentInvocationResult;
  readonly continuation: CallerContinuation;
}

export interface ResumeCallerRequest {
  readonly sessionId: SessionId;
  readonly helperExecution: HelperExecutionResult;
  readonly host: HostRuntime;
  readonly instruction?: string;
}
