import { randomUUID } from "node:crypto";
import {
  ArtifactNotFoundError,
  InvalidArtifactError,
  InvalidArtifactPayloadError,
  InvalidArtifactScopeError,
  TaskArchivedError,
  TaskCompletedError,
} from "../domain/errors.js";
import type {
  CoderChangeSetReference,
  ArtifactId,
  ArtifactPayload,
  ArtifactRecord,
  CoderArtifactRecord,
  ArtifactScope,
  QuestionerContext,
  QuestionerContextRead,
  ResearchArtifactRecord,
  ReviewerArtifactRecord,
  ReviewerLifecycleMetadata,
  RunArtifactCategory,
  TaskArtifactScope,
} from "../domain/artifact.js";
import { isArtifactId } from "../domain/artifact.js";
import {
  REVIEWER_FAILURE_ORIGINS,
  REVIEWER_STATUSES,
} from "../domain/agent-result.js";
import type { Task } from "../domain/task.js";
import { StateStore } from "../infrastructure/state-store.js";
import { ProjectManager } from "./project-manager.js";
import { projectStateDirectory } from "./project-state-path.js";
import { TaskManager } from "./task-manager.js";

type StoredStandardArtifact =
  | (ResearchArtifactRecord & { readonly version: 1 })
  | (CoderArtifactRecord & { readonly version: 1 });

type StoredReviewerArtifact = ReviewerArtifactRecord & {
  readonly version: 2;
};

type StoredArtifact = StoredStandardArtifact | StoredReviewerArtifact;

interface StoredQuestionerContext extends QuestionerContext {
  readonly version: 1;
}

export class ArtifactManager {
  constructor(
    private readonly stateStore: StateStore,
    private readonly projectManager: ProjectManager,
    private readonly taskManager: TaskManager,
  ) {}

  async getQuestionerContext(
    scope: TaskArtifactScope,
  ): Promise<QuestionerContextRead> {
    this.assertQuestionerScope(scope);
    await this.taskManager.get(scope.projectId, scope.taskId);
    const value = await this.readPersistedJson(
      `${await this.artifactDirectory("questioner", scope)}/context.json`,
    );
    if (value === null) {
      return { scope, hasContext: false, context: null };
    }
    if (!isStoredQuestionerContext(value) || !sameScope(value.scope, scope)) {
      throw new InvalidArtifactError(
        "Questioner context metadata does not match its task scope",
      );
    }
    return {
      scope,
      hasContext: true,
      context: withoutContextVersion(value),
    };
  }

  async saveQuestionerContext(
    scope: TaskArtifactScope,
    payload: ArtifactPayload,
  ): Promise<QuestionerContext> {
    this.assertQuestionerScope(scope);
    await this.assertTaskWritable(scope, false);
    const storedPayload = snapshotPayload(payload);
    const context: StoredQuestionerContext = {
      version: 1,
      category: "questioner",
      scope,
      updatedAt: new Date().toISOString(),
      payload: storedPayload,
    };
    await this.stateStore.writeJson(
      `${await this.artifactDirectory("questioner", scope)}/context.json`,
      context,
    );
    return withoutContextVersion(context);
  }

  async clearQuestionerContext(scope: TaskArtifactScope): Promise<boolean> {
    this.assertQuestionerScope(scope);
    await this.assertTaskWritable(scope, true);
    const path = `${await this.artifactDirectory("questioner", scope)}/context.json`;
    const existed = await this.stateStore.exists(path);
    await this.stateStore.removeFile(path);
    return existed;
  }

  async saveResearchArtifact(
    scope: ArtifactScope,
    payload: ArtifactPayload,
  ): Promise<ResearchArtifactRecord> {
    return (await this.saveRunArtifact(
      "researcher",
      scope,
      payload,
    )) as ResearchArtifactRecord;
  }

  async listResearchArtifacts(
    scope: ArtifactScope,
  ): Promise<ResearchArtifactRecord[]> {
    return (await this.listRunArtifacts(
      "researcher",
      scope,
    )) as ResearchArtifactRecord[];
  }

  async getResearchArtifact(
    scope: ArtifactScope,
    artifactId: ArtifactId,
  ): Promise<ResearchArtifactRecord> {
    return (await this.getRunArtifact(
      "researcher",
      scope,
      artifactId,
    )) as ResearchArtifactRecord;
  }

