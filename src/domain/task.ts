import type { ProjectId } from "./project.js";

export type TaskId = `task_${string}`;

export const TASK_STATUSES = ["active", "completed", "archived"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Task {
  readonly id: TaskId;
  readonly projectId: ProjectId;
  readonly slug: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly archivedAt: string | null;
}
