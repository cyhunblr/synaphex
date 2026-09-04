import {
  CoderStagingFailedError,
  CoderStagingUnsupportedRepositoryError,
  TaskSessionOwnershipLostError,
} from "../domain/errors.js";
import type { AgentContext } from "../domain/agent-context.js";
import type { CoderChangeSetReference } from "../domain/artifact.js";
import type { Project } from "../domain/project.js";
import type { SessionId } from "../domain/session.js";
import type { CoderChangeSetManager } from "./coder-change-set-manager.js";
import {
  isInternalSymlink,
  type CoderChangeSetCandidate,
  type CoderWorkspaceStager,
  type PreparedCoderWorkspace,
} from "./coder-workspace-stager.js";
import type { SessionManager, TaskOwnershipFence } from "./session-manager.js";

/**
 * Owns the staged-CODER lifecycle for `AgentInvocationService`.
 *
 * ```text
 * CODER edits staging
 *   -> Synaphex captures an immutable change set
 *      -> the real registered source remains untouched
 * ```
 *
 * This is provider-independent: it knows nothing about Codex, Claude or
 * Antigravity, and no provider adapter knows anything about staging. Every
 * `AgentInvocationService` CODER path goes through here, regardless of whether
 * the caller arrived via MCP, a CLI host or any future transport — Core
 * semantics do not depend on transport.
 */
export interface CoderStagingDependencies {
  readonly stager: Pick<
    CoderWorkspaceStager,
    "prepare" | "captureChanges" | "dispose"
  >;
  readonly changeSets: Pick<CoderChangeSetManager, "publish">;
  readonly sessions: Pick<
    SessionManager,
    "isTaskOwnershipCurrent" | "withTaskOwnershipAuthority"
  >;
}

export interface StagedCoderExecutionInput {
  readonly sessionId: SessionId;
  readonly project: Project;
  readonly taskId: `task_${string}`;
  readonly ownershipFence: TaskOwnershipFence;
  /**
   * Set when the caller already holds task-ownership authority across the
   * whole commit boundary. The task-binding lock is not reentrant, so
   * publication must not re-acquire it in that case.
   */
  readonly withinOwnershipAuthority?: boolean;
  readonly context: AgentContext;
  /** Runs the provider against the projected execution context. */
  readonly execute: (executionContext: AgentContext) => Promise<unknown>;
}

/**
 * Changes derived from the staging repository, not yet durable.
 *
 * Capture is separated from publication so the expensive Git work happens
 * OUTSIDE the task-binding lock, and only the short durable write happens
 * inside it.
 */
export interface CapturedCoderChanges {
  readonly candidate: CoderChangeSetCandidate | null;
}

export interface StagedCoderExecutionResult {
  readonly rawResult: unknown;
  /**
   * Derives the change set from Git state and revalidates the staging
   * repository. Runs no durable write, so it must NOT hold the task lock.
   */
  readonly capture: () => Promise<CapturedCoderChanges>;
  /** Durably publishes captured changes; `null` when nothing changed. */
  readonly publish: (
    captured: CapturedCoderChanges,
  ) => Promise<CoderChangeSetReference | null>;
  readonly dispose: () => Promise<void>;
}

const GITLINK_MODE = "160000";
const SYMLINK_MODE = "120000";

export class CoderStagingCoordinator {
  constructor(private readonly dependencies: CoderStagingDependencies) {}

  /**
   * Prepares staging, revalidates ownership, then runs the provider against a
   * projected execution context whose `project.sourcePath` is the staging
   * workspace.
   *
   * The registered project's real source path is never the provider's cwd and
   * is not present in the projected context, so a CODER provider is never told
   * the real source location merely for convenience. The persisted logical
   * project state is untouched.
   *
   * The returned handle defers publication so the caller can validate the
   * AgentResult and classify requests first, and always owns `dispose`.
   */
  async execute(
    input: StagedCoderExecutionInput,
  ): Promise<StagedCoderExecutionResult> {
    // Staging happens only after the pipeline has established that this CODER
    // invocation is legal, so an obvious failure never pays for a clone.
    const prepared = await this.dependencies.stager.prepare({
      projectId: input.project.id,
      taskId: input.taskId,
      sessionId: input.sessionId,
      sourcePath: input.project.sourcePath,
    });

    try {
      // Cloning can take time; ownership may have been revoked meanwhile. The
      // provider must not run without current authority.
      if (
        !(await this.dependencies.sessions.isTaskOwnershipCurrent(
          input.ownershipFence,
        ))
      ) {
        throw new TaskSessionOwnershipLostError(
          input.taskId,
          input.sessionId,
          "preflight",
        );
      }

      const executionContext = projectExecutionContext(
        input.context,
        prepared.stagingPath,
      );
      // Provider failures are NOT caught here: they must reach the caller's
      // AgentExecutionFailedError boundary with their cause intact, and the
      // caller's `finally` owns disposal. Only pre-execution failures dispose
      // eagerly below, since no handle has been returned yet.
      const rawResult = await input.execute(executionContext);

      return {
        rawResult,
        capture: async () => this.capture(input, prepared),
        publish: async (captured) => this.publish(input, captured),
        dispose: async () => this.dependencies.stager.dispose(prepared),
      };
    } catch (error) {
      await this.dependencies.stager.dispose(prepared);
      throw error;
    }
  }

