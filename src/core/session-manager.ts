import {
  LockAcquisitionTimeout,
  RecoverableProcessLock,
} from "../infrastructure/recoverable-process-lock.js";
import { createHash, randomUUID } from "node:crypto";
import {
  NoProjectBoundError,
  SessionAlreadyBoundToTaskError,
  TaskAlreadyBoundError,
  TaskBindingLockTimeoutError,
  TaskSessionOwnershipLostError,
} from "../domain/errors.js";
import type { ProjectId } from "../domain/project.js";
import type { SessionBinding, SessionId } from "../domain/session.js";
import type { TaskId } from "../domain/task.js";
import { StateStore } from "../infrastructure/state-store.js";

interface TaskBindingClaim {
  readonly taskId: TaskId;
  readonly projectId: ProjectId;
  readonly sessionId: SessionId;
  readonly createdAt: string;
  /**
   * Opaque fencing token identifying this CLAIM INSTANCE.
   *
   * Optional on read so claims persisted before fencing existed stay readable;
   * every claim written from now on carries one. A legacy claim is upgraded
   * in place, under the ownership lock, the first time a fence is captured for
   * it (see `captureTaskOwnership`).
   *
   * Never derived from PID, provider, conversation or session identity -- a
   * release-and-reclaim always produces a different token, which is what makes
   * ABA impossible.
   */
  readonly ownershipToken?: string;
}

/**
 * Internal ownership fence: a snapshot of the exact task-claim instance an
 * operation is authorized under.
 *
 * This is internal authority state, NOT a user-facing credential. The
 * `ownershipToken` must never reach MCP tools, AgentContext, provider prompts,
 * artifacts or errors.
 */
export interface TaskOwnershipFence {
  readonly projectId: ProjectId;
  readonly taskId: TaskId;
  readonly sessionId: SessionId;
  readonly ownershipToken: string;
}

export interface SessionCloseResult {
  readonly sessionId: SessionId;
  /** True only when a task claim was actually released. */
  readonly released: boolean;
  readonly releasedTaskId: TaskId | null;
}

export interface TaskClaimReleaseResult {
  readonly taskId: TaskId;
  /** True only when a claim was actually released; false is a no-op. */
  readonly released: boolean;
  readonly previousSessionId: SessionId | null;
}

function generateOwnershipToken(): string {
  return randomUUID().replaceAll("-", "");
}

function isOwnershipToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

const TASK_BINDING_LOCK_PATH = "state/task-bindings/.ownership-lock.json";
// Crash/stale-lock recovery is handled by RecoverableProcessLock (ADR 0004):
// a dead owner's mutex is reclaimed, while domain state is never rolled back.

export class SessionManager {
  private readonly lock: RecoverableProcessLock;

  constructor(
    private readonly stateStore: StateStore,
    lock?: RecoverableProcessLock,
  ) {
    this.lock = lock ?? new RecoverableProcessLock(stateStore);
  }

  async getCurrentBinding(sessionId: SessionId): Promise<SessionBinding> {
    return (
      (await this.find(sessionId)) ?? {
        sessionId,
        projectId: null,
        taskId: null,
      }
    );
  }

  /**
   * Reads the stored *binding* for a session, or `null` when none exists.
   *
   * This is binding lookup, not session lookup: Synaphex stores no standalone
   * session record, so an unbound session and an unknown session are
   * indistinguishable. New code should prefer this name over `find`.
   */
  async findBinding(sessionId: SessionId): Promise<SessionBinding | null> {
    return this.find(sessionId);
  }

  /** @deprecated Ambiguous name; use {@link findBinding}. */
  async find(sessionId: SessionId): Promise<SessionBinding | null> {
    const binding = await this.stateStore.readJson<unknown>(
      sessionStatePath(sessionId),
    );
    if (binding === null) {
      return null;
    }
    if (!isSessionBinding(binding) || binding.sessionId !== sessionId) {
      throw new SyntaxError(`Invalid session state for session ${sessionId}`);
    }
    return binding;
  }

  async bindProject(
    sessionId: SessionId,
    projectId: ProjectId,
  ): Promise<SessionBinding> {
    const currentBinding = await this.getCurrentBinding(sessionId);
    if (currentBinding.taskId !== null) {
      throw new SessionAlreadyBoundToTaskError(
        sessionId,
        currentBinding.taskId,
      );
    }

    const binding: SessionBinding = {
      sessionId,
      projectId,
      taskId: currentBinding.taskId,
    };
    await this.stateStore.writeJson(sessionStatePath(sessionId), binding);
    return binding;
  }

