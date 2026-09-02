import type { ProjectId } from "./project.js";
import type { SessionId } from "./session.js";
import type { TaskId } from "./task.js";

export type MemoryScope =
  | {
      readonly kind: "project";
      readonly projectId: ProjectId;
    }
  | {
      readonly kind: "task";
      readonly projectId: ProjectId;
      readonly taskId: TaskId;
    };

export type MemorySourceIdentity =
  | {
      readonly kind: "project";
      readonly projectId: ProjectId;
      readonly projectName: string;
    }
  | {
      readonly kind: "task";
      readonly projectId: ProjectId;
      readonly projectName: string;
      readonly taskId: TaskId;
      readonly taskSlug: string;
    };

export interface LoadedMemoryReference {
  readonly target: MemoryScope;
  readonly source: MemorySourceIdentity;
  readonly loadedAt: string;
}

export interface CanonicalMemoryRead {
  readonly scope: MemoryScope;
  readonly hasContent: boolean;
  readonly content: string | null;
}

export interface MemorySourceRequest {
  readonly sourceProjectRef: string;
  readonly sourceTaskRef?: string;
}

export interface MemoryLoadRequest extends MemorySourceRequest {
  readonly sessionId: SessionId;
}

export type MemoryUnloadRequest = MemoryLoadRequest;