  async deleteResearchArtifact(
    scope: ArtifactScope,
    artifactId: ArtifactId,
  ): Promise<void> {
    await this.validateRunScope("researcher", scope, true);
    await this.getRunArtifact("researcher", scope, artifactId);
    await this.stateStore.removeFile(
      `${await this.artifactDirectory("researcher", scope)}/${artifactId}.json`,
    );
  }

  /**
   * Persists a CODER work record.
   *
   * `changeSet` is SYSTEM-GENERATED: Synaphex derives it from staging Git
   * state, so provider output cannot forge it. Omit it entirely to write a
   * legacy-shaped record; pass `null` for a staged invocation that changed
   * nothing.
   */
  async saveCoderWorkRecord(
    scope: TaskArtifactScope,
    payload: ArtifactPayload,
    changeSet?: CoderChangeSetReference | null,
  ): Promise<CoderArtifactRecord> {
    return (await this.saveRunArtifact(
      "coder",
      scope,
      payload,
      changeSet,
    )) as CoderArtifactRecord;
  }

  async listCoderWorkRecords(
    scope: TaskArtifactScope,
  ): Promise<CoderArtifactRecord[]> {
    return (await this.listRunArtifacts(
      "coder",
      scope,
    )) as CoderArtifactRecord[];
  }

  async getCoderWorkRecord(
    scope: TaskArtifactScope,
    artifactId: ArtifactId,
  ): Promise<CoderArtifactRecord> {
    return (await this.getRunArtifact(
      "coder",
      scope,
      artifactId,
    )) as CoderArtifactRecord;
  }

  async saveReviewerReport(
    scope: TaskArtifactScope,
    review: ReviewerLifecycleMetadata,
    payload: ArtifactPayload,
  ): Promise<ReviewerArtifactRecord> {
    await this.validateRunScope("reviewer", scope, true);
    const storedPayload = snapshotPayload(payload);
    const storedReview = snapshotReviewerLifecycle(review);
    const directory = await this.artifactDirectory("reviewer", scope);

    for (;;) {
      const artifact: StoredReviewerArtifact = {
        version: 2,
        id: createArtifactId(),
        category: "reviewer",
        scope,
        createdAt: new Date().toISOString(),
        review: storedReview,
        payload: storedPayload,
      };
      const created = await this.stateStore.createJsonAtomicExclusive(
        `${directory}/${artifact.id}.json`,
        artifact,
      );
      if (created) {
        return withoutArtifactVersion(artifact) as ReviewerArtifactRecord;
      }
    }
  }

  async listReviewerReports(
    scope: TaskArtifactScope,
  ): Promise<ReviewerArtifactRecord[]> {
    return (await this.listRunArtifacts(
      "reviewer",
      scope,
    )) as ReviewerArtifactRecord[];
  }

  async getReviewerReport(
    scope: TaskArtifactScope,
    artifactId: ArtifactId,
  ): Promise<ReviewerArtifactRecord> {
    return (await this.getRunArtifact(
      "reviewer",
      scope,
      artifactId,
    )) as ReviewerArtifactRecord;
  }

  async findRunArtifactById(artifactId: ArtifactId): Promise<ArtifactRecord> {
    if (!isArtifactId(artifactId)) {
      throw new ArtifactNotFoundError(artifactId);
    }
    for (const project of await this.projectManager.list()) {
      const projectScope: ArtifactScope = {
        kind: "project",
        projectId: project.id,
      };
      const projectArtifact = await this.findRunArtifactAt(
        "researcher",
        projectScope,
        artifactId,
      );
      if (projectArtifact !== null) {
        return projectArtifact;
      }

      const [openTasks, archivedTasks] = await Promise.all([
        this.taskManager.listOpen(project.id),
        this.taskManager.listArchived(project.id),
      ]);
      for (const task of [...openTasks, ...archivedTasks]) {
        const taskScope: ArtifactScope = {
          kind: "task",
          projectId: project.id,
          taskId: task.id,
        };
        for (const category of [
          "researcher",
          "coder",
          "reviewer",
        ] as const) {
          const artifact = await this.findRunArtifactAt(
            category,
            taskScope,
            artifactId,
          );
          if (artifact !== null) {
            return artifact;
          }
        }
      }
    }
    throw new ArtifactNotFoundError(artifactId);
  }

