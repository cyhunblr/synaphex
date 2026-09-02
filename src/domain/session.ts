import type { ProjectId } from "./project.js";
import type { TaskId } from "./task.js";

export type SessionId = string;

export type SessionBinding =
  | {
      readonly sessionId: SessionId;
      readonly projectId: null;
      readonly taskId: null;
    }
  | {
      readonly sessionId: SessionId;
      readonly projectId: ProjectId;
      readonly taskId: TaskId | null;
    };
