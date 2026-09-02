import { ProjectManager } from "../core/project-manager.js";
import { SessionManager } from "../core/session-manager.js";
import { TaskManager } from "../core/task-manager.js";
import {
  NoProjectBoundError,
  SessionAlreadyBoundToTaskError,
  TaskArchivedError,
  TaskCompletedError,
} from "../domain/errors.js";
import type { SessionId } from "../domain/session.js";
import type { Task } from "../domain/task.js";
import { StateStore } from "../infrastructure/state-store.js";

export interface TaskOperationsOptions {
  readonly synaphexRoot?: string;
  readonly homeDirectory?: string;
}

export class TaskOperations {
  private readonly projectManager: ProjectManager;
  private readonly sessionManager: SessionManager;
  private readonly taskManager: TaskManager;

  constructor(options: TaskOperationsOptions = {}) {
    const stateStore = new StateStore(options.synaphexRoot);
    this.projectManager = new ProjectManager(stateStore, {
      ...(options.homeDirectory === undefined
        ? {}
        : { homeDirectory: options.homeDirectory }),
    });
    this.sessionManager = new SessionManager(stateStore);
    this.taskManager = new TaskManager(stateStore, this.projectManager);
  }

  async createTask(
    sessionId: SessionId,
    description: string,
  ): Promise<Task> {
    const binding = await this.sessionManager.getCurrentBinding(sessionId);
    if (binding.projectId === null) {
      throw new NoProjectBoundError(sessionId);
    }
    if (binding.taskId !== null) {
      throw new SessionAlreadyBoundToTaskError(sessionId, binding.taskId);
    }

    const project = await this.projectManager.get(binding.projectId);
    const task = await this.taskManager.create(project.id, description);
    await this.sessionManager.bindTask(sessionId, task.id);
    return task;
  }

  async resumeTask(
    sessionId: SessionId,
    taskReference: string,
  ): Promise<Task> {
    const binding = await this.sessionManager.getCurrentBinding(sessionId);
    if (binding.projectId === null) {
      throw new NoProjectBoundError(sessionId);
    }
    if (binding.taskId !== null) {
      throw new SessionAlreadyBoundToTaskError(sessionId, binding.taskId);
    }

    const task = await this.taskManager.resolve(
      binding.projectId,
      taskReference,
    );
    if (task.status === "completed") {
      throw new TaskCompletedError(task.id);
    }
    if (task.status === "archived") {
      throw new TaskArchivedError(task.id);
    }

    await this.sessionManager.bindTask(sessionId, task.id);
    return task;
  }
}