  async saveRunArtifact(
    category: RunArtifactCategory,
    scope: ArtifactScope,
    payload: ArtifactPayload,
    changeSet?: CoderChangeSetReference | null,
  ): Promise<ArtifactRecord> {
    if (category === "reviewer") {
      throw new InvalidArtifactError(
        "Reviewer artifacts require lifecycle metadata",
      );
    }
    await this.validateRunScope(category, scope, true);
    const storedPayload = snapshotPayload(payload);
    const directory = await this.artifactDirectory(category, scope);

    for (;;) {
      const artifact = {
        version: 1,
        id: createArtifactId(),
        category,
        scope,
        createdAt: new Date().toISOString(),
        payload: storedPayload,
        // Only written when supplied, so legacy records keep their exact shape.
        ...(changeSet === undefined ? {} : { changeSet }),
      } as StoredStandardArtifact;
      const created = await this.stateStore.createJsonAtomicExclusive(
        `${directory}/${artifact.id}.json`,
        artifact,
      );
      if (created) {
        return withoutArtifactVersion(artifact);
      }
    }
  }

  async listRunArtifacts(
    category: RunArtifactCategory,
    scope: ArtifactScope,
  ): Promise<ArtifactRecord[]> {
    await this.validateRunScope(category, scope, false);
    const directory = await this.artifactDirectory(category, scope);
    const files = (await this.stateStore.listFiles(directory)).filter((file) =>
      file.endsWith(".json"),
    );
    const artifacts: ArtifactRecord[] = [];
    for (const file of files) {
      const value = await this.readPersistedJson(`${directory}/${file}`);
      if (value === null) {
        continue;
      }
      const artifact = this.validateStoredArtifact(
        value,
        category,
        scope,
        file,
      );
      artifacts.push(withoutArtifactVersion(artifact));
    }
    return artifacts.sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
  }

  async getRunArtifact(
    category: RunArtifactCategory,
    scope: ArtifactScope,
    artifactId: ArtifactId,
  ): Promise<ArtifactRecord> {
    await this.validateRunScope(category, scope, false);
    if (!isArtifactId(artifactId)) {
      throw new ArtifactNotFoundError(artifactId);
    }
    const file = `${artifactId}.json`;
    const value = await this.readPersistedJson(
      `${await this.artifactDirectory(category, scope)}/${file}`,
    );
    if (value === null) {
      throw new ArtifactNotFoundError(artifactId);
    }
    return withoutArtifactVersion(
      this.validateStoredArtifact(value, category, scope, file),
    );
  }

  private assertQuestionerScope(
    scope: ArtifactScope,
  ): asserts scope is TaskArtifactScope {
    if (scope.kind !== "task") {
      throw new InvalidArtifactScopeError("questioner", scope);
    }
  }

  private async validateRunScope(
    category: RunArtifactCategory,
    scope: ArtifactScope,
    forMutation: boolean,
  ): Promise<void> {
    if (!isRunArtifactCategory(category)) {
      throw new InvalidArtifactScopeError(category, scope);
    }
    if (scope.kind === "project") {
      if (category !== "researcher") {
        throw new InvalidArtifactScopeError(category, scope);
      }
      await this.projectManager.get(scope.projectId);
      return;
    }

    if (forMutation) {
      await this.assertTaskWritable(scope, category === "researcher");
    } else {
      await this.taskManager.get(scope.projectId, scope.taskId);
    }
  }

  private async assertTaskWritable(
    scope: TaskArtifactScope,
    allowCompleted: boolean,
  ): Promise<Task> {
    const task = await this.taskManager.get(scope.projectId, scope.taskId);
    if (task.status === "archived") {
      throw new TaskArchivedError(task.id);
    }
    if (task.status === "completed" && !allowCompleted) {
      throw new TaskCompletedError(task.id);
    }
    return task;
  }

  private async artifactDirectory(
    category: "questioner" | RunArtifactCategory,
    scope: ArtifactScope,
  ): Promise<string> {
    if (scope.kind === "project") {
      const project = await this.projectManager.get(scope.projectId);
      return `${projectStateDirectory(project)}/artifacts/${category}`;
    }
    return `${await this.taskManager.getStateDirectory(scope.projectId, scope.taskId)}/artifacts/${category}`;
  }

