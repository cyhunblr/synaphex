import type { TaskId } from "./task.js";

export type PlanStatus = "draft" | "accepted" | "archived";

export interface DraftPlan {
  readonly taskId: TaskId;
  readonly status: "draft";
  readonly content: string;
}

export interface AcceptedPlan {
  readonly taskId: TaskId;
  readonly status: "accepted";
  readonly content: string;
}

export interface ArchivedPlan {
  readonly taskId: TaskId;
  readonly status: "archived";
  readonly content: string;
  readonly archiveFileName: string;
}

export type Plan = DraftPlan | AcceptedPlan | ArchivedPlan;

export interface PlanAvailability {
  readonly hasDraft: boolean;
  readonly hasAcceptedPlan: boolean;
}
