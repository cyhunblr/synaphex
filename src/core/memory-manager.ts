import {
  LockAcquisitionTimeout,
  RecoverableProcessLock,
} from "../infrastructure/recoverable-process-lock.js";
import {
  InvalidMemoryReferenceError,
  MemoryAlreadyLoadedError,
  MemoryLoadCycleError,
  MemoryMutationLockTimeoutError,
  MemoryNotLoadedError,
  MemorySourceNotFoundError,
  ProjectNotFoundError,
  TaskNotFoundError,
} from "../domain/errors.js";
import type {
  CanonicalMemoryRead,
  LoadedMemoryReference,
  MemoryScope,
  MemorySourceIdentity,
} from "../domain/memory.js";
import type { ProjectId } from "../domain/project.js";
import type { TaskId } from "../domain/task.js";
import { StateStore } from "../infrastructure/state-store.js";
import { ProjectManager } from "./project-manager.js";
import { projectStateDirectory } from "./project-state-path.js";
import { TaskManager } from "./task-manager.js";

interface StoredMemoryReference extends LoadedMemoryReference {
  readonly version: 1;
}

const MEMORY_MUTATION_LOCK_PATH = "state/memory-graph/.mutation-lock.json";
// Crash/stale-lock recovery is handled by RecoverableProcessLock (ADR 0004):
// a dead owner's mutex is reclaimed, while domain state is never rolled back.

export class MemoryManager {
  private readonly lock: RecoverableProcessLock;

  constructor(
    private readonly stateStore: StateStore,
    private readonly projectManager: ProjectManager,
    private readonly taskManager: TaskManager,
    lock?: RecoverableProcessLock,
  ) {
    this.lock = lock ?? new RecoverableProcessLock(stateStore);
  }

  async load(
    target: MemoryScope,
    source: MemorySourceIdentity,
  ): Promise<LoadedMemoryReference> {
    await this.validateScope(target);
    const validatedSource = await this.validateSource(source);
    const sourceScope = scopeFromSource(validatedSource);

    return this.withMutationLock(async () => {
      const loaded = await this.listLoadedReferences(target);
      if (loaded.some((reference) => sameScope(reference.source, sourceScope))) {
        throw new MemoryAlreadyLoadedError(target, sourceScope);
      }

      const allReferences = await this.listAllReferences();
      if (
        sameScope(target, sourceScope) ||
        isReachable(sourceScope, target, allReferences)
      ) {
        throw new MemoryLoadCycleError(target, sourceScope);
      }

      const reference: StoredMemoryReference = {
        version: 1,
        target,
        source: validatedSource,
        loadedAt: new Date().toISOString(),
      };
      const path = await this.referencePath(target, sourceScope);
      await this.stateStore.writeJson(path, reference);
      return withoutVersion(reference);
    });
  }

  async unload(
    target: MemoryScope,
    source: MemoryScope,
  ): Promise<void> {
    await this.validateScope(target);
    await this.validateScope(source);

    await this.withMutationLock(async () => {
      const loaded = await this.listLoadedReferences(target);
      if (!loaded.some((reference) => sameScope(reference.source, source))) {
        throw new MemoryNotLoadedError(target, source);
      }
      await this.stateStore.removeFile(await this.referencePath(target, source));
    });
  }

  async listLoadedReferences(
    target: MemoryScope,
  ): Promise<LoadedMemoryReference[]> {
    await this.validateScope(target);
    const loadedDirectory = await this.loadedDirectory(target);
    const files = (await this.stateStore.listFiles(loadedDirectory)).filter(
      (file) => file.endsWith(".json"),
    );
    const references: LoadedMemoryReference[] = [];

    for (const file of files) {
      let value: unknown;
      try {
        value = await this.stateStore.readJson<unknown>(
          `${loadedDirectory}/${file}`,
        );
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new InvalidMemoryReferenceError(
            "metadata is not valid JSON",
          );
        }
        throw error;
      }
      if (value === null) {
        continue;
      }
      if (!isStoredMemoryReference(value)) {
        throw new InvalidMemoryReferenceError("metadata has an invalid shape");
      }
      if (!sameScope(value.target, target)) {
        throw new InvalidMemoryReferenceError(
          "metadata target does not match its loaded-memory directory",
        );
      }

      const sourceScope = scopeFromSource(value.source);
      if (file !== referenceFileName(sourceScope)) {
        throw new InvalidMemoryReferenceError(
          "metadata filename does not match its source identity",
        );
      }
      try {
        await this.validateScope(sourceScope);
      } catch (error) {
        if (
          error instanceof MemorySourceNotFoundError ||
          error instanceof ProjectNotFoundError ||
          error instanceof TaskNotFoundError
        ) {
          throw new InvalidMemoryReferenceError(
            "referenced source scope no longer exists",
          );
        }
        throw error;
      }
      references.push(withoutVersion(value));
    }