  private async readPersistedJson(relativePath: string): Promise<unknown> {
    try {
      return await this.stateStore.readJson<unknown>(relativePath);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new InvalidArtifactError("committed JSON is malformed");
      }
      throw error;
    }
  }

  private async findRunArtifactAt(
    category: RunArtifactCategory,
    scope: ArtifactScope,
    artifactId: ArtifactId,
  ): Promise<ArtifactRecord | null> {
    const path = `${await this.artifactDirectory(category, scope)}/${artifactId}.json`;
    if (!(await this.stateStore.exists(path))) {
      return null;
    }
    return this.getRunArtifact(category, scope, artifactId);
  }

  private validateStoredArtifact(
    value: unknown,
    category: RunArtifactCategory,
    scope: ArtifactScope,
    file: string,
  ): StoredArtifact {
    if (!isStoredArtifact(value)) {
      throw new InvalidArtifactError("record metadata has an invalid shape");
    }
    if (value.category !== category) {
      throw new InvalidArtifactError(
        "record category does not match its artifact directory",
      );
    }
    if (!sameScope(value.scope, scope)) {
      throw new InvalidArtifactError(
        "record scope does not match its artifact directory",
      );
    }
    if (file !== `${value.id}.json`) {
      throw new InvalidArtifactError(
        "record filename does not match its artifact identity",
      );
    }
    return value;
  }
}

function createArtifactId(): ArtifactId {
  return `artifact_${randomUUID().replaceAll("-", "")}`;
}

function isRunArtifactCategory(value: unknown): value is RunArtifactCategory {
  return value === "researcher" || value === "coder" || value === "reviewer";
}

function isStoredArtifact(value: unknown): value is StoredArtifact {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<
    ArtifactRecord & {
      readonly version: unknown;
      readonly review: unknown;
    }
  >;
  if (
    !isArtifactId(candidate.id) ||
    !isRunArtifactCategory(candidate.category) ||
    !isArtifactScope(candidate.scope) ||
    !isTimestamp(candidate.createdAt) ||
    validatePayload(candidate.payload) !== null
  ) {
    return false;
  }
  if (candidate.category === "reviewer") {
    return (
      candidate.version === 2 &&
      isTaskArtifactScope(candidate.scope) &&
      isReviewerLifecycleMetadata(candidate.review)
    );
  }
  return (
    candidate.version === 1 &&
    (candidate.category === "researcher" ||
      isTaskArtifactScope(candidate.scope))
  );
}

function snapshotReviewerLifecycle(
  review: ReviewerLifecycleMetadata,
): ReviewerLifecycleMetadata {
  if (!isReviewerLifecycleMetadata(review)) {
    throw new InvalidArtifactError(
      "Reviewer lifecycle metadata has an invalid shape",
    );
  }
  return {
    status: review.status,
    warnings: [...review.warnings],
    ...(review.failureOrigin === undefined
      ? {}
      : { failureOrigin: review.failureOrigin }),
  };
}

