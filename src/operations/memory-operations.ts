import { MemoryManager } from "../core/memory-manager.js";
import { ProjectManager } from "../core/project-manager.js";
import { SessionManager } from "../core/session-manager.js";
import { TaskManager } from "../core/task-manager.js";
import {
  NoProjectBoundError,
  TaskArchivedError,
} from "../domain/errors.js";
import type {
  LoadedMemoryReference,
  MemoryLoadRequest,
  MemoryScope,
  MemorySourceIdentity,
  MemorySourceRequest,
  MemoryUnloadRequest,
} from "../domain/memory.js";
import type { SessionId } from "../domain/session.js";
import { StateStore } from "../infrastructure/state-store.js";

export interface MemoryOperationsOptions {
  readonly synaphexRoot?: string;
  readonly homeDirectory?: string;
}

/**
 * The memory surface Synaphex exposes over MCP.
 *
 * Loading is deliberately NOT canonical memory mutation: it records a managed
 * reference so the current scope can see another scope's memory. Writing
 * canonical memory stays an EXAMINER-only capability enforced by role
 * contract, and nothing here grants it.
 */
export interface MemoryReferencePort {
  loadMemory(request: MemoryLoadRequest): Promise<LoadedMemoryReference>;
  unloadMemory(request: MemoryUnloadRequest): Promise<void>;
  listLoadedMemory(sessionId: SessionId): Promise<LoadedMemoryReference[]>;
}

export class MemoryOperations implements MemoryReferencePort {
  private readonly projectManager: ProjectManager;
  private readonly sessionManager: SessionManager;
  private readonly taskManager: TaskManager;
  private readonly memoryManager: MemoryManager;

  constructor(options: MemoryOperationsOptions = {}) {
    const stateStore = new StateStore(options.synaphexRoot);
    this.projectManager = new ProjectManager(stateStore, {
      ...(options.homeDirectory === undefined
        ? {}
        : { homeDirectory: options.homeDirectory }),
    });
    this.sessionManager = new SessionManager(stateStore);
    this.taskManager = new TaskManager(stateStore, this.projectManager);
    this.memoryManager = new MemoryManager(
      stateStore,
      this.projectManager,
      this.taskManager,
    );
  }

  async loadMemory(request: MemoryLoadRequest): Promise<LoadedMemoryReference> {
    const [target, source] = await Promise.all([
      this.resolveTarget(request.sessionId),
      this.resolveSource(request),
    ]);
    return this.memoryManager.load(target, source);
  }

  async unloadMemory(request: MemoryUnloadRequest): Promise<void> {
    const [target, source] = await Promise.all([
      this.resolveTarget(request.sessionId),
      this.resolveSource(request),
    ]);
    await this.memoryManager.unload(target, sourceScope(source));
  }

  async listLoadedMemory(
    sessionId: SessionId,
  ): Promise<LoadedMemoryReference[]> {
    return this.memoryManager.listLoadedReferences(
      await this.resolveTarget(sessionId),
    );
  }

  private async resolveTarget(sessionId: SessionId): Promise<MemoryScope> {
    const binding = await this.sessionManager.getCurrentBinding(sessionId);
    if (binding.projectId === null) {
      throw new NoProjectBoundError(sessionId);
    }
    if (binding.taskId === null) {
      return { kind: "project", projectId: binding.projectId };
    }

    const task = await this.taskManager.get(binding.projectId, binding.taskId);
    if (task.status === "archived") {
      throw new TaskArchivedError(task.id);
    }
    return {
      kind: "task",
      projectId: binding.projectId,
      taskId: binding.taskId,
    };
  }

  private async resolveSource(
    request: MemorySourceRequest,
  ): Promise<MemorySourceIdentity> {
    const project = await this.projectManager.resolve(request.sourceProjectRef);
    if (request.sourceTaskRef === undefined) {
      return {
        kind: "project",
        projectId: project.id,
        projectName: project.name,
      };
    }

    const task = await this.taskManager.resolve(
      project.id,
      request.sourceTaskRef,
    );
    return {
      kind: "task",
      projectId: project.id,
      projectName: project.name,
      taskId: task.id,
      taskSlug: task.slug,
    };
  }
}

function sourceScope(source: MemorySourceIdentity): MemoryScope {
  return source.kind === "project"
    ? { kind: "project", projectId: source.projectId }
    : {
        kind: "task",
        projectId: source.projectId,
        taskId: source.taskId,
      };
}
