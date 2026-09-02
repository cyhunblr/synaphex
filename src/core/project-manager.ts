import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve as resolvePath } from "node:path";
import {
  AmbiguousProjectReferenceError,
  InvalidProjectPathError,
  ProjectNotFoundError,
  ProjectPathAlreadyRegisteredError,
  ProjectPathNotFoundError,
} from "../domain/errors.js";
import type { Project, ProjectId } from "../domain/project.js";
import { StateStore } from "../infrastructure/state-store.js";
import { projectStateDirectory } from "./project-state-path.js";
import { ensureGlobalRuleState } from "./rule-store.js";

export interface ProjectManagerOptions {
  readonly homeDirectory?: string;
}

export class ProjectManager {
  private readonly homeDirectory: string;

  constructor(
    private readonly stateStore: StateStore,
    options: ProjectManagerOptions = {},
  ) {
    this.homeDirectory = options.homeDirectory ?? homedir();
  }

  async create(name: string, sourcePath: string): Promise<Project> {
    const canonicalSourcePath = await this.canonicalizeSourceDirectory(sourcePath);
    const existingProject = (await this.list()).find(
      (project) => project.sourcePath === canonicalSourcePath,
    );

    if (existingProject !== undefined) {
      throw new ProjectPathAlreadyRegisteredError(
        canonicalSourcePath,
        existingProject.id,
      );
    }

    const project: Project = {
      id: `prj_${randomUUID().replaceAll("-", "")}`,
      name,
      sourcePath: canonicalSourcePath,
      createdAt: new Date().toISOString(),
    };
    const projectDirectory = projectStateDirectory(project);

    await ensureGlobalRuleState(this.stateStore);

    await Promise.all([
      this.stateStore.ensureDirectory(
        `${projectDirectory}/artifacts/researcher`,
      ),
      this.stateStore.ensureDirectory(`${projectDirectory}/memory/loaded`),
      this.stateStore.ensureDirectory(`${projectDirectory}/memory/tasks`),
      this.stateStore.ensureDirectory(`${projectDirectory}/tasks/open`),
      this.stateStore.ensureDirectory(`${projectDirectory}/tasks/archive`),
      this.stateStore.writeJson(`${projectDirectory}/rules.jsonc`, {}),
    ]);

    // Written last so incomplete scaffolds never become registered projects.
    await this.stateStore.writeJson(`${projectDirectory}/project.jsonc`, project);

    return project;
  }

  async get(projectId: ProjectId): Promise<Project> {
    const project = (await this.list()).find(({ id }) => id === projectId);
    if (project === undefined) {
      throw new ProjectNotFoundError(projectId);
    }
    return project;
  }

  async resolve(projectReference: string): Promise<Project> {
    const projects = await this.list();
    const projectById = projects.find(({ id }) => id === projectReference);
    if (projectById !== undefined) {
      return projectById;
    }

    const projectsByName = projects.filter(({ name }) => name === projectReference);
    if (projectsByName.length === 1) {
      return projectsByName[0] as Project;
    }
    if (projectsByName.length > 1) {
      throw new AmbiguousProjectReferenceError(
        projectReference,
        projectsByName.map(({ id }) => id),
      );
    }

    const projectBySourcePath = await this.tryFindBySourcePath(
      projectReference,
      projects,
    );
    if (projectBySourcePath !== null) {
      return projectBySourcePath;
    }

    throw new ProjectNotFoundError(projectReference);
  }

  async findBySourcePath(sourcePath: string): Promise<Project | null> {
    const canonicalSourcePath = await this.canonicalizeSourceDirectory(sourcePath);
    return (
      (await this.list()).find(
        (project) => project.sourcePath === canonicalSourcePath,
      ) ?? null
    );
  }

  async list(): Promise<Project[]> {
    const directories = await this.stateStore.listDirectories("projects");
    const projects = await Promise.all(
      directories.map((directory) =>
        this.stateStore.readJson<unknown>(`projects/${directory}/project.jsonc`),
      ),
    );

    return projects
      .filter((project): project is Project => isProject(project))
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
  }

  private async tryFindBySourcePath(
    sourcePath: string,
    projects: readonly Project[],
  ): Promise<Project | null> {
    let canonicalSourcePath: string;
    try {
      canonicalSourcePath = await this.canonicalizeSourceDirectory(sourcePath);
    } catch (error) {
      if (
        error instanceof ProjectPathNotFoundError ||
        error instanceof InvalidProjectPathError
      ) {
        return null;
      }
      throw error;
    }

    return (
      projects.find((project) => project.sourcePath === canonicalSourcePath) ?? null
    );
  }

  private async canonicalizeSourceDirectory(sourcePath: string): Promise<string> {
    const expandedPath = this.expandHomeDirectory(sourcePath);
    const absolutePath = resolvePath(expandedPath);

    let canonicalPath: string;
    try {
      canonicalPath = await realpath(absolutePath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new ProjectPathNotFoundError(sourcePath, { cause: error });
      }
      throw new InvalidProjectPathError(sourcePath, "path cannot be resolved", {
        cause: error,
      });
    }

    try {
      const pathStats = await stat(canonicalPath);
      if (!pathStats.isDirectory()) {
        throw new InvalidProjectPathError(sourcePath, "path is not a directory");
      }
    } catch (error) {
      if (error instanceof InvalidProjectPathError) {
        throw error;
      }
      throw new InvalidProjectPathError(sourcePath, "path cannot be inspected", {
        cause: error,
      });
    }

    return canonicalPath;
  }

  private expandHomeDirectory(sourcePath: string): string {
    if (sourcePath === "~") {
      return this.homeDirectory;
    }
    if (sourcePath.startsWith("~/")) {
      return resolvePath(this.homeDirectory, sourcePath.slice(2));
    }
    return sourcePath;
  }
}

function isProject(value: unknown): value is Project {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Project>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.startsWith("prj_") &&
    typeof candidate.name === "string" &&
    typeof candidate.sourcePath === "string" &&
    typeof candidate.createdAt === "string"
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