function isReviewerLifecycleMetadata(
  value: unknown,
): value is ReviewerLifecycleMetadata {
  if (!isPlainRecord(value)) {
    return false;
  }
  const allowedKeys = new Set(["status", "warnings", "failureOrigin"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return false;
  }
  if (
    typeof value.status !== "string" ||
    !(REVIEWER_STATUSES as readonly string[]).includes(value.status) ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every(
      (warning) =>
        typeof warning === "string" && warning.trim().length > 0,
    )
  ) {
    return false;
  }
  if (value.status === "FAIL") {
    return (
      typeof value.failureOrigin === "string" &&
      (REVIEWER_FAILURE_ORIGINS as readonly string[]).includes(
        value.failureOrigin,
      )
    );
  }
  if (Object.hasOwn(value, "failureOrigin")) {
    return false;
  }
  return value.status !== "PASS_WITH_WARNINGS" || value.warnings.length > 0;
}

function isStoredQuestionerContext(
  value: unknown,
): value is StoredQuestionerContext {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<StoredQuestionerContext>;
  return (
    candidate.version === 1 &&
    candidate.category === "questioner" &&
    isTaskArtifactScope(candidate.scope) &&
    isTimestamp(candidate.updatedAt) &&
    validatePayload(candidate.payload) === null
  );
}

function isArtifactScope(value: unknown): value is ArtifactScope {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ArtifactScope>;
  return (
    (candidate.kind === "project" && isProjectId(candidate.projectId)) ||
    (candidate.kind === "task" &&
      isProjectId(candidate.projectId) &&
      isTaskId(candidate.taskId))
  );
}

function isTaskArtifactScope(value: unknown): value is TaskArtifactScope {
  return isArtifactScope(value) && value.kind === "task";
}

function isProjectId(value: unknown): boolean {
  return typeof value === "string" && /^prj_[a-zA-Z0-9_-]+$/.test(value);
}

function isTaskId(value: unknown): boolean {
  return typeof value === "string" && /^task_[a-zA-Z0-9_-]+$/.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function sameScope(left: ArtifactScope, right: ArtifactScope): boolean {
  return (
    left.kind === right.kind &&
    left.projectId === right.projectId &&
    (left.kind === "project" ||
      (right.kind === "task" && left.taskId === right.taskId))
  );
}

function assertValidPayload(payload: unknown): asserts payload is ArtifactPayload {
  const reason = validatePayload(payload);
  if (reason !== null) {
    throw new InvalidArtifactPayloadError(reason);
  }
}

function snapshotPayload(payload: unknown): ArtifactPayload {
  assertValidPayload(payload);
  try {
    return JSON.parse(JSON.stringify(payload)) as ArtifactPayload;
  } catch {
    throw new InvalidArtifactPayloadError(
      "the value could not be serialized safely",
    );
  }
}

function validatePayload(payload: unknown): string | null {
  if (!isPlainRecord(payload)) {
    return "the root value must be a plain object";
  }
  try {
    return validateJsonValue(payload, new WeakSet<object>(), "payload");
  } catch {
    return "the value could not be inspected safely";
  }
}

function validateJsonValue(
  value: unknown,
  ancestors: WeakSet<object>,
  path: string,
): string | null {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? null : `${path} contains a non-finite number`;
  }
  if (typeof value !== "object") {
    return `${path} contains a non-JSON value`;
  }
  if (ancestors.has(value)) {
    return `${path} contains a cycle`;
  }
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    return `${path} contains a non-plain object`;
  }

  ancestors.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length > 0) {
    ancestors.delete(value);
    return `${path} contains symbol-keyed data`;
  }
  if (Array.isArray(value)) {
    const keys = Object.keys(descriptors).filter((key) => key !== "length");
    if (keys.length !== value.length) {
      ancestors.delete(value);
      return `${path} contains a sparse or extended array`;
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor)) {
        ancestors.delete(value);
        return `${path}[${index}] is not a plain data value`;
      }
      const reason = validateJsonValue(
        descriptor.value,
        ancestors,
        `${path}[${index}]`,
      );
      if (reason !== null) {
        ancestors.delete(value);
        return reason;
      }
    }
  } else {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable || !("value" in descriptor)) {
        ancestors.delete(value);
        return `${path}.${key} is not an enumerable data value`;
      }
      const reason = validateJsonValue(
        descriptor.value,
        ancestors,
        `${path}.${key}`,
      );
      if (reason !== null) {
        ancestors.delete(value);
        return reason;
      }
    }
  }
  ancestors.delete(value);
  return null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function withoutArtifactVersion(artifact: StoredArtifact): ArtifactRecord {
  if (artifact.category === "reviewer") {
    return {
      id: artifact.id,
      category: artifact.category,
      scope: artifact.scope,
      createdAt: artifact.createdAt,
      review: artifact.review,
      payload: artifact.payload,
    };
  }
  return artifact.category === "researcher"
    ? {
        id: artifact.id,
        category: artifact.category,
        scope: artifact.scope,
        createdAt: artifact.createdAt,
        payload: artifact.payload,
      }
    : {
        id: artifact.id,
        category: artifact.category,
        scope: artifact.scope,
        createdAt: artifact.createdAt,
        payload: artifact.payload,
        // Preserved only when present, so a legacy CODER record (written
        // before staging existed) keeps its exact shape and is never
        // reinterpreted as a staged change set.
        ...("changeSet" in artifact ? { changeSet: artifact.changeSet } : {}),
      };
}

function withoutContextVersion(
  context: StoredQuestionerContext,
): QuestionerContext {
  return {
    category: context.category,
    scope: context.scope,
    updatedAt: context.updatedAt,
    payload: context.payload,
  };
}
