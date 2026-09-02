import type { AgentBehavior } from "./agent-behavior.js";
import type { AgentName } from "./agent.js";
import type {
  ArtifactId,
  ArtifactRecord,
  CoderArtifactRecord,
  QuestionerContextRead,
  ResearchArtifactRecord,
  ReviewerArtifactRecord,
} from "./artifact.js";
import type {
  CanonicalMemoryRead,
  LoadedMemoryReference,
} from "./memory.js";
import type { AcceptedPlan, DraftPlan } from "./plan.js";
import type { Project } from "./project.js";
import type { EffectiveRule } from "./rule.js";
import type { SessionId } from "./session.js";
import type { Task } from "./task.js";

export const AGENT_CALL_PURPOSES = [
  "memory_update",
  "research",
  "clarification",
  "plan_clarification",
  "implementation_deviation",
  "plan_revision",
  "review_followup",
] as const;

export type AgentCallPurpose = (typeof AGENT_CALL_PURPOSES)[number];

export interface AgentHandoff {
  readonly caller: AgentName;
  readonly target: AgentName;
  readonly purpose: AgentCallPurpose;
  readonly summary: string;
  readonly question?: string;
  readonly artifactRefs?: readonly ArtifactId[];
}

export interface ConditionalOutgoingContract {
  readonly target: AgentName;
  readonly allowedPurposes: readonly AgentCallPurpose[];
  readonly requiresAcceptedPlan: boolean;
}

export interface RoleContractSnapshot {
  readonly agent: AgentName;
  readonly mayModifySourceCode: boolean;
  readonly mayWriteCanonicalMemory: boolean;
  readonly forbiddenOutgoingTargets: readonly AgentName[];
  readonly conditionalOutgoingContracts: readonly ConditionalOutgoingContract[];
}

export interface AgentRuleContext {
  readonly outgoingAgentCalls: readonly EffectiveRule[];
  readonly actions: readonly EffectiveRule[];
}

export interface LoadedMemoryContextEntry {
  readonly reference: LoadedMemoryReference;
  readonly memory: CanonicalMemoryRead;
}

export interface AgentMemoryContext {
  readonly project: CanonicalMemoryRead;
  readonly task: CanonicalMemoryRead | null;
  readonly directlyLoaded: readonly LoadedMemoryContextEntry[];
}

export interface AgentPlanContext {
  readonly current: AcceptedPlan | null;
  readonly draft: DraftPlan | null;
  readonly hasPendingDraft: boolean;
}

export interface AgentArtifactContext {
  readonly questionerContext: QuestionerContextRead | null;
  readonly research: readonly ResearchArtifactRecord[];
  readonly coderWorkRecords: readonly CoderArtifactRecord[];
  readonly latestReviewerReport: ReviewerArtifactRecord | null;
  readonly explicitlyReferenced: readonly ArtifactRecord[];
}

export interface AgentContext {
  readonly agent: AgentName;
  readonly project: Project;
  readonly task: Task | null;
  readonly roleContract: RoleContractSnapshot;
  readonly rules: AgentRuleContext;
  readonly memory: AgentMemoryContext;
  readonly plan: AgentPlanContext | null;
  readonly artifacts: AgentArtifactContext;
  readonly behavior: AgentBehavior | null;
  readonly instruction?: string;
  readonly handoff?: AgentHandoff;
}

export interface AgentContextRequest {
  readonly sessionId: SessionId;
  readonly agent: AgentName;
  readonly instruction?: string;
  readonly handoff?: AgentHandoff;
}