    return references.sort((left, right) =>
      scopeId(scopeFromSource(left.source)).localeCompare(
        scopeId(scopeFromSource(right.source)),
      ),
    );
  }

  async isLoaded(target: MemoryScope, source: MemoryScope): Promise<boolean> {
    return (await this.listLoadedReferences(target)).some((reference) =>
      sameScope(reference.source, source),
    );
  }

  async resolveCanonicalSourceLocation(scope: MemoryScope): Promise<string> {
    await this.validateScope(scope);
    const memoryDirectory = await this.memoryDirectory(scope);
    return scope.kind === "project"
      ? `${memoryDirectory}/PROJECT.md`
      : `${memoryDirectory}/MEMORY.md`;
  }

  async getCanonicalMemory(scope: MemoryScope): Promise<CanonicalMemoryRead> {
    const content = await this.stateStore.readText(
      await this.resolveCanonicalSourceLocation(scope),
    );
    return { scope, hasContent: content !== null, content };
  }

  async getProjectCanonicalMemory(
    projectId: ProjectId,
  ): Promise<CanonicalMemoryRead> {
    return this.getCanonicalMemory({ kind: "project", projectId });
  }

  async getTaskCanonicalMemory(
    projectId: ProjectId,
    taskId: TaskId,
  ): Promise<CanonicalMemoryRead> {
    return this.getCanonicalMemory({ kind: "task", projectId, taskId });
  }

  async replaceCanonicalMemory(
    scope: MemoryScope,
    content: string,
  ): Promise<CanonicalMemoryRead> {
    const path = await this.resolveCanonicalSourceLocation(scope);
    await this.stateStore.writeText(path, content);
    return { scope, hasContent: true, content };
  }

  async clearCanonicalMemory(scope: MemoryScope): Promise<boolean> {
    const path = await this.resolveCanonicalSourceLocation(scope);
    const existed = await this.stateStore.exists(path);
    await this.stateStore.removeFile(path);
    return existed;
  }

  private async listAllReferences(): Promise<LoadedMemoryReference[]> {
    const references: LoadedMemoryReference[] = [];
    for (const project of await this.projectManager.list()) {
      references.push(
        ...(await this.listLoadedReferences({
          kind: "project",
          projectId: project.id,
        })),
      );
      const [openTasks, archivedTasks] = await Promise.all([
        this.taskManager.listOpen(project.id),
        this.taskManager.listArchived(project.id),
      ]);
      for (const task of [...openTasks, ...archivedTasks]) {
        references.push(
          ...(await this.listLoadedReferences({
            kind: "task",
            projectId: project.id,
            taskId: task.id,
          })),
        );
      }
    }
    return references;
  }

  private async referencePath(
    target: MemoryScope,
    source: MemoryScope,
  ): Promise<string> {
    return `${await this.loadedDirectory(target)}/${referenceFileName(source)}`;
  }

  private async loadedDirectory(scope: MemoryScope): Promise<string> {
    return `${await this.memoryDirectory(scope)}/loaded`;
  }

  private async memoryDirectory(scope: MemoryScope): Promise<string> {
    const project = await this.projectManager.get(scope.projectId);
    const projectDirectory = projectStateDirectory(project);
    if (scope.kind === "project") {
      return `${projectDirectory}/memory`;
    }
    const task = await this.taskManager.get(scope.projectId, scope.taskId);
    return `${projectDirectory}/memory/tasks/${task.id}_${task.slug}`;
  }

  private async validateSource(
    source: MemorySourceIdentity,
  ): Promise<MemorySourceIdentity> {
    const scope = scopeFromSource(source);
    await this.validateScope(scope);
    const project = await this.projectManager.get(scope.projectId);
    if (scope.kind === "project") {
      return {
        kind: "project",
        projectId: project.id,
        projectName: project.name,
      };
    }
    const task = await this.taskManager.get(scope.projectId, scope.taskId);
    return {
      kind: "task",
      projectId: project.id,
      projectName: project.name,
      taskId: task.id,
      taskSlug: task.slug,
    };
  }

  private async validateScope(scope: MemoryScope): Promise<void> {
    try {
      await this.projectManager.get(scope.projectId);
      if (scope.kind === "task") {
        await this.taskManager.get(scope.projectId, scope.taskId);
      }
    } catch (error) {
      if (
        error instanceof ProjectNotFoundError ||
        error instanceof TaskNotFoundError
      ) {
        throw new MemorySourceNotFoundError(scope);
      }
      throw error;
    }
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await this.lock.withLock(MEMORY_MUTATION_LOCK_PATH, operation);
    } catch (error) {
      // The shared primitive raises a generic timeout; each domain keeps its
      // own stable public error code so callers can still tell the lock
      // domains apart.
      if (error instanceof LockAcquisitionTimeout) {
        throw new MemoryMutationLockTimeoutError();
      }
      throw error;
    }
  }
}