  async bindTask(
    sessionId: SessionId,
    taskId: TaskId,
  ): Promise<SessionBinding> {
    return this.withTaskBindingLock(async () => {
      const currentBinding = await this.getCurrentBinding(sessionId);
      if (currentBinding.taskId !== null) {
        throw new SessionAlreadyBoundToTaskError(
          sessionId,
          currentBinding.taskId,
        );
      }
      if (currentBinding.projectId === null) {
        throw new NoProjectBoundError(sessionId);
      }

      const owner = await this.findTaskOwnerWhileLocked(taskId);
      if (owner !== null) {
        throw new TaskAlreadyBoundError(taskId, owner.sessionId);
      }

      const claim: TaskBindingClaim = {
        taskId,
        projectId: currentBinding.projectId,
        sessionId,
        createdAt: new Date().toISOString(),
        // A fresh token per claim instance: reclaiming the same task from the
        // same SessionId still yields a different token.
        ownershipToken: generateOwnershipToken(),
      };
      const claimCreated = await this.stateStore.createJsonExclusive(
        taskBindingClaimPath(taskId),
        claim,
      );
      if (!claimCreated) {
        const concurrentOwner = await this.findTaskOwnerWhileLocked(taskId);
        if (concurrentOwner !== null) {
          throw new TaskAlreadyBoundError(taskId, concurrentOwner.sessionId);
        }
        throw new Error(`Unable to acquire task binding claim for ${taskId}`);
      }

      const binding: SessionBinding = {
        sessionId,
        projectId: currentBinding.projectId,
        taskId,
      };
      try {
        await this.stateStore.writeJson(sessionStatePath(sessionId), binding);
      } catch (error) {
        await this.stateStore.removeFile(taskBindingClaimPath(taskId));
        throw error;
      }
      return binding;
    });
  }

  async unbindTask(sessionId: SessionId): Promise<SessionBinding> {
    return this.withTaskBindingLock(async () => {
      const currentBinding = await this.getCurrentBinding(sessionId);
      if (currentBinding.taskId === null) {
        return currentBinding;
      }

      const owner = await this.findTaskOwnerWhileLocked(currentBinding.taskId);
      if (owner !== null && owner.sessionId !== sessionId) {
        throw new TaskAlreadyBoundError(
          currentBinding.taskId,
          owner.sessionId,
        );
      }

      const binding: SessionBinding = {
        sessionId,
        projectId: currentBinding.projectId,
        taskId: null,
      };
      await this.stateStore.writeJson(sessionStatePath(sessionId), binding);
      await this.stateStore.removeFile(
        taskBindingClaimPath(currentBinding.taskId),
      );
      return binding;
    });
  }

  /**
   * Fully closes a logical session: releases any task claim it owns and
   * deletes its binding record.
   *
   * Everything happens inside the existing task-binding lock, so no concurrent
   * open, close or force-release can interleave. Task lifecycle, plans, memory
   * and artifacts are untouched, and no agent is invoked.
   *
   * Idempotent: closing an unknown or already-closed session reports
   * `released: false` rather than failing.
   *
   * Ordering (see the ADR's crash-window note): the claim is removed BEFORE
   * the binding record. If the process dies between the two, the claim is
   * already gone and the leftover binding is inert -- it names no task, and
   * `findTaskOwnerWhileLocked` cross-validates claims against bindings, so no
   * phantom ownership can result. The reverse order could leave a claim whose
   * binding has vanished, which is exactly the state that self-heal has to
   * clean up later.
   */
  async closeSession(sessionId: SessionId): Promise<SessionCloseResult> {
    return this.withTaskBindingLock(async () => {
      const binding = await this.find(sessionId);
      if (binding === null) {
        return { sessionId, released: false, releasedTaskId: null };
      }

      let releasedTaskId: TaskId | null = null;
      if (binding.taskId !== null) {
        const owner = await this.findTaskOwnerWhileLocked(binding.taskId);
        if (owner !== null && owner.sessionId !== sessionId) {
          // Another session owns this task; never release someone else's claim.
          throw new TaskAlreadyBoundError(binding.taskId, owner.sessionId);
        }
        await this.stateStore.removeFile(taskBindingClaimPath(binding.taskId));
        releasedTaskId = binding.taskId;
      }
      await this.stateStore.removeFile(sessionStatePath(sessionId));
      return { sessionId, released: releasedTaskId !== null, releasedTaskId };
    });
  }

