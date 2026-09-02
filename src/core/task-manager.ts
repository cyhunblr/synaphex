import { randomUUID } from "node:crypto";
import {
  AmbiguousTaskReferenceError,
  InvalidTaskDescriptionError,
  InvalidTaskTransitionError,
  TaskNotFoundError,
} from "../domain/errors.js";
import type { ProjectId } from "../domain/project.js";
import type { Task, TaskId, TaskStatus } from "../domain/task.js";
import { StateStore } from "../infrastructure/state-store.js";
import { ProjectManager } from "./project-manager.js";
import { projectStateDirectory } from "./project-state-path.js";
import {
  DeterministicTaskNamingService,
  normalizeTaskDescription,
  type TaskNamingService,
} from "./task-naming-service.js";

interface StoredTask {
  readonly task: Task;
  readonly relativeDirectory: string;
}

export class TaskManager {
  constructor(
    private readonly stateStore: StateStore,
    private readonly projectManager: ProjectManager,
    private readonly namingService: TaskNamingService =
      new DeterministicTaskNamingService(),
  ) {}

  async create(projectId: ProjectId, description: string): Promise<Task> {
    const normalizedDescription = normalizeTaskDescription(description);
    if (normalizedDescription.length === 0) {
      throw new InvalidTaskDescriptionError();
    }

    const project = await this.projectManager.get(projectId);
    const task: Task = {
      id: `task_${randomUUID().replaceAll("-", "")}`,
      projectId,
      slug: this.namingService.createSlug(normalizedDescription),
      description: normalizedDescription,
      status: "active",
      createdAt: new Date().toISOString(),
      completedAt: null,
      archivedAt: null,
    };
    const projectDirectory = projectStateDirectory(project);
    const taskDirectoryName = taskStateDirectoryName(task);
    const workflowDirectory = `${projectDirectory}/tasks/open/${taskDirectoryName}`;
    const memoryDirectory = `${projectDirectory}/memory/tasks/${taskDirectoryName}`;

    await Promise.all([
      this.stateStore.ensureDirectory(`${workflowDirectory}/plans/archive`),
      this.stateStore.ensureDirectory(
        `${workflowDirectory}/artifacts/questioner`,
      ),
      this.stateStore.ensureDirectory(
        `${workflowDirectory}/artifacts/researcher`,
      ),
      this.stateStore.ensureDirectory(`${workflowDirectory}/artifacts/coder`),
      this.stateStore.ensureDirectory(
        `${workflowDirectory}/artifacts/reviewer`,
      ),
      this.stateStore.ensureDirectory(`${memoryDirectory}/loaded`),
      this.stateStore.writeJson(`${workflowDirectory}/rules.jsonc`, {}),
    ]);

    // Written last so incomplete scaffolds are not discoverable as tasks.
    await this.stateStore.writeJson(`${workflowDirectory}/task.jsonc`, task);
    return task;
  }

  async get(projectId: ProjectId, taskId: TaskId): Promise<Task> {
    const storedTask = (await this.listStoredTasks(projectId)).find(
      ({ task }) => task.id === taskId,
    );
    if (storedTask === undefined) {
      throw new TaskNotFoundError(projectId, taskId);
    }
    return storedTask.task;
  }

  async getStateDirectory(
    projectId: ProjectId,
    taskId: TaskId,
  ): Promise<string> {
    const storedTask = (await this.listStoredTasks(projectId)).find(
      ({ task }) => task.id === taskId,
    );
    if (storedTask === undefined) {
      throw new TaskNotFoundError(projectId, taskId);
    }
    return storedTask.relativeDirectory;
  }

  async getStateDirectoryByTaskId(taskId: TaskId): Promise<string> {
    const projects = await this.projectManager.list();
    for (const project of projects) {
      const storedTask = (await this.listStoredTasks(project.id)).find(
        ({ task }) => task.id === taskId,
      );
      if (storedTask !== undefined) {
        return storedTask.relativeDirectory;
      }
    }
    throw new TaskNotFoundError(null, taskId);
  }

  async resolve(projectId: ProjectId, taskReference: string): Promise<Task> {
    return (await this.resolveStored(projectId, taskReference)).task;
  }

  async listOpen(projectId: ProjectId): Promise<Task[]> {
    return (await this.listStoredTasksIn(projectId, "open")).map(
      ({ task }) => task,
    );
  }

  async listArchived(projectId: ProjectId): Promise<Task[]> {
    return (await this.listStoredTasksIn(projectId, "archive")).map(
      ({ task }) => task,
    );
  }

