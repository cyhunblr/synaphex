import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  NoProjectBoundError,
  SessionAlreadyBoundToTaskError,
  TaskAlreadyBoundError,
  TaskBindingLockTimeoutError,
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
}

const TASK_BINDING_LOCK_PATH = "state/task-bindings/.ownership-lock.json";
const LOCK_RETRY_COUNT = 500;
const LOCK_RETRY_DELAY_MS = 10;
// TODO: Crash/stale-lock recovery is intentionally deferred to production hardening.

export class SessionManager {
  constructor(private readonly stateStore: StateStore) {}

  async getCurrentBinding(sessionId: SessionId): Promise<SessionBinding> {
    return (
      (await this.find(sessionId)) ?? {
        sessionId,
        projectId: null,
        taskId: null,
      }
    );
  }

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
    const token = randomUUID();
    for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt += 1) {
      const acquired = await this.stateStore.createJsonExclusive(
        TASK_BINDING_LOCK_PATH,
        {
          token,
          processId: process.pid,
          createdAt: new Date().toISOString(),
        },
      );
      if (acquired) {
        try {
          return await operation();
        } finally {
          await this.stateStore.removeFile(TASK_BINDING_LOCK_PATH);
        }
      }
      await delay(LOCK_RETRY_DELAY_MS);
    }

    throw new TaskBindingLockTimeoutError();
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
    typeof candidate.createdAt === "string"
  );
}
