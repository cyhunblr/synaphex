import type { ProjectManager } from "../core/project-manager.js";
import type {
  SessionCloseResult,
  SessionManager,
  TaskClaimReleaseResult,
} from "../core/session-manager.js";
import type { TaskManager } from "../core/task-manager.js";
import { TaskArchivedError, TaskCompletedError } from "../domain/errors.js";
import type { ProjectId } from "../domain/project.js";
import {
  generateSessionId,
  parseSessionId,
  type SessionBinding,
  type SessionId,
} from "../domain/session.js";
import type { TaskId } from "../domain/task.js";

/**
 * Narrow application command boundary for logical Synaphex session lifecycle.
 *
 * This is the only ordinary mutation surface MCP receives (recovery has its
 * own port below). It owns validation, lifecycle checks, binding semantics and
 * operation ordering; MCP handlers only validate wire input, call a command,
 * and map the result.
 *
 * It deliberately exposes no task/project creation, no lifecycle transition
 * (complete/archive), no plan, memory or artifact mutation, and no agent
 * invocation. Claim atomicity and the one-writable-session-per-task invariant
 * remain owned by `SessionManager`; nothing is reimplemented here.
 *
 * Naming: `closeSession` fully closes a logical session -- it releases the
 * task claim AND deletes the binding record. The Phase-2A operation of the
 * same name released only the claim while permanently retaining a
 * project-binding record; that shape is gone, because accumulating
 * project-only "closed session" records served no architectural purpose.
 */
export interface SessionCommandPort {
  openTaskSession(projectId: ProjectId, taskId: TaskId): Promise<SessionBinding>;
  closeSession(sessionId: SessionId): Promise<SessionCloseResult>;
}

/**
 * Explicit user-driven recovery boundary, kept separate from ordinary session
 * commands so that force release can never be reached by accident.
 *
 * Synaphex has no lease, heartbeat, PID check or automatic stale-session
 * expiry: a logical session is not a process lease. A provider host may
 * restart, disconnect, idle or reconnect without releasing anything. Recovery
 * is therefore an explicit action the user takes.
 */
export interface SessionRecoveryPort {
  getTaskSessionOwner(
    projectId: ProjectId,
    taskId: TaskId,
  ): Promise<TaskSessionOwner>;
  forceReleaseTaskSession(
    projectId: ProjectId,
    taskId: TaskId,
  ): Promise<TaskClaimReleaseResult>;
}

export type TaskSessionOwner =
  | {
      readonly projectId: ProjectId;
      readonly taskId: TaskId;
      readonly claimed: false;
    }
  | {
      readonly projectId: ProjectId;
      readonly taskId: TaskId;
      readonly claimed: true;
      readonly sessionId: SessionId;
    };

export interface SessionCommandsDependencies {
  readonly projects: Pick<ProjectManager, "get">;
  readonly tasks: Pick<TaskManager, "get">;
  readonly sessions: Pick<
    SessionManager,
    | "bindProject"
    | "bindTask"
    | "closeSession"
    | "findTaskOwner"
    | "forceReleaseTaskClaim"
  >;
}

export class SessionCommands
  implements SessionCommandPort, SessionRecoveryPort
{
  constructor(private readonly dependencies: SessionCommandsDependencies) {}

  /**
   * Opens a new logical Synaphex session bound to an existing active task.
   *
   * Order of operations:
   *  1. validate the project exists (`ProjectManager.get`)
   *  2. validate the task exists within it (`TaskManager.get`)
   *  3. validate task lifecycle -- completed and archived tasks are refused,
   *     matching `TaskOperations.resumeTask`
   *  4. generate a fresh canonical SessionId (always `ses_*`)
   *  5. bind the project, then atomically claim the task through
   *     `SessionManager.bindTask`, which owns the lock and the
   *     one-writable-session-per-task invariant
   *
   * A task already claimed by another live session surfaces Core's typed
   * `TaskAlreadyBoundError`. The claim is never stolen, no other session is
   * auto-unbound, and no force release is triggered -- recovery stays explicit.
   */
  async openTaskSession(
    projectId: ProjectId,
    taskId: TaskId,
  ): Promise<SessionBinding> {
    const { projects, tasks, sessions } = this.dependencies;
    const project = await projects.get(projectId);
    const task = await tasks.get(project.id, taskId);
    if (task.status === "completed") {
      throw new TaskCompletedError(task.id);
    }
    if (task.status === "archived") {
      throw new TaskArchivedError(task.id);
    }

    const sessionId = generateSessionId();
    await sessions.bindProject(sessionId, project.id);
    // bindTask performs the atomic claim under the existing task-binding lock.
    return sessions.bindTask(sessionId, task.id);
  }

  /**
   * Fully closes a logical session: releases its task claim (if any) and
   * deletes its binding record, leaving no stale session state behind.
   *
   * This is not task completion: task status, plans, memory and artifacts are
   * untouched, and no agent is invoked. Idempotent -- an unknown or
   * already-closed session reports `released: false` rather than failing, so
   * the result never claims success where nothing changed.
   */
  async closeSession(sessionId: SessionId): Promise<SessionCloseResult> {
    return this.dependencies.sessions.closeSession(parseSessionId(sessionId));
  }

  /**
   * Reads which session, if any, currently claims a task.
   *
   * Reads through the authoritative task-binding subsystem
   * (`SessionManager.findTaskOwner`), which cross-validates the claim against
   * the owner's binding using the same logic `bindTask` uses. No raw state
   * files are scanned.
   *
   * The owner SessionId is deliberately disclosed: this is a local,
   * user-orchestrated stdio system and recovery requires a discoverable owner.
   */
  async getTaskSessionOwner(
    projectId: ProjectId,
    taskId: TaskId,
  ): Promise<TaskSessionOwner> {
    const { projects, tasks, sessions } = this.dependencies;
    const project = await projects.get(projectId);
    const task = await tasks.get(project.id, taskId);
    const owner = await sessions.findTaskOwner(task.id);
    if (owner === null) {
      return { projectId: project.id, taskId: task.id, claimed: false };
    }
    return {
      projectId: project.id,
      taskId: task.id,
      claimed: true,
      sessionId: owner.sessionId,
    };
  }

  /**
   * Explicit user recovery: releases whatever session claims this task,
   * without requiring the old SessionId (the recovery case is precisely that
   * the caller lost it).
   *
   * Never triggered automatically. Task lifecycle, plans, memory and artifacts
   * are untouched; no provider, agent, shell or network is involved.
   * Idempotent -- an unclaimed task is a successful no-op with
   * `released: false`, not an exception.
   */
  async forceReleaseTaskSession(
    projectId: ProjectId,
    taskId: TaskId,
  ): Promise<TaskClaimReleaseResult> {
    const { projects, tasks, sessions } = this.dependencies;
    const project = await projects.get(projectId);
    const task = await tasks.get(project.id, taskId);
    return sessions.forceReleaseTaskClaim(task.id);
  }
}