  async markCompleted(
    projectId: ProjectId,
    taskReference: string,
  ): Promise<Task> {
    const storedTask = await this.resolveStored(projectId, taskReference);
    if (storedTask.task.status !== "active") {
      throw new InvalidTaskTransitionError(
        storedTask.task.id,
        storedTask.task.status,
        "completed",
      );
    }

    const completedTask: Task = {
      ...storedTask.task,
      status: "completed",
      completedAt: new Date().toISOString(),
    };
    await this.stateStore.writeJson(
      `${storedTask.relativeDirectory}/task.jsonc`,
      completedTask,
    );
    return completedTask;
  }

  async archive(projectId: ProjectId, taskReference: string): Promise<Task> {
    const project = await this.projectManager.get(projectId);
    const storedTask = await this.resolveStored(projectId, taskReference);
    if (storedTask.task.status !== "completed") {
      throw new InvalidTaskTransitionError(
        storedTask.task.id,
        storedTask.task.status,
        "archived",
      );
    }

    const archivedTask: Task = {
      ...storedTask.task,
      status: "archived",
      archivedAt: new Date().toISOString(),
    };
    await this.stateStore.writeJson(
      `${storedTask.relativeDirectory}/task.jsonc`,
      archivedTask,
    );

    const destinationDirectory = `${projectStateDirectory(project)}/tasks/archive/${taskStateDirectoryName(archivedTask)}`;
    await this.stateStore.move(
      storedTask.relativeDirectory,
      destinationDirectory,
    );
    return archivedTask;
  }

  private async resolveStored(
    projectId: ProjectId,
    taskReference: string,
  ): Promise<StoredTask> {
    const tasks = await this.listStoredTasks(projectId);
    const taskById = tasks.find(({ task }) => task.id === taskReference);
    if (taskById !== undefined) {
      return taskById;
    }

    const tasksBySlug = tasks.filter(({ task }) => task.slug === taskReference);
    if (tasksBySlug.length === 1) {
      return tasksBySlug[0] as StoredTask;
    }
    if (tasksBySlug.length > 1) {
      throw new AmbiguousTaskReferenceError(
        projectId,
        taskReference,
        tasksBySlug.map(({ task }) => task.id),
      );
    }

    throw new TaskNotFoundError(projectId, taskReference);
  }

  private async listStoredTasks(projectId: ProjectId): Promise<StoredTask[]> {
    const [openTasks, archivedTasks] = await Promise.all([
      this.listStoredTasksIn(projectId, "open"),
      this.listStoredTasksIn(projectId, "archive"),
    ]);
    return [...openTasks, ...archivedTasks];
  }

  private async listStoredTasksIn(
    projectId: ProjectId,
    collection: "open" | "archive",
  ): Promise<StoredTask[]> {
    const project = await this.projectManager.get(projectId);
    const collectionDirectory = `${projectStateDirectory(project)}/tasks/${collection}`;
    const directories = await this.stateStore.listDirectories(
      collectionDirectory,
    );
    const taskStates = await Promise.all(
      directories.map(async (directory): Promise<StoredTask | null> => {
        const relativeDirectory = `${collectionDirectory}/${directory}`;
        const value = await this.stateStore.readJson<unknown>(
          `${relativeDirectory}/task.jsonc`,
        );
        if (value === null) {
          return null;
        }
        if (!isTask(value) || value.projectId !== projectId) {
          throw new SyntaxError(`Invalid task state in ${relativeDirectory}`);
        }
        return { task: value, relativeDirectory };
      }),
    );

    return taskStates
      .filter((task): task is StoredTask => task !== null)
      .sort(
        (left, right) =>
          left.task.createdAt.localeCompare(right.task.createdAt) ||
          left.task.id.localeCompare(right.task.id),
      );
  }
}

function taskStateDirectoryName(task: Task): string {
  return `${task.id}_${task.slug}`;
}

function isTask(value: unknown): value is Task {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Task>;
  if (
    typeof candidate.id !== "string" ||
    !candidate.id.startsWith("task_") ||
    typeof candidate.projectId !== "string" ||
    !candidate.projectId.startsWith("prj_") ||
    typeof candidate.slug !== "string" ||
    typeof candidate.description !== "string" ||
    typeof candidate.createdAt !== "string" ||
    !isNullableString(candidate.completedAt) ||
    !isNullableString(candidate.archivedAt) ||
    !isTaskStatus(candidate.status)
  ) {
    return false;
  }

  if (candidate.status === "active") {
    return candidate.completedAt === null && candidate.archivedAt === null;
  }
  if (candidate.status === "completed") {
    return candidate.completedAt !== null && candidate.archivedAt === null;
  }
  return candidate.completedAt !== null && candidate.archivedAt !== null;
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return value === "active" || value === "completed" || value === "archived";
}
