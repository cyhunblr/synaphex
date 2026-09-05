import {
  LockAcquisitionTimeout,
  RecoverableProcessLock,
} from "../infrastructure/recoverable-process-lock.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  InvalidPlanContentError,
  NoPlanDraftError,
  PlanAlreadyAcceptedError,
  PlanDraftRevisionMismatchError,
  PlanMutationLockTimeoutError,
} from "../domain/errors.js";
import type {
  AcceptedPlan,
  ArchivedPlan,
  DraftPlan,
  PlanAvailability,
  PlanDraftRevisionId,
} from "../domain/plan.js";
import type { TaskId } from "../domain/task.js";
import { StateStore } from "../infrastructure/state-store.js";
import { TaskManager } from "./task-manager.js";

/**
 * Persisted draft revision metadata, stored beside the human-readable
 * `draft.md` rather than replacing it.
 *
 * `contentHash` exists to detect mismatched/stale metadata after a crash: if
 * the recorded hash does not match the actual draft bytes, the metadata is not
 * trusted and a fresh revision is minted. `revisionId` is NOT derived from the
 * content -- it is the ABA fence.
 */
interface DraftRevisionMetadata {
  readonly version: 1;
  readonly revisionId: PlanDraftRevisionId;
  readonly contentHash: string;
  readonly createdAt: string;
}

const PLAN_MUTATION_LOCK_PATH = "state/plans/.mutation-lock.json";
// Crash/stale-lock recovery is handled by RecoverableProcessLock (ADR 0004):
// a dead owner's mutex is reclaimed, while domain state is never rolled back.

export class PlanManager {
  private readonly lock: RecoverableProcessLock;

  constructor(
    private readonly stateStore: StateStore,
    private readonly taskManager: TaskManager,
    lock?: RecoverableProcessLock,
  ) {
    this.lock = lock ?? new RecoverableProcessLock(stateStore);
  }

  /**
   * Reads the draft WITHOUT hydrating revision metadata.
   *
   * A legacy or crash-mismatched draft therefore reports a placeholder
   * revision that can never match a decision; use
   * {@link getDraftWithRevision} to obtain a decidable revision.
   */
  async getDraft(taskId: TaskId): Promise<DraftPlan | null> {
    const plansDirectory = await this.plansDirectory(taskId);
    const content = await this.stateStore.readText(
      `${plansDirectory}/draft.md`,
    );
    if (content === null) {
      return null;
    }
    const metadata = await this.readUsableMetadata(plansDirectory, content);
    return {
      taskId,
      status: "draft",
      content,
      revisionId: metadata?.revisionId ?? UNHYDRATED_REVISION_ID,
    };
  }

  /**
   * Reads the draft and guarantees a usable revision id, hydrating legacy or
   * crash-mismatched metadata in place under the plan mutation lock.
   *
   * Hydration is an internal consistency migration: it assigns identity to an
   * existing draft and never changes the plan content a user reviews.
   */
  async getDraftWithRevision(taskId: TaskId): Promise<DraftPlan | null> {
    const plansDirectory = await this.plansDirectory(taskId);
    const preview = await this.stateStore.readText(
      `${plansDirectory}/draft.md`,
    );
    if (preview === null) {
      return null;
    }
    return this.withPlanMutationLock(async () => {
      const content = await this.stateStore.readText(
        `${plansDirectory}/draft.md`,
      );
      if (content === null) {
        return null;
      }
      const existing = await this.readUsableMetadata(plansDirectory, content);
      if (existing !== null) {
        return {
          taskId,
          status: "draft" as const,
          content,
          revisionId: existing.revisionId,
        };
      }
      // Legacy draft, or metadata whose hash no longer matches the bytes:
      // mint a fresh revision rather than synthesizing one from content.
      const metadata = await this.writeMetadata(plansDirectory, content);
      return {
        taskId,
        status: "draft" as const,
        content,
        revisionId: metadata.revisionId,
      };
    });
  }

  /**
   * Persists a new draft instance.
   *
   * Every successful write mints a NEW `revisionId`, even when the content is
   * byte-identical to the previous draft: a Planner invocation proposes a new
   * draft instance, so a stale decision must never apply to it.
   */
  async saveDraft(taskId: TaskId, content: string): Promise<DraftPlan> {
    if (content.trim().length === 0) {
      throw new InvalidPlanContentError();
    }
    const plansDirectory = await this.plansDirectory(taskId);
    return this.withPlanMutationLock(async () => {
      // Content first, then metadata: a crash between them leaves metadata
      // whose hash cannot match, which `readUsableMetadata` rejects, so the
      // draft is re-hydrated with a fresh revision instead of inheriting an
      // old identity.
      await this.stateStore.writeText(`${plansDirectory}/draft.md`, content);
      const metadata = await this.writeMetadata(plansDirectory, content);
      return {
        taskId,
        status: "draft" as const,
        content,
        revisionId: metadata.revisionId,
      };
    });
  }

