import type { ChangeSetApplyManager } from "../core/change-set-apply-manager.js";
import type { ArtifactManager } from "../core/artifact-manager.js";
import type { PlanManager } from "../core/plan-manager.js";
import type { ProjectManager } from "../core/project-manager.js";
import type { SessionManager } from "../core/session-manager.js";
import type { TaskManager } from "../core/task-manager.js";
import {
  NoTaskBoundError,
  PlanDraftPendingError,
  TaskHasPendingChangeSetError,
  TaskSessionOwnershipLostError,
} from "../domain/errors.js";
import type { ProjectId } from "../domain/project.js";
import { parseSessionId, type SessionId } from "../domain/session.js";
import type { Task, TaskId } from "../domain/task.js";

/** Safe lifecycle view. Carries no ownership token and no filesystem path. */
export interface TaskLifecycleState {
  readonly projectId: ProjectId;
  readonly taskId: TaskId;
  readonly status: Task["status"];
  readonly completedAt: string | null;
  readonly archivedAt: string | null;
}

export interface TaskCompletionResult extends TaskLifecycleState {
  readonly sessionId: SessionId;
  /** True while the completed task keeps its session binding. */
  readonly sessionRetained: boolean;
}

export interface TaskArchiveResult extends TaskLifecycleState {
  /** True when archiving released a task session that still owned the task. */
  readonly releasedTaskSession: boolean;
}

export interface TaskCompletionPort {
  completeTask(sessionId: SessionId): Promise<TaskCompletionResult>;
}

export interface TaskArchivePort {
  archiveTask(projectId: ProjectId, taskId: TaskId): Promise<TaskArchiveResult>;
}

export interface TaskLifecycleDependencies {
  readonly projects: Pick<ProjectManager, "get">;
  readonly tasks: Pick<TaskManager, "get" | "markCompleted" | "archive">;
  readonly plans: Pick<PlanManager, "hasDraft">;
  readonly artifacts: Pick<ArtifactManager, "listCoderWorkRecords">;
  readonly applyManager: Pick<ChangeSetApplyManager, "status">;
  readonly sessions: Pick<
    SessionManager,
    | "getCurrentBinding"
    | "captureTaskOwnership"
    | "isTaskOwnershipCurrent"
    | "withTaskOwnershipAuthority"
    | "findTaskOwner"
    | "forceReleaseTaskClaim"
  >;
}

/**
 * Deterministic user-driven task lifecycle: `active -> completed -> archived`.
 *
 * There is no reopen and no un-archive; new work after completion means a new
 * task. Neither operation touches the registered source workspace, runs Git,
 * invokes a provider or reaches the network.
 */