  /**
   * User-driven recovery: releases whatever session currently claims a task,
   * without needing to know that session's id.
   *
   * This exists for the case where the caller lost the SessionId (provider
   * crashed, MCP process disappeared). It is NEVER triggered automatically --
   * not by disconnect, shutdown, timeout, process death, a failed open, or a
   * provider error. A normal second open against an occupied task still fails
   * with `TaskAlreadyBoundError`.
   *
   * Runs under the ownership lock and cleans up both the claim and the owning
   * session's binding record consistently. Task lifecycle, plans, memory and
   * artifacts are untouched. Idempotent: an unclaimed task is a successful
   * no-op reporting `released: false`.
   */
  async forceReleaseTaskClaim(taskId: TaskId): Promise<TaskClaimReleaseResult> {
    return this.withTaskBindingLock(async () => {
      // Cross-validates the claim against its owner's binding, and self-heals
      // an orphaned claim by removing it (reporting no owner).
      const owner = await this.findTaskOwnerWhileLocked(taskId);
      if (owner === null) {
        return { taskId, released: false, previousSessionId: null };
      }
      // Claim first, then the owner's binding record -- same ordering rationale
      // as closeSession.
      await this.stateStore.removeFile(taskBindingClaimPath(taskId));
      await this.stateStore.removeFile(sessionStatePath(owner.sessionId));
      return { taskId, released: true, previousSessionId: owner.sessionId };
    });
  }

  /**
   * Captures the exact task-ownership claim instance a session currently holds.
   *
   * Runs under the existing ownership lock (no competing lock is introduced)
   * and validates that: the session binding exists, it names a task, the
   * persisted claim exists and cross-validates against that binding, and the
   * claim carries a usable ownership token.
   *
   * Legacy compatibility: a claim persisted before fencing existed has no
   * token. Rather than inventing a deterministic fallback (which would permit
   * ABA), such a claim is upgraded in place -- a fresh token is written to it
   * under the same lock -- and the new token is returned.
   *
   * Returns `null` when the session holds no current task claim; callers that
   * require authority raise `TaskSessionOwnershipLostError`.
   */
  async captureTaskOwnership(
    sessionId: SessionId,
  ): Promise<TaskOwnershipFence | null> {
    return this.withTaskBindingLock(async () => {
      const binding = await this.find(sessionId);
      if (binding === null || binding.taskId === null || binding.projectId === null) {
        return null;
      }
      const owner = await this.findTaskOwnerWhileLocked(binding.taskId);
      if (owner === null || owner.sessionId !== sessionId) {
        return null;
      }
      const claimPath = taskBindingClaimPath(binding.taskId);
      const claim = await this.stateStore.readJson<unknown>(claimPath);
      if (!isTaskBindingClaim(claim) || claim.sessionId !== sessionId) {
        return null;
      }

      let ownershipToken = claim.ownershipToken;
      if (ownershipToken === undefined) {
        // Legacy claim upgrade, performed under the ownership lock.
        ownershipToken = generateOwnershipToken();
        await this.stateStore.writeJson(claimPath, {
          ...claim,
          ownershipToken,
        } satisfies TaskBindingClaim);
      }
      return {
        projectId: binding.projectId,
        taskId: binding.taskId,
        sessionId,
        ownershipToken,
      };
    });
  }

  /**
   * Runs a short deterministic operation only while an ownership fence is
   * still current, holding the authoritative task-binding lock throughout.
   *
   * This closes the check-then-act race that a bare `isTaskOwnershipCurrent`
   * followed by a durable write would leave open: a concurrent force release
   * or rebind cannot interleave between the validation and the operation,
   * because both take the same single ownership lock.
   *
   * It must cover ONLY a brief commit boundary. Never hold it across provider
   * execution -- the lock is process-wide for the task-binding subsystem, and
   * a long hold would block session open/close and recovery.
   */
  async withTaskOwnershipAuthority<T>(
    fence: TaskOwnershipFence,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.withTaskBindingLock(async () => {
      if (!(await this.isTaskOwnershipCurrentWhileLocked(fence))) {
        throw new TaskSessionOwnershipLostError(
          fence.taskId,
          fence.sessionId,
          "commit",
        );
      }
      return operation();
    });
  }