  async getCurrent(taskId: TaskId): Promise<AcceptedPlan | null> {
    const plansDirectory = await this.plansDirectory(taskId);
    const content = await this.stateStore.readText(
      `${plansDirectory}/current.md`,
    );
    return content === null
      ? null
      : { taskId, status: "accepted", content };
  }

  async hasDraft(taskId: TaskId): Promise<boolean> {
    return (await this.getDraft(taskId)) !== null;
  }

  async hasAcceptedPlan(taskId: TaskId): Promise<boolean> {
    return (await this.getCurrent(taskId)) !== null;
  }

  async getAvailability(taskId: TaskId): Promise<PlanAvailability> {
    const [hasDraft, hasAcceptedPlan] = await Promise.all([
      this.hasDraft(taskId),
      this.hasAcceptedPlan(taskId),
    ]);
    return { hasDraft, hasAcceptedPlan };
  }

  /**
   * Accepts the current draft, optionally requiring an exact revision.
   *
   * When `expectedRevisionId` is supplied, the persisted draft instance must
   * match it exactly or nothing is mutated -- this is the stale-review/ABA
   * fence. Runs entirely under the plan mutation lock, so a concurrent Planner
   * write, accept or reject cannot interleave.
   */
  async acceptDraft(
    taskId: TaskId,
    expectedRevisionId?: PlanDraftRevisionId,
  ): Promise<AcceptedPlan> {
    const plansDirectory = await this.plansDirectory(taskId);
    return this.withPlanMutationLock(async () => {
      const [draftContent, currentContent] = await Promise.all([
        this.stateStore.readText(`${plansDirectory}/draft.md`),
        this.stateStore.readText(`${plansDirectory}/current.md`),
      ]);

      if (draftContent === null) {
        if (expectedRevisionId !== undefined) {
          // The reviewed draft is gone; do not fall back to "already accepted".
          throw new PlanDraftRevisionMismatchError(taskId, expectedRevisionId);
        }
        if (currentContent !== null) {
          throw new PlanAlreadyAcceptedError(taskId);
        }
        throw new NoPlanDraftError(taskId);
      }

      let revisionId: PlanDraftRevisionId | undefined;
      if (expectedRevisionId !== undefined) {
        const metadata = await this.readUsableMetadata(
          plansDirectory,
          draftContent,
        );
        if (metadata === null || metadata.revisionId !== expectedRevisionId) {
          throw new PlanDraftRevisionMismatchError(taskId, expectedRevisionId);
        }
        revisionId = metadata.revisionId;
      }

      if (currentContent !== null) {
        await this.preserveInArchive(taskId, plansDirectory, currentContent);
      }

      // rename commits the new authority and removes the draft in one
      // operation; the now-stale draft metadata is removed after it.
      await this.stateStore.move(
        `${plansDirectory}/draft.md`,
        `${plansDirectory}/current.md`,
      );
      await this.stateStore.removeFile(`${plansDirectory}/draft.meta.json`);
      return {
        taskId,
        status: "accepted" as const,
        content: draftContent,
        ...(revisionId === undefined ? {} : { acceptedFromRevisionId: revisionId }),
      };
    });
  }

  /**
   * Rejects and DELETES the current draft, requiring an exact revision.
   *
   * Per accepted architecture a rejected draft is deleted, not archived. The
   * current accepted plan and the task lifecycle are untouched.
   */
  async rejectDraft(
    taskId: TaskId,
    expectedRevisionId: PlanDraftRevisionId,
  ): Promise<{ readonly taskId: TaskId; readonly rejectedRevisionId: PlanDraftRevisionId }> {
    const plansDirectory = await this.plansDirectory(taskId);
    return this.withPlanMutationLock(async () => {
      const draftContent = await this.stateStore.readText(
        `${plansDirectory}/draft.md`,
      );
      if (draftContent === null) {
        throw new PlanDraftRevisionMismatchError(taskId, expectedRevisionId);
      }
      const metadata = await this.readUsableMetadata(
        plansDirectory,
        draftContent,
      );
      if (metadata === null || metadata.revisionId !== expectedRevisionId) {
        throw new PlanDraftRevisionMismatchError(taskId, expectedRevisionId);
      }

      // Metadata first, then content: a crash between them leaves an
      // orphaned draft with no usable metadata, which re-hydrates to a FRESH
      // revision -- so the rejected revision can never be decided again.
      await this.stateStore.removeFile(`${plansDirectory}/draft.meta.json`);
      await this.stateStore.removeFile(`${plansDirectory}/draft.md`);
      return { taskId, rejectedRevisionId: expectedRevisionId };
    });
  }

