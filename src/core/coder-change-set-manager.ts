import { createHash, randomBytes } from "node:crypto";
import {
  ChangeSetCorruptError,
  ChangeSetNotFoundError,
} from "../domain/errors.js";
import type { ProjectId } from "../domain/project.js";
import type { TaskId } from "../domain/task.js";
import type { StateStore } from "../infrastructure/state-store.js";
import type { TaskManager } from "./task-manager.js";
import type {
  ChangedFile,
  CoderChangeSetCandidate,
} from "./coder-workspace-stager.js";

/**
 * Opaque identity of one captured CODER change set.
 *
 * Unique per capture, independent of content: two captures of the identical
 * patch get different ids. Not a SessionId, not an ownership token, not
 * provider lineage, and not the base commit hash.
 */
export type ChangeSetId = `changeset_${string}`;

/**
 * Durable metadata for a published change set.
 *
 * Deliberately absent: the staging temp path, any ownership token, provider
 * credentials and raw provider stderr. `sessionId` is recorded for provenance
 * only and is NEVER authority for a future apply -- that will be bound to the
 * current task-session ownership plus the exact change-set id.
 */
export interface ChangeSetMetadata {
  readonly version: 1;
  readonly changeSetId: ChangeSetId;
  readonly projectId: ProjectId;
  readonly taskId: TaskId;
  /** Full canonical object id of the source HEAD the patch applies to. */
  readonly baseCommit: string;
  readonly createdAt: string;
  readonly patchHash: string;
  readonly patchBytes: number;
  readonly changedFiles: readonly ChangedFile[];
}

export interface PublishedChangeSet {
  readonly metadata: ChangeSetMetadata;
  readonly patch: Buffer;
}

/**
 * Authoritative store for immutable, task-scoped CODER change sets.
 *
 * A published change set is REVIEWABLE PROPOSED SOURCE MUTATION: it describes
 * changes made in an isolated staging workspace and does not modify the user's
 * source. There is deliberately no apply, merge, cherry-pick or commit
 * operation in this slice.
 *
 * Publication is immutable: a change-set directory is created exclusively, so
 * an existing id can never be overwritten in place.
 */
export class CoderChangeSetManager {
  constructor(
    private readonly stateStore: StateStore,
    private readonly taskManager: Pick<TaskManager, "getStateDirectoryByTaskId">,
  ) {}

  /**
   * Publishes a captured candidate as an immutable change set.
   *
   * Returns `null` when the candidate has no changes: no durable change-set
   * state is created for an empty capture, and no fake non-empty patch is
   * ever persisted.
   *
   * Ordering: patch bytes first, then metadata. A crash between them leaves
   * metadata absent, and `get` treats a change set without readable metadata
   * as corrupt rather than usable -- so a partially published change set can
   * never be mistaken for authoritative task output.
   */
  async publish(
    candidate: CoderChangeSetCandidate,
  ): Promise<PublishedChangeSet | null> {
    if (candidate.changedFiles.length === 0 || candidate.patch.byteLength === 0) {
      return null;
    }
    const changesDirectory = await this.changesDirectory(candidate.taskId);
    const changeSetId = generateChangeSetId();
    const directory = `${changesDirectory}/${changeSetId}`;

    const metadata: ChangeSetMetadata = {
      version: 1,
      changeSetId,
      projectId: candidate.projectId,
      taskId: candidate.taskId,
      baseCommit: candidate.baseCommit,
      createdAt: new Date().toISOString(),
      patchHash: hashPatch(candidate.patch),
      patchBytes: candidate.patch.byteLength,
      // Derived from Git state by the stager, never from provider-reported text.
      changedFiles: candidate.changedFiles.map((file) => ({ ...file })),
    };

    await this.stateStore.ensureDirectory(directory);
    // Exclusive create: an existing change set can never be overwritten.
    const patchCreated = await this.stateStore.createTextExclusive(
      `${directory}/changes.patch`,
      candidate.patch.toString("binary"),
    );
    if (!patchCreated) {
      throw new ChangeSetCorruptError(changeSetId, "patch already exists");
    }
    const metadataCreated = await this.stateStore.createJsonExclusive(
      `${directory}/metadata.json`,
      metadata,
    );
    if (!metadataCreated) {
      throw new ChangeSetCorruptError(changeSetId, "metadata already exists");
    }
    return { metadata, patch: candidate.patch };
  }

  /**
   * Reads a published change set, validating that the patch bytes still hash
   * to the recorded value. A tampered or truncated patch is reported corrupt
   * rather than returned.
   */
  async get(
    taskId: TaskId,
    changeSetId: string,
  ): Promise<PublishedChangeSet> {
    const changesDirectory = await this.changesDirectory(taskId);
    const directory = `${changesDirectory}/${changeSetId}`;
    const rawMetadata = await this.stateStore.readJson<unknown>(
      `${directory}/metadata.json`,
    );
    if (rawMetadata === null) {
      throw new ChangeSetNotFoundError(taskId, changeSetId);
    }
    if (!isChangeSetMetadata(rawMetadata)) {
      throw new ChangeSetCorruptError(changeSetId, "metadata is malformed");
    }
    if (rawMetadata.changeSetId !== changeSetId || rawMetadata.taskId !== taskId) {
      throw new ChangeSetCorruptError(changeSetId, "metadata identity mismatch");
    }
    const patchText = await this.stateStore.readText(
      `${directory}/changes.patch`,
    );
    if (patchText === null) {
      throw new ChangeSetCorruptError(changeSetId, "patch is missing");
    }
    const patch = Buffer.from(patchText, "binary");
    if (hashPatch(patch) !== rawMetadata.patchHash) {
      throw new ChangeSetCorruptError(changeSetId, "patch hash mismatch");
    }
    if (patch.byteLength !== rawMetadata.patchBytes) {
      throw new ChangeSetCorruptError(changeSetId, "patch size mismatch");
    }
    return { metadata: rawMetadata, patch };
  }

  /** Lists published change-set ids for a task, newest first. */
  async list(taskId: TaskId): Promise<readonly ChangeSetId[]> {
    const changesDirectory = await this.changesDirectory(taskId);
    if (!(await this.stateStore.exists(changesDirectory))) {
      return [];
    }
    const directories = await this.stateStore.listDirectories(changesDirectory);
    return directories
      .filter((name): name is ChangeSetId => name.startsWith("changeset_"))
      .sort()
      .reverse();
  }

  private async changesDirectory(taskId: TaskId): Promise<string> {
    return `${await this.taskManager.getStateDirectoryByTaskId(taskId)}/changes`;
  }
}

function generateChangeSetId(): ChangeSetId {
  // Time-ordered prefix keeps listings stable; the random suffix makes two
  // captures of identical content distinct.
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  return `changeset_${stamp}_${randomBytes(8).toString("hex")}`;
}

function hashPatch(patch: Buffer): string {
  return createHash("sha256").update(patch).digest("hex");
}

function isChangeSetMetadata(value: unknown): value is ChangeSetMetadata {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ChangeSetMetadata>;
  return (
    candidate.version === 1 &&
    typeof candidate.changeSetId === "string" &&
    typeof candidate.projectId === "string" &&
    typeof candidate.taskId === "string" &&
    typeof candidate.baseCommit === "string" &&
    /^[0-9a-f]{40,64}$/.test(candidate.baseCommit) &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.patchHash === "string" &&
    typeof candidate.patchBytes === "number" &&
    Array.isArray(candidate.changedFiles)
  );
}