function isReachable(
  start: MemoryScope,
  destination: MemoryScope,
  references: readonly LoadedMemoryReference[],
): boolean {
  const adjacency = new Map<string, MemoryScope[]>();
  for (const reference of references) {
    const targetId = scopeId(reference.target);
    const sources = adjacency.get(targetId) ?? [];
    sources.push(scopeFromSource(reference.source));
    adjacency.set(targetId, sources);
  }

  const destinationId = scopeId(destination);
  const pending = [start];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    const currentId = scopeId(current);
    if (currentId === destinationId) {
      return true;
    }
    if (visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);
    pending.push(...(adjacency.get(currentId) ?? []));
  }
  return false;
}

function scopeFromSource(source: MemorySourceIdentity): MemoryScope {
  return source.kind === "project"
    ? { kind: "project", projectId: source.projectId }
    : {
        kind: "task",
        projectId: source.projectId,
        taskId: source.taskId,
      };
}

function scopeId(scope: MemoryScope): string {
  return scope.kind === "project"
    ? `project:${scope.projectId}`
    : `task:${scope.projectId}:${scope.taskId}`;
}

function sameScope(
  left: MemoryScope | MemorySourceIdentity,
  right: MemoryScope | MemorySourceIdentity,
): boolean {
  return scopeId(toScope(left)) === scopeId(toScope(right));
}

function toScope(scope: MemoryScope | MemorySourceIdentity): MemoryScope {
  return scope.kind === "project"
    ? { kind: "project", projectId: scope.projectId }
    : {
        kind: "task",
        projectId: scope.projectId,
        taskId: scope.taskId,
      };
}

function referenceFileName(source: MemoryScope): string {
  return source.kind === "project"
    ? `project-${source.projectId}.json`
    : `task-${source.taskId}.json`;
}

function isStoredMemoryReference(value: unknown): value is StoredMemoryReference {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<StoredMemoryReference>;
  return (
    candidate.version === 1 &&
    isMemoryScope(candidate.target) &&
    isMemorySource(candidate.source) &&
    typeof candidate.loadedAt === "string"
  );
}

function isMemoryScope(value: unknown): value is MemoryScope {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<MemoryScope>;
  return (
    (candidate.kind === "project" && isProjectId(candidate.projectId)) ||
    (candidate.kind === "task" &&
      isProjectId(candidate.projectId) &&
      isTaskId(candidate.taskId))
  );
}

function isMemorySource(value: unknown): value is MemorySourceIdentity {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<MemorySourceIdentity>;
  return (
    (candidate.kind === "project" &&
      isProjectId(candidate.projectId) &&
      typeof candidate.projectName === "string") ||
    (candidate.kind === "task" &&
      isProjectId(candidate.projectId) &&
      typeof candidate.projectName === "string" &&
      isTaskId(candidate.taskId) &&
      typeof candidate.taskSlug === "string")
  );
}

function isProjectId(value: unknown): value is ProjectId {
  return typeof value === "string" && /^prj_[a-zA-Z0-9_-]+$/.test(value);
}

function isTaskId(value: unknown): value is TaskId {
  return typeof value === "string" && /^task_[a-zA-Z0-9_-]+$/.test(value);
}

function withoutVersion(
  reference: StoredMemoryReference,
): LoadedMemoryReference {
  return {
    target: reference.target,
    source: reference.source,
    loadedAt: reference.loadedAt,
  };
}