  async archiveCurrent(taskId: TaskId): Promise<ArchivedPlan | null> {
    const plansDirectory = await this.plansDirectory(taskId);
    return this.withPlanMutationLock(() =>
      this.archiveCurrentWhileLocked(taskId, plansDirectory),
    );
  }

  private async archiveCurrentWhileLocked(
    taskId: TaskId,
    plansDirectory: string,
  ): Promise<ArchivedPlan | null> {
    const currentContent = await this.stateStore.readText(
      `${plansDirectory}/current.md`,
    );
    if (currentContent === null) {
      return null;
    }

    const archivedPlan = await this.preserveInArchive(
      taskId,
      plansDirectory,
      currentContent,
    );
    await this.stateStore.removeFile(`${plansDirectory}/current.md`);
    return archivedPlan;
  }

  private async readUsableMetadata(
    plansDirectory: string,
    content: string,
  ): Promise<DraftRevisionMetadata | null> {
    const raw = await this.stateStore.readJson<unknown>(
      `${plansDirectory}/draft.meta.json`,
    );
    if (!isDraftRevisionMetadata(raw)) {
      return null;
    }
    // Never trust metadata whose hash does not match the draft bytes.
    return raw.contentHash === hashContent(content) ? raw : null;
  }

  private async writeMetadata(
    plansDirectory: string,
    content: string,
  ): Promise<DraftRevisionMetadata> {
    const metadata: DraftRevisionMetadata = {
      version: 1,
      revisionId: generateDraftRevisionId(),
      contentHash: hashContent(content),
      createdAt: new Date().toISOString(),
    };
    await this.stateStore.writeJson(
      `${plansDirectory}/draft.meta.json`,
      metadata,
    );
    return metadata;
  }

  /**
   * The single plan mutation serialization boundary.
   *
   * Every path touching draft, draft metadata, current or archive coordinates
   * through this one lock -- Planner persistence, accept, reject, metadata
   * hydration and archive/promotion. There is no MCP-only lock and no separate
   * accept-vs-write lock.
   */
  private async withPlanMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await this.lock.withLock(PLAN_MUTATION_LOCK_PATH, operation);
    } catch (error) {
      // The shared primitive raises a generic timeout; each domain keeps its
      // own stable public error code so callers can still tell the lock
      // domains apart.
      if (error instanceof LockAcquisitionTimeout) {
        throw new PlanMutationLockTimeoutError();
      }
      throw error;
    }
  }

  private async plansDirectory(taskId: TaskId): Promise<string> {
    return `${await this.taskManager.getStateDirectoryByTaskId(taskId)}/plans`;
  }

  private async preserveInArchive(
    taskId: TaskId,
    plansDirectory: string,
    content: string,
  ): Promise<ArchivedPlan> {
    for (;;) {
      const archiveFileName = createArchiveFileName();
      const created = await this.stateStore.createTextExclusive(
        `${plansDirectory}/archive/${archiveFileName}`,
        content,
      );
      if (created) {
        return {
          taskId,
          status: "archived",
          content,
          archiveFileName,
        };
      }
    }
  }
}

/** Placeholder revision for an un-hydrated draft; never matches a decision. */
const UNHYDRATED_REVISION_ID = "planrev_unhydrated" as PlanDraftRevisionId;

function generateDraftRevisionId(): PlanDraftRevisionId {
  return `planrev_${randomBytes(16).toString("hex")}`;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function isDraftRevisionMetadata(
  value: unknown,
): value is DraftRevisionMetadata {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<DraftRevisionMetadata>;
  return (
    candidate.version === 1 &&
    typeof candidate.revisionId === "string" &&
    /^planrev_[0-9a-f]{32}$/.test(candidate.revisionId) &&
    typeof candidate.contentHash === "string" &&
    typeof candidate.createdAt === "string"
  );
}

function createArchiveFileName(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = randomUUID().slice(0, 8);
  return `accepted-${timestamp}-${suffix}.md`;
}
