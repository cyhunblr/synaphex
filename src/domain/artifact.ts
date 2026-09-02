import type { ProjectId } from "./project.js";
import type { TaskId } from "./task.js";
import type {
  ReviewerFailureOrigin,
  ReviewerStatus,
} from "./agent-result.js";

export const ARTIFACT_CATEGORIES = [
  "questioner",
  "researcher",
  "coder",
  "reviewer",
] as const;

export type ArtifactCategory = (typeof ARTIFACT_CATEGORIES)[number];
export type RunArtifactCategory = Exclude<ArtifactCategory, "questioner">;
export type ArtifactId = `artifact_${string}`;
export type ArtifactPayload = Readonly<Record<string, unknown>>;

export interface ProjectArtifactScope {
  readonly kind: "project";
  readonly projectId: ProjectId;
}

export interface TaskArtifactScope {
  readonly kind: "task";
  readonly projectId: ProjectId;
  readonly taskId: TaskId;
}

export type ArtifactScope = ProjectArtifactScope | TaskArtifactScope;

export interface ArtifactRecordBase<
  TCategory extends RunArtifactCategory,
  TScope extends ArtifactScope,
> {
  readonly id: ArtifactId;
  readonly category: TCategory;
  readonly scope: TScope;
  readonly createdAt: string;
  readonly payload: ArtifactPayload;
}

export type ResearchArtifactRecord = ArtifactRecordBase<
  "researcher",
  ArtifactScope
>;

export type CoderArtifactRecord = ArtifactRecordBase<
  "coder",
  TaskArtifactScope
>;

export interface ReviewerLifecycleMetadata {
  readonly status: ReviewerStatus;
  readonly warnings: readonly string[];
  readonly failureOrigin?: ReviewerFailureOrigin;
}

export interface ReviewerArtifactRecord
  extends ArtifactRecordBase<"reviewer", TaskArtifactScope> {
  readonly review: ReviewerLifecycleMetadata;
}

export type ArtifactRecord =
  | ResearchArtifactRecord
  | CoderArtifactRecord
  | ReviewerArtifactRecord;

export type ArtifactRecordFor<TCategory extends RunArtifactCategory> = Extract<
  ArtifactRecord,
  { readonly category: TCategory }
>;

export interface QuestionerContext {
  readonly category: "questioner";
  readonly scope: TaskArtifactScope;
  readonly updatedAt: string;
  readonly payload: ArtifactPayload;
}

export type QuestionerContextRead =
  | {
      readonly scope: TaskArtifactScope;
      readonly hasContext: false;
      readonly context: null;
    }
  | {
      readonly scope: TaskArtifactScope;
      readonly hasContext: true;
      readonly context: QuestionerContext;
    };
