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

/**
 * The one canonical artifact-id shape: `artifact_` plus 32 lowercase hex.
 *
 * Kept here as a single source so the provider-facing JSON Schema and the
 * result-validation path cannot drift. A schema that accepted a looser value
 * than the parser promised providers something the ResultProcessor would then
 * reject, which is exactly the failure this constant prevents.
 */
export const ARTIFACT_ID_PATTERN = "^artifact_[a-f0-9]{32}$";

export function isArtifactId(value: unknown): value is ArtifactId {
  return typeof value === "string" && new RegExp(ARTIFACT_ID_PATTERN).test(value);
}
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

/**
 * Authoritative, system-generated reference from a CODER work record to the
 * immutable change set that invocation produced.
 *
 * Deliberately a SIBLING of `payload`, not a field inside it: `payload` holds
 * configurable provider output, and a provider must never be able to forge a
 * change-set identity, base commit, patch hash or file manifest. Synaphex
 * derives every field here from Git state.
 *
 * `null` for a successful CODER invocation that produced no filesystem
 * changes; absent entirely on legacy records written before staging existed.
 */
export interface CoderChangeSetReference {
  readonly id: string;
  readonly baseCommit: string;
  readonly patchHash: string;
  readonly patchBytes: number;
  readonly changedFiles: readonly {
    readonly path: string;
    readonly change: "added" | "modified" | "deleted";
    readonly binary: boolean;
  }[];
}

export interface CoderArtifactRecord
  extends ArtifactRecordBase<"coder", TaskArtifactScope> {
  /**
   * Present on every staged CODER record (possibly `null`). Absent on a
   * legacy record, which represents historical direct-source execution and is
   * never reinterpreted as a staged change set.
   */
  readonly changeSet?: CoderChangeSetReference | null;
}

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
