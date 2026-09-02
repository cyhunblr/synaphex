import type { AgentHandoff, AgentCallPurpose } from "./agent-context.js";
import type { AgentName } from "./agent.js";
import type { ArtifactPayload } from "./artifact.js";
import type { ProjectId } from "./project.js";
import type { TaskId } from "./task.js";

export const AGENT_RESULT_OUTCOMES = [
  "success",
  "needs_user",
  "blocked",
  "error",
] as const;

export type AgentResultOutcome = (typeof AGENT_RESULT_OUTCOMES)[number];

export interface RequestedAgentCall {
  readonly target: AgentName;
  readonly purpose: AgentCallPurpose;
  readonly handoff: AgentHandoff;
}

export interface AgentResultBase<TAgent extends AgentName> {
  readonly agent: TAgent;
  readonly outcome: AgentResultOutcome;
  readonly summary: string;
  readonly warnings?: readonly string[];
  readonly requestedCalls?: readonly RequestedAgentCall[];
}

export interface QuestionerPendingQuestionResult
  extends AgentResultBase<"questioner"> {
  readonly outcome: "needs_user";
  readonly state: "pending_question";
  readonly question: string;
  readonly workingContext?: ArtifactPayload;
}

export interface QuestionerContextCompleteResult
  extends AgentResultBase<"questioner"> {
  readonly outcome: "success" | "blocked" | "error";
  readonly state: "context_complete";
  readonly workingContext?: ArtifactPayload;
}

export type QuestionerResult =
  | QuestionerPendingQuestionResult
  | QuestionerContextCompleteResult;

export interface ResearcherResult extends AgentResultBase<"researcher"> {
  readonly researchArtifact: ArtifactPayload;
}

export type ExaminerMemoryIntent =
  | { readonly kind: "none" }
  | {
      readonly kind: "replace_project";
      readonly projectId: ProjectId;
      readonly content: string;
    }
  | {
      readonly kind: "replace_task";
      readonly projectId: ProjectId;
      readonly taskId: TaskId;
      readonly content: string;
    }
  | {
      readonly kind: "clear_project";
      readonly projectId: ProjectId;
    }
  | {
      readonly kind: "clear_task";
      readonly projectId: ProjectId;
      readonly taskId: TaskId;
    };

export interface MemoryConflict {
  readonly summary: string;
}

export interface ExaminerResult extends AgentResultBase<"examiner"> {
  readonly memoryIntent: ExaminerMemoryIntent;
  readonly memoryConflict?: MemoryConflict;
}

export const PLANNER_CONSULTATION_DISPOSITIONS = [
  "plan_still_valid",
  "revision_required",
] as const;

export type PlannerConsultationDisposition =
  (typeof PLANNER_CONSULTATION_DISPOSITIONS)[number];

export interface PlannerConsultation {
  readonly disposition: PlannerConsultationDisposition;
  readonly message: string;
}

export interface PlannerResult extends AgentResultBase<"planner"> {
  readonly draftPlanMarkdown?: string;
  readonly consultation?: PlannerConsultation;
}

export interface CoderResult extends AgentResultBase<"coder"> {
  readonly workRecord: ArtifactPayload;
}

export const REVIEWER_STATUSES = [
  "PASS",
  "PASS_WITH_WARNINGS",
  "FAIL",
] as const;
export type ReviewerStatus = (typeof REVIEWER_STATUSES)[number];

export const REVIEWER_FAILURE_ORIGINS = [
  "implementation",
  "plan",
  "mixed",
] as const;
export type ReviewerFailureOrigin =
  (typeof REVIEWER_FAILURE_ORIGINS)[number];

export interface ReviewerResult extends AgentResultBase<"reviewer"> {
  readonly reviewStatus: ReviewerStatus;
  readonly failureOrigin?: ReviewerFailureOrigin;
  readonly report: ArtifactPayload;
}

export type AgentResult =
  | QuestionerResult
  | ResearcherResult
  | ExaminerResult
  | PlannerResult
  | CoderResult
  | ReviewerResult;

export type AgentResultFor<TAgent extends AgentName> = Extract<
  AgentResult,
  { readonly agent: TAgent }
>;