  /**
   * Reports whether an ownership fence still names the current claim instance.
   *
   * False when the task is unclaimed, the session was closed, the task was
   * force-released, a different session owns it, or the same SessionId owns a
   * NEW claim with a different token (the ABA case the token exists to defeat).
   */
  async isTaskOwnershipCurrent(fence: TaskOwnershipFence): Promise<boolean> {
    return this.withTaskBindingLock(() =>
      this.isTaskOwnershipCurrentWhileLocked(fence),
    );
  }

  private async isTaskOwnershipCurrentWhileLocked(
    fence: TaskOwnershipFence,
  ): Promise<boolean> {
    const claim = await this.stateStore.readJson<unknown>(
      taskBindingClaimPath(fence.taskId),
    );
    if (
      !isTaskBindingClaim(claim) ||
      claim.taskId !== fence.taskId ||
      claim.projectId !== fence.projectId ||
      claim.sessionId !== fence.sessionId ||
      claim.ownershipToken !== fence.ownershipToken
    ) {
      return false;
    }
    // The claim must still cross-validate against its owner's binding.
    const binding = await this.find(fence.sessionId);
    return (
      binding !== null &&
      binding.projectId === fence.projectId &&
      binding.taskId === fence.taskId
    );
  }

  /**
   * Reads the authoritative owner of a task claim, cross-validated against the
   * owner's binding by the same logic `bindTask` uses.
   */
  async findTaskOwner(taskId: TaskId): Promise<SessionBinding | null> {
    return this.withTaskBindingLock(() =>
      this.findTaskOwnerWhileLocked(taskId),
    );
  }

  async unbindProject(sessionId: SessionId): Promise<SessionBinding> {
    const currentBinding = await this.getCurrentBinding(sessionId);
    if (currentBinding.taskId !== null) {
      throw new SessionAlreadyBoundToTaskError(
        sessionId,
        currentBinding.taskId,
      );
    }

    const binding: SessionBinding = {
      sessionId,
      projectId: null,
      taskId: null,
    };
    await this.stateStore.writeJson(sessionStatePath(sessionId), binding);
    return binding;
  }

  private async findTaskOwnerWhileLocked(
    taskId: TaskId,
  ): Promise<SessionBinding | null> {
    const claimPath = taskBindingClaimPath(taskId);
    const claim = await this.stateStore.readJson<unknown>(claimPath);
    if (!isTaskBindingClaim(claim) || claim.taskId !== taskId) {
      if (claim !== null) {
        await this.stateStore.removeFile(claimPath);
      }
      return null;
    }

    const ownerBinding = await this.find(claim.sessionId);
    if (
      ownerBinding !== null &&
      ownerBinding.projectId === claim.projectId &&
      ownerBinding.taskId === claim.taskId
    ) {
      return ownerBinding;
    }

    await this.stateStore.removeFile(claimPath);
    return null;
  }

  private async withTaskBindingLock<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await this.lock.withLock(TASK_BINDING_LOCK_PATH, operation);
    } catch (error) {
      // The shared primitive raises a generic timeout; each domain keeps its
      // own stable public error code so callers can still tell the lock
      // domains apart.
      if (error instanceof LockAcquisitionTimeout) {
        throw new TaskBindingLockTimeoutError();
      }
      throw error;
    }
  }
}

function sessionStatePath(sessionId: SessionId): string {
  const safeId = createHash("sha256").update(sessionId).digest("hex");
  return `state/sessions/${safeId}.jsonc`;
}

function taskBindingClaimPath(taskId: TaskId): string {
  return `state/task-bindings/${taskId}.json`;
}

function isSessionBinding(value: unknown): value is SessionBinding {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<SessionBinding>;
  if (
    typeof candidate.sessionId !== "string" ||
    !(
      (typeof candidate.projectId === "string" &&
        candidate.projectId.startsWith("prj_")) ||
      candidate.projectId === null
    ) ||
    !(
      (typeof candidate.taskId === "string" &&
        candidate.taskId.startsWith("task_")) ||
      candidate.taskId === null
    )
  ) {
    return false;
  }

  return candidate.taskId === null || candidate.projectId !== null;
}

function isTaskBindingClaim(value: unknown): value is TaskBindingClaim {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<TaskBindingClaim>;
  return (
    typeof candidate.taskId === "string" &&
    candidate.taskId.startsWith("task_") &&
    typeof candidate.projectId === "string" &&
    candidate.projectId.startsWith("prj_") &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.createdAt === "string" &&
    // Absent is legal (legacy claim); present must be well-formed, so a
    // corrupted token cannot masquerade as valid authority.
    (candidate.ownershipToken === undefined ||
      isOwnershipToken(candidate.ownershipToken))
  );
}
