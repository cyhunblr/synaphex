import type { ArtifactManager } from "../core/artifact-manager.js";
import type {
  ChangeSetApplyManager,
  ChangeSetDecisionRecord,
  ChangeSetState,
} from "../core/change-set-apply-manager.js";
import type {
  ChangeSetMetadata,
  CoderChangeSetManager,
} from "../core/coder-change-set-manager.js";
import type { ProjectManager } from "../core/project-manager.js";
import type { SessionManager } from "../core/session-manager.js";
import type { TaskManager } from "../core/task-manager.js";
import type { ChangedFile } from "../core/coder-workspace-stager.js";
import {
  ChangeSetNotAuthorizedError,
  ChangeSetNotCurrentTargetError,
  NoTaskBoundError,
  TaskSessionOwnershipLostError,
} from "../domain/errors.js";
import type { ProjectId } from "../domain/project.js";
import { parseSessionId, type SessionId } from "../domain/session.js";
import type { TaskId } from "../domain/task.js";

/**
 * Reviewable view of the task's current CODER change set.
 *
 * Exposes no staging path, no isolated Git HOME, no ownership token and no
 * absolute source path -- changed-file paths are repository-relative.
 */
export interface ChangeSetReview {
  readonly sessionId: SessionId;
  readonly projectId: ProjectId;
  readonly taskId: TaskId;
  readonly changeSetId: string;
  readonly baseCommit: string;
  readonly resultTree: string | null;
  readonly patchHash: string;
  readonly patchBytes: number;
  readonly changedFiles: readonly ChangedFile[];
  readonly state: ChangeSetState;
  readonly decidedAt: string | null;
  /** Artifact id of the CODER work record that authorises this change set. */
  readonly workRecordId: string;
}

export interface ChangeSetPatchChunk {
  readonly changeSetId: string;
  readonly offset: number;
  readonly returnedBytes: number;
  readonly nextOffset: number;
  readonly done: boolean;
  readonly totalBytes: number;
  /** Byte-exact authority. */
  readonly encoding: "base64";
  readonly data: string;
}

export interface ChangeSetDecisionOutcome {
  readonly sessionId: SessionId;
  readonly projectId: ProjectId;
  readonly taskId: TaskId;
  readonly changeSetId: string;
  readonly state: ChangeSetState;
  readonly decidedAt: string;
  readonly resultTree: string | null;
}

export interface ChangeSetReadPort {
  getChangeSet(
    sessionId: SessionId,
    changeSetId: string,
  ): Promise<ChangeSetReview>;
  readPatch(
    sessionId: SessionId,
    changeSetId: string,
    offset: number,
    maxBytes: number,
  ): Promise<ChangeSetPatchChunk>;
}

export interface ChangeSetDecisionPort {
  applyChangeSet(
    sessionId: SessionId,
    changeSetId: string,
  ): Promise<ChangeSetDecisionOutcome>;
  rejectChangeSet(
    sessionId: SessionId,
    changeSetId: string,
  ): Promise<ChangeSetDecisionOutcome>;
}

export interface ChangeSetCommandDependencies {
  readonly projects: Pick<ProjectManager, "get">;
  readonly tasks: Pick<TaskManager, "get">;
  readonly artifacts: Pick<ArtifactManager, "listCoderWorkRecords">;
  readonly changeSets: Pick<CoderChangeSetManager, "get">;
  readonly applyManager: Pick<
    ChangeSetApplyManager,
    "status" | "apply" | "reject" | "withSourceMutationLock"
  >;
  readonly sessions: Pick<
    SessionManager,
    | "getCurrentBinding"
    | "captureTaskOwnership"
    | "isTaskOwnershipCurrent"
    | "withTaskOwnershipAuthority"
  >;
}

/**
 * Narrow application boundary for exact change-set review and decisions.
 *
 * Authority rule: a change set is actionable only when the current task-bound
 * session owns the task, the change set is valid, it is referenced by an
 * authoritative CODER work record, it is the task's CURRENT target, and it has
 * not already been decided. Directory existence under `changes/` is never
 * sufficient -- that is what makes a Phase-5B orphan unusable.
 */
