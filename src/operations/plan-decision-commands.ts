import type { PlanManager } from "../core/plan-manager.js";
import type { SessionManager } from "../core/session-manager.js";
import type { TaskManager } from "../core/task-manager.js";
import {
  NoTaskBoundError,
  TaskArchivedError,
  TaskCompletedError,
  TaskSessionOwnershipLostError,
} from "../domain/errors.js";
import type { PlanDraftRevisionId } from "../domain/plan.js";
import type { ProjectId } from "../domain/project.js";
import { parseSessionId, type SessionId } from "../domain/session.js";
import type { TaskId } from "../domain/task.js";

/**
 * Reviewable plan state for a task-bound session.
 *
 * `draft.revisionId` is the token a user must supply to decide about exactly
 * the draft instance they reviewed. It is an optimistic concurrency/identity
 * token -- NOT a SessionId, NOT the Phase-2C ownership token, and never an
 * authentication credential. No filesystem paths or archive contents are
 * exposed.
 */
export interface PlanReviewState {
  readonly sessionId: SessionId;
  readonly projectId: ProjectId;
  readonly taskId: TaskId;
  readonly draft: {
    readonly revisionId: PlanDraftRevisionId;
    readonly content: string;
  } | null;
  readonly current: { readonly content: string } | null;
}

export interface PlanDecisionResult {
  readonly sessionId: SessionId;
  readonly projectId: ProjectId;
  readonly taskId: TaskId;
  readonly draftRevisionId: PlanDraftRevisionId;
  /** Present on acceptance: the plan that is now current. */
  readonly currentContent?: string;
}

/**
 * Narrow application boundary for plan review and deterministic decisions.
 *
 * MCP handlers never receive a mutation-capable `PlanManager`. This layer owns
 * session -> task resolution, lifecycle validation, ownership validation,
 * revision comparison and mutation ordering; `PlanManager` owns the single plan
 * mutation lock and the file-level ordering.
 *
 * Only these deterministic operations may change plan authority. Natural
 * language in a Planner result has no authority whatsoever, and no agent can
 * reach these commands -- the user/host calls them explicitly.
 */
export interface PlanReadPort {
  getPlanReviewState(sessionId: SessionId): Promise<PlanReviewState>;
}

export interface PlanDecisionPort {
  acceptPlanDraft(
    sessionId: SessionId,
    draftRevisionId: PlanDraftRevisionId,
  ): Promise<PlanDecisionResult>;
  rejectPlanDraft(
    sessionId: SessionId,
    draftRevisionId: PlanDraftRevisionId,
  ): Promise<PlanDecisionResult>;
}

export interface PlanDecisionDependencies {
  readonly plans: Pick<
    PlanManager,
    "getDraftWithRevision" | "getCurrent" | "acceptDraft" | "rejectDraft"
  >;
  readonly tasks: Pick<TaskManager, "get">;
  readonly sessions: Pick<
    SessionManager,
    "getCurrentBinding" | "captureTaskOwnership" | "isTaskOwnershipCurrent"
  >;
}

export class PlanDecisionCommands implements PlanReadPort, PlanDecisionPort {
  constructor(private readonly dependencies: PlanDecisionDependencies) {}

  /**
   * Reads the reviewable plan state for a TASK-BOUND session.
   *
   * A project-only session cannot review or decide task plans. Project and
   * task come from the authoritative binding, never from the client.
   *
   * Note: this hydrates revision metadata for a legacy or crash-mismatched
   * draft. That is an internal consistency migration -- it assigns identity to
   * an existing draft and never alters the plan content under review.
   */
  async getPlanReviewState(sessionId: SessionId): Promise<PlanReviewState> {
    const scope = await this.resolveTaskScope(sessionId);
    const [draft, current] = await Promise.all([
      this.dependencies.plans.getDraftWithRevision(scope.taskId),
      this.dependencies.plans.getCurrent(scope.taskId),
    ]);
    return {
      sessionId: scope.sessionId,
      projectId: scope.projectId,
      taskId: scope.taskId,
      draft:
        draft === null
          ? null
          : { revisionId: draft.revisionId, content: draft.content },
      current: current === null ? null : { content: current.content },
    };
  }

  /**
   * Accepts exactly the reviewed draft instance.
   *
   * Order: resolve the task-bound session, validate task lifecycle, capture the
   * current task ownership fence, then revalidate that fence immediately before
   * the mutation. `PlanManager.acceptDraft` then verifies the exact revision
   * under the plan mutation lock and, atomically for the promotion, archives any
   * existing current plan and renames the draft into place.
   *
   * A revision mismatch mutates nothing and never discloses the new draft --
   * the user must read the plan state again.
   */
  async acceptPlanDraft(
    sessionId: SessionId,
    draftRevisionId: PlanDraftRevisionId,
  ): Promise<PlanDecisionResult> {
    const scope = await this.resolveTaskScope(sessionId);
    await this.assertOwnership(scope);
    const accepted = await this.dependencies.plans.acceptDraft(
      scope.taskId,
      draftRevisionId,
    );
    return {
      sessionId: scope.sessionId,
      projectId: scope.projectId,
      taskId: scope.taskId,
      draftRevisionId,
      currentContent: accepted.content,
    };
  }

  /**
   * Rejects and deletes exactly the reviewed draft instance.
   *
   * The current accepted plan is left unchanged, the draft is deleted rather
   * than archived, and the task lifecycle is untouched.
   */
  async rejectPlanDraft(
    sessionId: SessionId,
    draftRevisionId: PlanDraftRevisionId,
  ): Promise<PlanDecisionResult> {
    const scope = await this.resolveTaskScope(sessionId);
    await this.assertOwnership(scope);
    await this.dependencies.plans.rejectDraft(scope.taskId, draftRevisionId);
    return {
      sessionId: scope.sessionId,
      projectId: scope.projectId,
      taskId: scope.taskId,
      draftRevisionId,
    };
  }

  private async resolveTaskScope(sessionId: SessionId): Promise<{
    readonly sessionId: SessionId;
    readonly projectId: ProjectId;
    readonly taskId: TaskId;
  }> {
    const parsed = parseSessionId(sessionId);
    const binding = await this.dependencies.sessions.getCurrentBinding(parsed);
    if (binding.projectId === null || binding.taskId === null) {
      // Project-only sessions have no task plan to review or decide.
      throw new NoTaskBoundError(parsed);
    }
    const task = await this.dependencies.tasks.get(
      binding.projectId,
      binding.taskId,
    );
    if (task.status === "completed") {
      throw new TaskCompletedError(task.id);
    }
    if (task.status === "archived") {
      throw new TaskArchivedError(task.id);
    }
    return {
      sessionId: parsed,
      projectId: binding.projectId,
      taskId: binding.taskId,
    };
  }

  /**
   * Reuses the Phase-2C ownership fencing primitives; no second task ownership
   * system is invented. A plan decision is keyed by the session's CURRENT
   * ownership, never by taskId alone, so a force-released or replaced session
   * cannot decide on the new owner's behalf.
   */
  private async assertOwnership(scope: {
    readonly sessionId: SessionId;
    readonly taskId: TaskId;
  }): Promise<void> {
    const fence = await this.dependencies.sessions.captureTaskOwnership(
      scope.sessionId,
    );
    if (
      fence === null ||
      !(await this.dependencies.sessions.isTaskOwnershipCurrent(fence))
    ) {
      throw new TaskSessionOwnershipLostError(
        scope.taskId,
        scope.sessionId,
        "commit",
      );
    }
  }
}
