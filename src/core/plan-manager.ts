import { randomUUID } from "node:crypto";
import {
  InvalidPlanContentError,
  NoPlanDraftError,
  PlanAlreadyAcceptedError,
} from "../domain/errors.js";
import type {
  AcceptedPlan,
  ArchivedPlan,
  DraftPlan,
  PlanAvailability,
} from "../domain/plan.js";
import type { TaskId } from "../domain/task.js";
import { StateStore } from "../infrastructure/state-store.js";
import { TaskManager } from "./task-manager.js";

export class PlanManager {
  constructor(
    private readonly stateStore: StateStore,
    private readonly taskManager: TaskManager,
  ) {}

  async getDraft(taskId: TaskId): Promise<DraftPlan | null> {
    const plansDirectory = await this.plansDirectory(taskId);
    const content = await this.stateStore.readText(
      `${plansDirectory}/draft.md`,
    );
    return content === null
      ? null
      : { taskId, status: "draft", content };
  }

  async saveDraft(taskId: TaskId, content: string): Promise<DraftPlan> {
    const plansDirectory = await this.plansDirectory(taskId);
    if (content.trim().length === 0) {
      throw new InvalidPlanContentError();
    }

    await this.stateStore.writeText(`${plansDirectory}/draft.md`, content);
    return { taskId, status: "draft", content };
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

  async acceptDraft(taskId: TaskId): Promise<AcceptedPlan> {
    const plansDirectory = await this.plansDirectory(taskId);
    const [draftContent, currentContent] = await Promise.all([
      this.stateStore.readText(`${plansDirectory}/draft.md`),
      this.stateStore.readText(`${plansDirectory}/current.md`),
    ]);

    if (draftContent === null) {
      if (currentContent !== null) {
        throw new PlanAlreadyAcceptedError(taskId);
      }
      throw new NoPlanDraftError(taskId);
    }

    if (currentContent !== null) {
      await this.preserveInArchive(taskId, plansDirectory, currentContent);
    }

    // rename commits the new authority and removes the draft in one operation.
    await this.stateStore.move(
      `${plansDirectory}/draft.md`,
      `${plansDirectory}/current.md`,
    );
    return { taskId, status: "accepted", content: draftContent };
  }

  async archiveCurrent(taskId: TaskId): Promise<ArchivedPlan | null> {
    const plansDirectory = await this.plansDirectory(taskId);
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

function createArchiveFileName(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = randomUUID().slice(0, 8);
  return `accepted-${timestamp}-${suffix}.md`;
}