export class TaskLifecycleCommands
  implements TaskCompletionPort, TaskArchivePort
{
  constructor(private readonly dependencies: TaskLifecycleDependencies) {}

  /**
   * Completes the session's currently bound task at the user's explicit
   * request.
   *
   * Authority is the task-bound SessionId alone: no projectId, taskId, status
   * or force input exists, so a caller cannot complete a task it does not
   * currently own. REVIEWER PASS is deliberately NOT required -- a user may
   * complete without review -- but that is recorded as a user decision and
   * never as a fabricated Reviewer result.
   *
   * Completion does not archive, does not close the session and does not
   * release the task claim: a completed task stays bound until explicit
   * archive.
   */
  async completeTask(sessionId: SessionId): Promise<TaskCompletionResult> {
    const parsed = parseSessionId(sessionId);
    const binding = await this.dependencies.sessions.getCurrentBinding(parsed);
    if (binding.projectId === null || binding.taskId === null) {
      throw new NoTaskBoundError(parsed);
    }
    const projectId = binding.projectId;
    const taskId = binding.taskId;

    const fence = await this.dependencies.sessions.captureTaskOwnership(parsed);
    if (
      fence === null ||
      !(await this.dependencies.sessions.isTaskOwnershipCurrent(fence))
    ) {
      throw new TaskSessionOwnershipLostError(taskId, parsed, "commit");
    }

    // Blockers are re-read INSIDE the authority boundary together with the
    // durable write, so a decision made concurrently cannot slip between the
    // check and the transition.
    const completed = await this.dependencies.sessions.withTaskOwnershipAuthority(
      fence,
      async () => {
        await this.assertNoUnresolvedDecisions(projectId, taskId);
        // `markCompleted` owns the transition rule; an already completed or
        // archived task raises INVALID_TASK_TRANSITION from Core.
        return this.dependencies.tasks.markCompleted(projectId, taskId);
      },
    );

    return {
      sessionId: parsed,
      projectId,
      taskId,
      status: completed.status,
      completedAt: completed.completedAt,
      archivedAt: completed.archivedAt,
      sessionRetained: true,
    };
  }

  /**
   * Fails closed when the task still has an explicit decision flow pending.
   *
   * These are decisions Synaphex cannot make on the user's behalf, and
   * completing over them would strand authoritative state that nothing would
   * ever resolve.
   */
  private async assertNoUnresolvedDecisions(
    projectId: ProjectId,
    taskId: TaskId,
  ): Promise<void> {
    if (await this.dependencies.plans.hasDraft(taskId)) {
      throw new PlanDraftPendingError(taskId);
    }
    const records = await this.dependencies.artifacts.listCoderWorkRecords({
      kind: "task",
      projectId,
      taskId,
    });
    const latest = records[records.length - 1];
    // A legacy record has no `changeSet` field; a staged record with
    // `changeSet: null` changed nothing. Neither blocks completion.
    if (latest === undefined || !("changeSet" in latest) || latest.changeSet == null) {
      return;
    }
    const status = await this.dependencies.applyManager.status(
      taskId,
      latest.changeSet.id,
    );
    if (status.state === "pending" || status.state === "applying_interrupted") {
      throw new TaskHasPendingChangeSetError(
        taskId,
        latest.changeSet.id,
        status.state,
      );
    }
  }

  /**
   * Archives a completed task. Terminal: there is no reopen.
   *
   * Addressed administratively by `(projectId, taskId)` rather than by a
   * SessionId, because a completed task's session may legitimately be gone and
   * requiring the user to reopen it merely to archive would be perverse. The
   * client cannot supply an owner SessionId to force-close -- any owner is
   * discovered from authoritative task-binding state.
   *
   * Ordering is release-then-archive. A crash between the two leaves
   * `completed + unbound`, which is safe and simply retryable; the reverse
   * would leave a session claiming an archived task.
   */
  async archiveTask(
    projectId: ProjectId,
    taskId: TaskId,
  ): Promise<TaskArchiveResult> {
    await this.dependencies.projects.get(projectId);
    // Refuse an active task BEFORE touching any session state, so a failed
    // archive never releases a live task claim as a side effect.
    const task = await this.dependencies.tasks.get(projectId, taskId);
    if (task.status !== "completed") {
      // Core owns the transition rule and its error identity.
      return this.finalizeArchive(projectId, taskId, false);
    }

    // Discovered, never supplied. A completed task cannot be reclaimed as a
    // new active task under the accepted lifecycle, so releasing before
    // archiving cannot admit competing active work.
    const owner = await this.dependencies.sessions.findTaskOwner(taskId);
    let releasedTaskSession = false;
    if (owner !== null) {
      const release = await this.dependencies.sessions.forceReleaseTaskClaim(
        taskId,
      );
      releasedTaskSession = release.released;
    }
    return this.finalizeArchive(projectId, taskId, releasedTaskSession);
  }

  private async finalizeArchive(
    projectId: ProjectId,
    taskId: TaskId,
    releasedTaskSession: boolean,
  ): Promise<TaskArchiveResult> {
    // Preserves plans, artifacts, change sets, receipts and memory: the task
    // directory is MOVED into the archive collection, never pruned.
    const archived = await this.dependencies.tasks.archive(projectId, taskId);
    return {
      projectId,
      taskId,
      status: archived.status,
      completedAt: archived.completedAt,
      archivedAt: archived.archivedAt,
      releasedTaskSession,
    };
  }
}
