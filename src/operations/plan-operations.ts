import { PlanManager } from "../core/plan-manager.js";
import { ProjectManager } from "../core/project-manager.js";
import { SessionManager } from "../core/session-manager.js";
import { TaskManager } from "../core/task-manager.js";
import {
  NoTaskBoundError,
  TaskArchivedError,
  TaskCompletedError,
} from "../domain/errors.js";
import type { AcceptedPlan } from "../domain/plan.js";
import type { SessionId } from "../domain/session.js";
import { StateStore } from "../infrastructure/state-store.js";

export interface PlanOperationsOptions {
  readonly synaphexRoot?: string;
  readonly homeDirectory?: string;
}

export class PlanOperations {
  private readonly sessionManager: SessionManager;
  private readonly taskManager: TaskManager;
  private readonly planManager: PlanManager;

  constructor(options: PlanOperationsOptions = {}) {
    const stateStore = new StateStore(options.synaphexRoot);
    const projectManager = new ProjectManager(stateStore, {
      ...(options.homeDirectory === undefined
        ? {}
        : { homeDirectory: options.homeDirectory }),
    });
    this.sessionManager = new SessionManager(stateStore);
    this.taskManager = new TaskManager(stateStore, projectManager);
    this.planManager = new PlanManager(stateStore, this.taskManager);
  }

  async acceptPlan(sessionId: SessionId): Promise<AcceptedPlan> {
    const binding = await this.sessionManager.getCurrentBinding(sessionId);
    if (binding.projectId === null || binding.taskId === null) {
      throw new NoTaskBoundError(sessionId);
    }

    const task = await this.taskManager.get(binding.projectId, binding.taskId);
    if (task.status === "completed") {
      throw new TaskCompletedError(task.id);
    }
    if (task.status === "archived") {
      throw new TaskArchivedError(task.id);
    }

    return this.planManager.acceptDraft(task.id);
  }
}
