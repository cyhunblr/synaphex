import type { AgentName } from "./agent.js";
import type {
  AgentResultOutcome,
  MemoryConflict,
  RequestedAgentCall,
  ReviewerFailureOrigin,
  ReviewerStatus,
} from "./agent-result.js";
import type {
  ArtifactId,
  ArtifactScope,
  RunArtifactCategory,
  TaskArtifactScope,
} from "./artifact.js";
import type { MemoryScope } from "./memory.js";
import type { TaskId } from "./task.js";

export interface PersistedArtifactReference {
  readonly id: ArtifactId;
  readonly category: RunArtifactCategory;
  readonly scope: ArtifactScope;
}

export type AgentStateEffect =
  | {
      readonly kind: "questioner_context_saved";
      readonly scope: TaskArtifactScope;
    }
  | {
      readonly kind: "research_artifact_saved";
      readonly artifact: PersistedArtifactReference;
    }
  | {
      readonly kind: "project_memory_replaced";
      readonly scope: Extract<MemoryScope, { readonly kind: "project" }>;
    }
  | {
      readonly kind: "project_memory_cleared";
      readonly scope: Extract<MemoryScope, { readonly kind: "project" }>;
    }
  | {
      readonly kind: "task_memory_replaced";
      readonly scope: Extract<MemoryScope, { readonly kind: "task" }>;
    }
  | {
      readonly kind: "task_memory_cleared";
      readonly scope: Extract<MemoryScope, { readonly kind: "task" }>;
    }
  | {
      readonly kind: "plan_draft_saved";
      readonly taskId: TaskId;
    }
  | {
      readonly kind: "coder_artifact_saved";
      readonly artifact: PersistedArtifactReference;
    }
  | {
      readonly kind: "reviewer_artifact_saved";
      readonly artifact: PersistedArtifactReference;
    }
  | {
      readonly kind: "task_completed";
      readonly taskId: TaskId;
    };

export interface ProcessedAgentResultBase<TAgent extends AgentName> {
  readonly agent: TAgent;
  readonly outcome: AgentResultOutcome;
  readonly summary: string;
  readonly warnings: readonly string[];
  readonly persistedArtifacts: readonly PersistedArtifactReference[];
  readonly requestedCalls: readonly RequestedAgentCall[];
  readonly stateEffects: readonly AgentStateEffect[];
}

export interface ProcessedExaminerResult
  extends ProcessedAgentResultBase<"examiner"> {
  readonly memoryConflict?: MemoryConflict;
}

export interface ProcessedQuestionerPendingResult
  extends ProcessedAgentResultBase<"questioner"> {
  readonly state: "pending_question";
  readonly question: string;
}

export interface ProcessedQuestionerCompleteResult
  extends ProcessedAgentResultBase<"questioner"> {
  readonly state: "context_complete";
}

export type ProcessedQuestionerResult =
  | ProcessedQuestionerPendingResult
  | ProcessedQuestionerCompleteResult;

export interface ProcessedReviewerResult
  extends ProcessedAgentResultBase<"reviewer"> {
  readonly reviewStatus: ReviewerStatus;
  readonly failureOrigin?: ReviewerFailureOrigin;
}

export type ProcessedAgentResult =
  | ProcessedQuestionerResult
  | ProcessedAgentResultBase<"researcher">
  | ProcessedExaminerResult
  | ProcessedAgentResultBase<"planner">
  | ProcessedAgentResultBase<"coder">
  | ProcessedReviewerResult;

export type ProcessedAgentResultFor<TAgent extends AgentName> = Extract<
  ProcessedAgentResult,
  { readonly agent: TAgent }
>;