  /**
   * Revalidates the staging repository, derives the change set from Git state,
   * and publishes it under the task-binding ownership authority.
   *
   * Phase-5A validated the source snapshot BEFORE execution; that is not
   * sufficient, because CODER can create unsafe structures while working. The
   * final staged/index state is therefore revalidated here.
   */
  private async capture(
    input: StagedCoderExecutionInput,
    prepared: PreparedCoderWorkspace,
  ): Promise<CapturedCoderChanges> {
    const candidate = await this.dependencies.stager.captureChanges(prepared);
    await this.assertStagingStillSafe(input, prepared);
    // No fake patch and no empty change-set directory.
    return {
      candidate: candidate.changedFiles.length === 0 ? null : candidate,
    };
  }

  private async publish(
    input: StagedCoderExecutionInput,
    captured: CapturedCoderChanges,
  ): Promise<CoderChangeSetReference | null> {
    const candidate = captured.candidate;
    if (candidate === null) {
      return null;
    }

    const write = async (): Promise<CoderChangeSetReference | null> => {
      const published = await this.dependencies.changeSets.publish(candidate);
      if (published === null) {
        return null;
      }
      return {
        id: published.metadata.changeSetId,
        baseCommit: published.metadata.baseCommit,
        patchHash: published.metadata.patchHash,
        patchBytes: published.metadata.patchBytes,
        changedFiles: published.metadata.changedFiles.map((file) => ({
          ...file,
        })),
      };
    };

    // Publication must happen under the authoritative task-binding lock, so a
    // force-release, rebind or completion cannot interleave between the
    // ownership check and the durable write.
    //
    // Phase 6A widened that boundary: the caller now holds it across BOTH the
    // change-set publication and the Coder work record, so the two cannot be
    // split by a concurrent completion. When the caller already holds the
    // authority, re-entering it here would self-deadlock on the same
    // non-reentrant task-binding lock, so publish directly instead.
    if (input.withinOwnershipAuthority === true) {
      return write();
    }
    // The lock covers only this short deterministic boundary -- never provider
    // execution.
    return this.dependencies.sessions.withTaskOwnershipAuthority(
      input.ownershipFence,
      write,
    );
  }

  /**
   * Post-provider repository safety audit.
   *
   * CODER may create a nested Git repository (which becomes a gitlink), a
   * symlink escaping the staging root, or re-add a remote. Any of those is
   * rejected and nothing is published.
   */
  private async assertStagingStillSafe(
    input: StagedCoderExecutionInput,
    prepared: PreparedCoderWorkspace,
  ): Promise<void> {
    const stager = this.dependencies.stager as {
      inspectStagedTree?: (
        prepared: PreparedCoderWorkspace,
      ) => Promise<StagedTreeInspection>;
    };
    if (stager.inspectStagedTree === undefined) {
      throw new CoderStagingFailedError("post-execution safety audit");
    }
    const inspection = await stager.inspectStagedTree(prepared);

    if (inspection.remotes.length > 0) {
      // The provider re-added a remote. Fail closed rather than stripping it
      // and continuing, since we cannot prove no side effect occurred.
      throw new CoderStagingUnsupportedRepositoryError(
        input.project.id,
        "provider_added_remote",
      );
    }
    for (const entry of inspection.entries) {
      if (entry.mode === GITLINK_MODE) {
        throw new CoderStagingUnsupportedRepositoryError(
          input.project.id,
          "submodule_gitlink",
        );
      }
      if (
        entry.mode === SYMLINK_MODE &&
        !isInternalSymlink(entry.path, entry.symlinkTarget ?? "")
      ) {
        throw new CoderStagingUnsupportedRepositoryError(
          input.project.id,
          "unsafe_symlink",
        );
      }
    }
  }
}

export interface StagedTreeEntry {
  readonly mode: string;
  readonly path: string;
  readonly symlinkTarget?: string;
}

export interface StagedTreeInspection {
  readonly entries: readonly StagedTreeEntry[];
  readonly remotes: readonly string[];
}

/**
 * Builds the ephemeral provider-facing context projection.
 *
 * Only `project.sourcePath` is replaced, so the accepted provider adapters
 * continue treating `input.context.project.sourcePath` as their cwd with no
 * provider-specific staging knowledge. Nothing is persisted.
 */
export function projectExecutionContext(
  context: AgentContext,
  executionWorkspacePath: string,
): AgentContext {
  return {
    ...context,
    project: { ...context.project, sourcePath: executionWorkspacePath },
  };
}

export type { CoderChangeSetCandidate };
