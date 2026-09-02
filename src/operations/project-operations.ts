import { ProjectManager } from "../core/project-manager.js";
import { SessionManager } from "../core/session-manager.js";
import { SessionAlreadyBoundToTaskError } from "../domain/errors.js";
import type { Project } from "../domain/project.js";
import type { SessionId } from "../domain/session.js";
import { StateStore } from "../infrastructure/state-store.js";

export interface ProjectOperationsOptions {
  readonly synaphexRoot?: string;
  readonly homeDirectory?: string;
}

export class ProjectOperations {
  private readonly projectManager: ProjectManager;
  private readonly sessionManager: SessionManager;

  constructor(options: ProjectOperationsOptions = {}) {
    const stateStore = new StateStore(options.synaphexRoot);
    this.projectManager = new ProjectManager(stateStore, {
      ...(options.homeDirectory === undefined
        ? {}
        : { homeDirectory: options.homeDirectory }),
    });
    this.sessionManager = new SessionManager(stateStore);
  }

  async createProject(
    sessionId: SessionId,
    name: string,
    sourcePath: string,
  ): Promise<Project> {
    const currentBinding = await this.sessionManager.getCurrentBinding(sessionId);
    if (currentBinding.taskId !== null) {
      throw new SessionAlreadyBoundToTaskError(
        sessionId,
        currentBinding.taskId,
      );
    }

    const project = await this.projectManager.create(name, sourcePath);
    await this.sessionManager.bindProject(sessionId, project.id);
    return project;
  }

  async useProject(
    sessionId: SessionId,
    projectReference: string,
  ): Promise<Project> {
    const currentBinding = await this.sessionManager.getCurrentBinding(sessionId);
    if (currentBinding.taskId !== null) {
      throw new SessionAlreadyBoundToTaskError(
        sessionId,
        currentBinding.taskId,
      );
    }

    const project = await this.projectManager.resolve(projectReference);
    await this.sessionManager.bindProject(sessionId, project.id);
    return project;
  }
}
