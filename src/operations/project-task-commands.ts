import type { ProjectManager } from "../core/project-manager.js";
import type { SessionManager } from "../core/session-manager.js";
import type { TaskManager } from "../core/task-manager.js";
import type { Project, ProjectId } from "../domain/project.js";
import {
  generateSessionId,
  type SessionBinding,
} from "../domain/session.js";
import type { Task } from "../domain/task.js";

/**
 * Narrow application command boundary for project/task bootstrap and
 * project-only session creation.
 *
 * MCP receives only these methods -- never a mutation-capable
 * `ProjectManager`, `TaskManager`, `SessionManager` or `StateStore`. All
 * validation, path canonicalization, ID generation and lifecycle semantics
 * stay in Core; nothing is duplicated here.
 *
 * Deliberately absent: project deletion, task completion/archival/reopen, plan
 * lifecycle, host actions and agent invocation. Creating a project, task or
 * session never invokes an agent -- every transition stays an explicit call.
 */
export interface ProjectCommandPort {
  registerProject(name: string, sourcePath: string): Promise<Project>;
}

export interface TaskCommandPort {
  createTask(projectId: ProjectId, description: string): Promise<Task>;
}

export interface ProjectSessionCommandPort {
  openProjectSession(projectId: ProjectId): Promise<SessionBinding>;
}

export interface ProjectTaskCommandsDependencies {
  readonly projects: Pick<ProjectManager, "create" | "get">;
  readonly tasks: Pick<TaskManager, "create">;
  readonly sessions: Pick<SessionManager, "bindProject">;
}

export class ProjectTaskCommands
  implements ProjectCommandPort, TaskCommandPort, ProjectSessionCommandPort
{
  constructor(
    private readonly dependencies: ProjectTaskCommandsDependencies,
  ) {}

  /**
   * Registers an EXISTING source workspace.
   *
   * `ProjectManager.create` owns the authoritative behavior: it expands `~`,
   * resolves the real path, requires the path to exist and be a directory, and
   * stores the canonical path. It never creates, clones or git-initializes the
   * user's source tree -- only Synaphex's own state under the Synaphex root is
   * written.
   *
   * Duplicate source paths are NOT deduplicated: registering an
   * already-registered canonical path raises Core's
   * `ProjectPathAlreadyRegisteredError`. That existing semantic is preserved
   * rather than silently returning the existing project.
   */
  async registerProject(name: string, sourcePath: string): Promise<Project> {
    return this.dependencies.projects.create(name, sourcePath);
  }

  /**
   * Creates a new `active` task in an existing project.
   *
   * Uses `TaskManager.create`, which validates the project, normalizes and
   * requires a non-empty description, generates the canonical `task_*` id and
   * slug, and scaffolds task state. It binds NO session and acquires NO task
   * ownership claim -- session binding is a separate explicit step, so no
   * duplicate claim can arise.
   *
   * (`TaskOperations.createTask` couples creation to an existing bound
   * session; that path is for the terminal surface and is deliberately not
   * used here.)
   */
  async createTask(projectId: ProjectId, description: string): Promise<Task> {
    return this.dependencies.tasks.create(projectId, description);
  }

  /**
   * Opens a canonical logical session bound only to a project.
   *
   * A project-only session has `taskId: null`, no `TaskBindingClaim` and no
   * ownership token -- project-scoped invocation is unfenced, exactly as Phase
   * 2C accepted. No task is selected or created.
   */
  async openProjectSession(projectId: ProjectId): Promise<SessionBinding> {
    const project = await this.dependencies.projects.get(projectId);
    const sessionId = generateSessionId();
    return this.dependencies.sessions.bindProject(sessionId, project.id);
  }
}