export class ChangeSetCommands
  implements ChangeSetReadPort, ChangeSetDecisionPort
{
  constructor(private readonly dependencies: ChangeSetCommandDependencies) {}

  async getChangeSet(
    sessionId: SessionId,
    changeSetId: string,
  ): Promise<ChangeSetReview> {
    const resolved = await this.resolveCurrentTarget(sessionId, changeSetId);
    const status = await this.dependencies.applyManager.status(
      resolved.taskId,
      changeSetId,
    );
    return {
      sessionId: resolved.sessionId,
      projectId: resolved.projectId,
      taskId: resolved.taskId,
      changeSetId,
      baseCommit: resolved.metadata.baseCommit,
      resultTree: resolved.metadata.resultTree ?? null,
      patchHash: resolved.metadata.patchHash,
      patchBytes: resolved.metadata.patchBytes,
      changedFiles: resolved.metadata.changedFiles.map((file) => ({ ...file })),
      state: status.state,
      decidedAt: status.decision?.decidedAt ?? null,
      workRecordId: resolved.workRecordId,
    };
  }

  /**
   * Returns a bounded slice of the ORIGINAL persisted patch bytes.
   *
   * Base64 preserves byte exactness for Git binary patches; the bytes are
   * never normalised or re-encoded. This reads only the selected authoritative
   * change-set patch -- it is not a general filesystem read.
   */
  async readPatch(
    sessionId: SessionId,
    changeSetId: string,
    offset: number,
    maxBytes: number,
  ): Promise<ChangeSetPatchChunk> {
    const resolved = await this.resolveCurrentTarget(sessionId, changeSetId);
    const patch = resolved.patch;
    const start = Math.min(offset, patch.byteLength);
    const end = Math.min(start + maxBytes, patch.byteLength);
    const slice = patch.subarray(start, end);
    return {
      changeSetId,
      offset: start,
      returnedBytes: slice.byteLength,
      nextOffset: end,
      done: end >= patch.byteLength,
      totalBytes: patch.byteLength,
      encoding: "base64",
      data: slice.toString("base64"),
    };
  }

  /**
   * Applies the exact reviewed change set to the registered source.
   *
   * Lock order is fixed and documented:
   *
   * ```text
   * source-mutation lock  ->  withTaskOwnershipAuthority(...)
   * ```
   *
   * so a force release cannot interleave while source mutation is in progress,
   * and two tasks sharing one registered project are serialised. Neither lock
   * is held across provider execution -- that already happened in Phase 5B.
   */
  async applyChangeSet(
    sessionId: SessionId,
    changeSetId: string,
  ): Promise<ChangeSetDecisionOutcome> {
    const resolved = await this.resolveCurrentTarget(sessionId, changeSetId);
    const fence = await this.requireOwnership(resolved);

    const receipt = await this.dependencies.applyManager.withSourceMutationLock(
      resolved.projectId,
      async () =>
        this.dependencies.sessions.withTaskOwnershipAuthority(fence, async () =>
          this.dependencies.applyManager.apply({
            project: resolved.project,
            taskId: resolved.taskId,
            metadata: resolved.metadata,
            patch: resolved.patch,
          }),
        ),
    );
    return this.toOutcome(resolved, receipt, "applied");
  }

  /**
   * Records an immutable rejection. No source mutation, no patch or change-set
   * deletion, and no CODER work-record mutation -- the proposed implementation
   * stays auditable and can never later be applied.
   *
   * Takes the same locks in the same order as apply, so a concurrent
   * apply/reject race has exactly one winner.
   */
  async rejectChangeSet(
    sessionId: SessionId,
    changeSetId: string,
  ): Promise<ChangeSetDecisionOutcome> {
    const resolved = await this.resolveCurrentTarget(sessionId, changeSetId);
    const fence = await this.requireOwnership(resolved);

    const receipt = await this.dependencies.applyManager.withSourceMutationLock(
      resolved.projectId,
      async () =>
        this.dependencies.sessions.withTaskOwnershipAuthority(fence, async () =>
          this.dependencies.applyManager.reject({
            taskId: resolved.taskId,
            metadata: resolved.metadata,
          }),
        ),
    );
    return this.toOutcome(resolved, receipt, "rejected");
  }

  private toOutcome(
    resolved: ResolvedTarget,
    receipt: ChangeSetDecisionRecord,
    state: ChangeSetState,
  ): ChangeSetDecisionOutcome {
    return {
      sessionId: resolved.sessionId,
      projectId: resolved.projectId,
      taskId: resolved.taskId,
      changeSetId: receipt.changeSetId,
      state,
      decidedAt: receipt.decidedAt,
      resultTree: receipt.resultTree ?? null,
    };
  }

  /**
   * Resolves the task from the session and verifies the change set is the
   * task's current authoritative CODER target.
   */
  private async resolveCurrentTarget(
    sessionId: SessionId,
    changeSetId: string,
  ): Promise<ResolvedTarget> {
    const parsed = parseSessionId(sessionId);
    const binding = await this.dependencies.sessions.getCurrentBinding(parsed);
    if (binding.projectId === null || binding.taskId === null) {
      throw new NoTaskBoundError(parsed);
    }
    const project = await this.dependencies.projects.get(binding.projectId);
    await this.dependencies.tasks.get(project.id, binding.taskId);

    const records = await this.dependencies.artifacts.listCoderWorkRecords({
      kind: "task",
      projectId: project.id,
      taskId: binding.taskId,
    });
    const latest = records[records.length - 1];
    // A change set with no work-record reference has no authority at all --
    // this is the Phase-5B orphan case.
    if (latest === undefined || !("changeSet" in latest) || latest.changeSet == null) {
      throw new ChangeSetNotAuthorizedError(binding.taskId, changeSetId);
    }
    // Only the LATEST staged CODER target is actionable, so an older change
    // set can never be applied out of order after newer CODER work exists.
    if (latest.changeSet.id !== changeSetId) {
      throw new ChangeSetNotCurrentTargetError(binding.taskId, changeSetId);
    }

    // Integrity is validated here, before any source mutation.
    const published = await this.dependencies.changeSets.get(
      binding.taskId,
      changeSetId,
    );
    return {
      sessionId: parsed,
      projectId: project.id,
      project,
      taskId: binding.taskId,
      metadata: published.metadata,
      patch: published.patch,
      workRecordId: latest.id,
    };
  }

  private async requireOwnership(resolved: ResolvedTarget) {
    const fence = await this.dependencies.sessions.captureTaskOwnership(
      resolved.sessionId,
    );
    if (
      fence === null ||
      !(await this.dependencies.sessions.isTaskOwnershipCurrent(fence))
    ) {
      throw new TaskSessionOwnershipLostError(
        resolved.taskId,
        resolved.sessionId,
        "commit",
      );
    }
    return fence;
  }
}

interface ResolvedTarget {
  readonly sessionId: SessionId;
  readonly projectId: ProjectId;
  readonly project: Awaited<ReturnType<ProjectManager["get"]>>;
  readonly taskId: TaskId;
  readonly metadata: ChangeSetMetadata;
  readonly patch: Buffer;
  readonly workRecordId: string;
}
