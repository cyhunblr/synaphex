import type { TaskId } from "./task.js";

export type PlanStatus = "draft" | "accepted" | "archived";

/**
 * Opaque identity of a single draft WRITE INSTANCE.
 *
 * Independent of content: two byte-identical drafts written at different times
 * have different revision ids, which is what defeats same-content ABA. Not a
 * SessionId, not an ownership token, not invocation lineage, not a PID, not a
 * timestamp -- and never an authentication credential. It is an optimistic
 * concurrency/identity token safe to hand to a client.
 */
export type PlanDraftRevisionId = `planrev_${string}`;

export interface DraftPlan {
  readonly taskId: TaskId;
  readonly status: "draft";
  readonly content: string;
  readonly revisionId: PlanDraftRevisionId;
}

export interface AcceptedPlan {
  readonly taskId: TaskId;
  readonly status: "accepted";
  readonly content: string;
  /** Provenance: the draft instance that became this accepted plan. */
  readonly acceptedFromRevisionId?: PlanDraftRevisionId;
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
