import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChangeSetApplyCheckFailedError,
  ChangeSetApplyInterruptedError,
  ChangeSetApplyRecoveryRequiredError,
  ChangeSetAlreadyDecidedError,
  ChangeSetCorruptError,
  ChangeSetNotInterruptedError,
  ChangeSetSourceDirtyError,
  ChangeSetSourceHeadChangedError,
  CoderStagingRequiresGitError,
  SourceMutationLockTimeoutError,
} from "../domain/errors.js";
import type { Project, ProjectId } from "../domain/project.js";
import type { TaskId } from "../domain/task.js";
import {
  LockAcquisitionTimeout,
  RecoverableProcessLock,
} from "../infrastructure/recoverable-process-lock.js";
import {
  SpawnIsolatedGitRunner,
  type IsolatedGitRunner,
} from "../infrastructure/isolated-git-runner.js";
import type { StateStore } from "../infrastructure/state-store.js";
import type { ChangeSetMetadata } from "./coder-change-set-manager.js";
import type { TaskManager } from "./task-manager.js";

/**
 * Terminal decision for one change-set instance. A change set can never move
 * `rejected -> applied` or `applied -> rejected`: records are created
 * exclusively and never overwritten.
 */
export type ChangeSetDecision = "applied" | "rejected";

export interface ChangeSetDecisionRecord {
  readonly version: 1;
  readonly changeSetId: string;
  readonly decision: ChangeSetDecision;
  readonly projectId: ProjectId;
  readonly taskId: TaskId;
  readonly baseCommit: string;
  /** Present on an applied receipt: the verified post-apply tree. */
  readonly resultTree?: string;
  readonly patchHash: string;
  readonly decidedAt: string;
  /**
   * Present only on a receipt finalized by observing an already-applied
   * source, never on a receipt written by a live apply. System-generated: no
   * provider or caller can supply or override it, and legacy receipts without
   * it stay readable.
   */
  readonly reconciliation?: {
    readonly mode: "observed_exact_result";
    readonly reconciledAt: string;
  };
}

/**
 * Durable record that real-source mutation was about to begin.
 *
 * Written BEFORE the first write, so a crash mid-apply is detectable rather
 * than leaving a half-applied repository indistinguishable from an ordinary
 * dirty one. Carries no ownership token, staging path or credentials.
 */
export interface ChangeSetApplyIntent {
  readonly version: 1;
  readonly changeSetId: string;
  readonly projectId: ProjectId;
  readonly taskId: TaskId;
  readonly baseCommit: string;
  readonly expectedResultTree: string;
  readonly patchHash: string;
  readonly startedAt: string;
}

/** Externally observable state of one change set. */
export type ChangeSetState =
  | "pending"
  | "applying_interrupted"
  | "applied"
  | "rejected";

/**
 * What the REAL source workspace was observed to be, relative to one exact
 * change set. Derived only from Git object identity -- never supplied by a
 * caller, a provider or a patch.
 */
export type ObservedSourceState = "base_clean" | "exact_applied" | "divergent";

/**
 * Safe diagnostics behind a classification. These explain a `divergent`
 * verdict; they are NEVER an alternative authority, and the classification is
 * always recomputed from Git rather than assembled from these booleans.
 */
export interface SourceObservation {
  readonly observedSourceState: ObservedSourceState;
  readonly headMatchesBase: boolean;
  readonly indexMatchesBase: boolean;
  readonly indexMatchesResult: boolean;
  readonly worktreeMatchesIndex: boolean;
  readonly hasUntracked: boolean;
}

export interface InterruptedApplyRecoveryState {
  readonly changeSetId: string;
  readonly state: ChangeSetState;
  readonly observation: SourceObservation | null;
  readonly reconciliationAvailable: boolean;
}

export interface ChangeSetReconciliation {
  readonly changeSetId: string;
  readonly previousState: ChangeSetState;
  readonly observedSourceState: ObservedSourceState;
  readonly resultingState: ChangeSetState;
  readonly decision: ChangeSetDecisionRecord | null;
}

export interface ChangeSetStatus {
  readonly state: ChangeSetState;
  readonly decision: ChangeSetDecisionRecord | null;
  readonly intent: ChangeSetApplyIntent | null;
}

export interface ChangeSetApplyManagerOptions {
  readonly gitRunner?: IsolatedGitRunner;
  readonly temporaryRoot?: string;
  /** Test seam fired after the intent is written, before source mutation. */
  readonly beforeSourceMutation?: () => Promise<void>;
  /** Test seam fired after `git apply`, before verification. */
  readonly afterSourceMutation?: () => Promise<void>;
  /** Injectable so tests can supply liveness probes and recovery seams. */
  readonly lock?: RecoverableProcessLock;
}

const SOURCE_MUTATION_LOCK_PREFIX = "state/source-locks";

export class ChangeSetApplyManager {
  private readonly gitRunner: IsolatedGitRunner;
  private readonly lock: RecoverableProcessLock;
  private readonly temporaryRoot: string;

  constructor(
    private readonly stateStore: StateStore,
    private readonly taskManager: Pick<TaskManager, "getStateDirectoryByTaskId">,
    private readonly options: ChangeSetApplyManagerOptions = {},
  ) {
    this.gitRunner = options.gitRunner ?? new SpawnIsolatedGitRunner();
    this.temporaryRoot = options.temporaryRoot ?? tmpdir();
    this.lock = options.lock ?? new RecoverableProcessLock(stateStore);
  }

  /** Reads the observable state, deriving it from decision and intent records. */
  async status(
    taskId: TaskId,
    changeSetId: string,
  ): Promise<ChangeSetStatus> {
    const [decision, intent] = await Promise.all([
      this.readDecision(taskId, changeSetId),
      this.readIntent(taskId, changeSetId),
    ]);
    if (decision !== null) {
      // A terminal receipt always wins over a stale intent left by a crash
      // between the receipt write and intent removal.
      return { state: decision.decision, decision, intent };
    }
    if (intent !== null) {
      return { state: "applying_interrupted", decision: null, intent };
    }
    return { state: "pending", decision: null, intent: null };
  }

  /**
   * Applies a change set to the registered source workspace.
   *
   * The caller must already hold task-ownership authority; this method owns
   * the per-project source-mutation lock and every source precondition.
   *
   * Sequence: verify Git worktree, `HEAD == baseCommit`, and a strictly clean
   * worktree; resolve the expected result tree; write the durable intent;
   * `git apply --check` then `git apply --index --binary`; verify the exact
   * post-apply tree; only then write the immutable applied receipt.
   */
  async apply(input: {
    readonly project: Project;
    readonly taskId: TaskId;
    readonly metadata: ChangeSetMetadata;
    readonly patch: Buffer;
  }): Promise<ChangeSetDecisionRecord> {
    const { project, taskId, metadata, patch } = input;
    const isolatedHome = await mkdtemp(
      join(this.temporaryRoot, "synaphex-apply-home-"),
    );
    try {
      await this.assertUndecided(taskId, metadata.changeSetId);
      await this.assertCleanBaseline(project, metadata, isolatedHome);
      const expectedResultTree = await this.resolveResultTree(
        project,
        metadata,
        patch,
        isolatedHome,
      );

      // Durable intent BEFORE the first real-source write.
      const intent: ChangeSetApplyIntent = {
        version: 1,
        changeSetId: metadata.changeSetId,
        projectId: metadata.projectId,
        taskId,
        baseCommit: metadata.baseCommit,
        expectedResultTree,
        patchHash: metadata.patchHash,
        startedAt: new Date().toISOString(),
      };
      await this.writeIntent(taskId, intent);
      if (this.options.beforeSourceMutation !== undefined) {
        await this.options.beforeSourceMutation();
      }

      const patchFile = join(isolatedHome, "changes.patch");
      await writeFile(patchFile, patch);

      // Dry run first, so an inapplicable patch never starts a mutation.
      const check = await this.git(
        ["apply", "--check", "--index", "--binary", patchFile],
        project.sourcePath,
        isolatedHome,
      );
      if (check.exitCode !== 0) {
        await this.removeIntent(taskId, metadata.changeSetId);
        // No merge, cherry-pick or --3way rescue: a patch that cannot apply
        // exactly indicates inconsistency, and resolving it would produce a
        // result the user never reviewed.
        throw new ChangeSetApplyCheckFailedError(metadata.changeSetId, "check");
      }

      const applied = await this.git(
        ["apply", "--index", "--binary", patchFile],
        project.sourcePath,
        isolatedHome,
      );
      if (this.options.afterSourceMutation !== undefined) {
        await this.options.afterSourceMutation();
      }
      if (applied.exitCode !== 0) {
        await this.rollback(project, metadata, isolatedHome, taskId);
        throw new ChangeSetApplyCheckFailedError(metadata.changeSetId, "apply");
      }

      const verification = await this.verifyApplied(
        project,
        metadata,
        expectedResultTree,
        isolatedHome,
      );
      if (verification !== null) {
        await this.rollback(project, metadata, isolatedHome, taskId);
        throw new ChangeSetApplyCheckFailedError(
          metadata.changeSetId,
          verification,
        );
      }

      // Only now is the terminal receipt authoritative.
      const receipt: ChangeSetDecisionRecord = {
        version: 1,
        changeSetId: metadata.changeSetId,
        decision: "applied",
        projectId: metadata.projectId,
        taskId,
        baseCommit: metadata.baseCommit,
        resultTree: expectedResultTree,
        patchHash: metadata.patchHash,
        decidedAt: new Date().toISOString(),
      };
      await this.writeDecision(taskId, receipt);
      await this.removeIntent(taskId, metadata.changeSetId);
      return receipt;
    } finally {
      await rm(isolatedHome, { recursive: true, force: true });
    }
  }

  /** Records an immutable rejection. Never touches the source workspace. */
  async reject(input: {
    readonly taskId: TaskId;
    readonly metadata: ChangeSetMetadata;
  }): Promise<ChangeSetDecisionRecord> {
    await this.assertUndecided(input.taskId, input.metadata.changeSetId);
    const receipt: ChangeSetDecisionRecord = {
      version: 1,
      changeSetId: input.metadata.changeSetId,
      decision: "rejected",
      projectId: input.metadata.projectId,
      taskId: input.taskId,
      baseCommit: input.metadata.baseCommit,
      patchHash: input.metadata.patchHash,
      decidedAt: new Date().toISOString(),
    };
    await this.writeDecision(input.taskId, receipt);
    return receipt;
  }

  /**
   * Classifies the REAL source against one exact change set.
   *
   * Read-only with respect to the user's files: it runs only identity and
   * comparison plumbing (`rev-parse`, `write-tree`, `diff`, `ls-files`). It
   * never applies, resets, checks out, cleans or merges anything.
   *
   * `write-tree` writes tree OBJECTS into the object database, which is
   * additive and unreferenced -- it changes no file, no index entry and no
   * ref. It is the same call Phase 5C already uses to verify an apply.
   */
  async observeSource(
    project: Project,
    metadata: ChangeSetMetadata,
    patch: Buffer,
  ): Promise<SourceObservation> {
    const isolatedHome = await mkdtemp(
      join(this.temporaryRoot, "synaphex-observe-home-"),
    );
    try {
      const head = (
        await this.git(
          ["rev-parse", "--verify", "HEAD^{commit}"],
          project.sourcePath,
          isolatedHome,
        )
      ).stdout.trim();
      const baseTree = (
        await this.git(
          ["rev-parse", "--verify", `${metadata.baseCommit}^{tree}`],
          project.sourcePath,
          isolatedHome,
        )
      ).stdout.trim();
      const indexTree = (
        await this.git(["write-tree"], project.sourcePath, isolatedHome)
      ).stdout.trim();
      const unstaged = (
        await this.git(
          ["diff", "--name-only", "-z"],
          project.sourcePath,
          isolatedHome,
        )
      ).stdout
        .split("\0")
        .filter((entry) => entry.length > 0);
      const untracked = (
        await this.git(
          ["ls-files", "--others", "--exclude-standard", "-z"],
          project.sourcePath,
          isolatedHome,
        )
      ).stdout
        .split("\0")
        .filter((entry) => entry.length > 0);

      // Legacy change sets carry no resultTree; derive it exactly as Phase 5C
      // does, in an isolated clone, without touching the real source.
      const expectedResultTree = await this.resolveResultTree(
        project,
        metadata,
        patch,
        isolatedHome,
      );

      const headMatchesBase = head === metadata.baseCommit && head.length > 0;
      const indexMatchesBase = indexTree === baseTree && baseTree.length > 0;
      const indexMatchesResult =
        indexTree === expectedResultTree && expectedResultTree.length > 0;
      const worktreeMatchesIndex = unstaged.length === 0;
      const hasUntracked = untracked.length > 0;

      // Both positive classifications demand ALL FOUR conditions. An index
      // that matches while an unstaged edit or an untracked file exists is
      // NOT provably either state, and must fall through to divergent.
      const clean = headMatchesBase && worktreeMatchesIndex && !hasUntracked;
      let observedSourceState: ObservedSourceState = "divergent";
      if (clean && indexMatchesBase) {
        observedSourceState = "base_clean";
      } else if (clean && indexMatchesResult) {
        observedSourceState = "exact_applied";
      }

      return {
        observedSourceState,
        headMatchesBase,
        indexMatchesBase,
        indexMatchesResult,
        worktreeMatchesIndex,
        hasUntracked,
      };
    } finally {
      await rm(isolatedHome, { recursive: true, force: true });
    }
  }

  /** Resolves the expected result tree in an isolated scratch HOME. */
  private async observedResultTree(
    project: Project,
    metadata: ChangeSetMetadata,
    patch: Buffer,
  ): Promise<string> {
    const isolatedHome = await mkdtemp(
      join(this.temporaryRoot, "synaphex-observe-tree-"),
    );
    try {
      return await this.resolveResultTree(project, metadata, patch, isolatedHome);
    } finally {
      await rm(isolatedHome, { recursive: true, force: true });
    }
  }

  /**
   * Reconciles an interrupted apply by OBSERVING the source, never by
   * changing it.
   *
   * The caller does not choose the outcome: there is no mode, no force and no
   * assume-applied. Synaphex derives the only transition that is provably
   * consistent with the exact persisted change set.
   *
   * ```text
   * base_clean     -> remove the intent; the change set is pending again
   * exact_applied  -> write the terminal applied receipt, then remove the intent
   * divergent      -> mutate NOTHING; explicit manual source recovery required
   * ```
   *
   * The caller must already hold the source-mutation lock and task-ownership
   * authority; every input is re-read here, inside that boundary.
   */
  async reconcileInterruptedApply(input: {
    readonly project: Project;
    readonly taskId: TaskId;
    readonly metadata: ChangeSetMetadata;
    readonly patch: Buffer;
  }): Promise<ChangeSetReconciliation> {
    const { project, taskId, metadata, patch } = input;
    const changeSetId = metadata.changeSetId;

    // Re-read authoritative state INSIDE the authority boundary, so a decision
    // is never made on an observation taken before the lock was held.
    const status = await this.status(taskId, changeSetId);
    if (status.state !== "applying_interrupted") {
      throw new ChangeSetNotInterruptedError(changeSetId, status.state);
    }

    const observation = await this.observeSource(project, metadata, patch);

    if (observation.observedSourceState === "base_clean") {
      // No source mutation survived the crash. The ONLY durable change is
      // resolving the intent; no receipt is written, so the change set simply
      // becomes decidable again.
      await this.removeIntent(taskId, changeSetId);
      return {
        changeSetId,
        previousState: "applying_interrupted",
        observedSourceState: "base_clean",
        resultingState: "pending",
        decision: null,
      };
    }

    if (observation.observedSourceState === "exact_applied") {
      // The intent recorded the expected tree before mutation began; fall back
      // to a re-derivation only for an intent written before that field
      // existed.
      const resultTree =
        status.intent?.expectedResultTree ??
        (await this.observedResultTree(project, metadata, patch));
      // The apply had already fully succeeded. Finalize the receipt from
      // PERSISTED authority only -- the patch is never re-applied and not one
      // source file is touched.
      const receipt: ChangeSetDecisionRecord = {
        version: 1,
        changeSetId,
        decision: "applied",
        projectId: metadata.projectId,
        taskId,
        baseCommit: metadata.baseCommit,
        resultTree,
        patchHash: metadata.patchHash,
        decidedAt: new Date().toISOString(),
        reconciliation: {
          mode: "observed_exact_result",
          reconciledAt: new Date().toISOString(),
        },
      };
      // Receipt BEFORE intent removal, matching Phase 5C: a crash between the
      // two leaves a terminal receipt that outranks the stale intent.
      await this.writeDecision(taskId, receipt);
      await this.removeIntent(taskId, changeSetId);
      return {
        changeSetId,
        previousState: "applying_interrupted",
        observedSourceState: "exact_applied",
        resultingState: "applied",
        decision: receipt,
      };
    }

    // Divergent: Synaphex cannot know whether the differences were written by
    // its own interrupted apply, by the user, by an editor or by another
    // process. Guessing could destroy legitimate work, so nothing is mutated.
    throw new ChangeSetApplyRecoveryRequiredError(changeSetId);
  }

  /**
   * Verifies that the source STILL exactly represents an applied change set.
   *
   * Returns `null` when it matches, or a short reason when it has drifted.
   */
  async verifyAppliedStillCurrent(
    project: Project,
    decision: ChangeSetDecisionRecord,
  ): Promise<string | null> {
    const isolatedHome = await mkdtemp(
      join(this.temporaryRoot, "synaphex-verify-home-"),
    );
    try {
      return await this.verifyApplied(
        project,
        {
          changeSetId: decision.changeSetId,
          baseCommit: decision.baseCommit,
        } as ChangeSetMetadata,
        decision.resultTree ?? "",
        isolatedHome,
      );
    } finally {
      await rm(isolatedHome, { recursive: true, force: true });
    }
  }

  /**
   * Runs an operation under the per-project source-mutation lock.
   *
   * ONE lock per registered project, because two tasks may point at the same
   * source. Lock order is documented and fixed:
   *
   * ```text
   * source-mutation lock  ->  withTaskOwnershipAuthority(...)
   * ```
   *
   * Never acquired in the reverse order, and never held across provider
   * execution -- apply is a short deterministic local operation.
   */
  async withSourceMutationLock<T>(
    projectId: ProjectId,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await this.lock.withLock(
        `${SOURCE_MUTATION_LOCK_PREFIX}/${projectId}.json`,
        operation,
      );
    } catch (error) {
      // Keep this domain's own public code: a caller must be able to tell a
      // contended SOURCE lock from a contended task-binding one.
      if (error instanceof LockAcquisitionTimeout) {
        throw new SourceMutationLockTimeoutError(projectId);
      }
      throw error;
    }
  }

  // --- internals ---------------------------------------------------------

  private async assertUndecided(
    taskId: TaskId,
    changeSetId: string,
  ): Promise<void> {
    const status = await this.status(taskId, changeSetId);
    if (status.state === "applied" || status.state === "rejected") {
      throw new ChangeSetAlreadyDecidedError(changeSetId, status.state);
    }
    if (status.state === "applying_interrupted") {
      // Never silently reset the user's source after a crash: edits made
      // afterwards could be destroyed. Recovery is explicit and later work.
      throw new ChangeSetApplyInterruptedError(changeSetId);
    }
  }

  private async assertCleanBaseline(
    project: Project,
    metadata: ChangeSetMetadata,
    isolatedHome: string,
  ): Promise<void> {
    const insideWorktree = await this.git(
      ["rev-parse", "--is-inside-work-tree"],
      project.sourcePath,
      isolatedHome,
    );
    if (
      insideWorktree.exitCode !== 0 ||
      insideWorktree.stdout.trim() !== "true"
    ) {
      throw new CoderStagingRequiresGitError(project.id);
    }
    const head = await this.git(
      ["rev-parse", "--verify", "HEAD^{commit}"],
      project.sourcePath,
      isolatedHome,
    );
    if (head.stdout.trim() !== metadata.baseCommit) {
      // Branch names are irrelevant; only the exact object id matters.
      throw new ChangeSetSourceHeadChangedError(
        metadata.changeSetId,
        metadata.baseCommit,
      );
    }
    const status = await this.git(
      ["status", "--porcelain=v1", "--untracked-files=all", "-z"],
      project.sourcePath,
      isolatedHome,
    );
    const entries = status.stdout.split("\0").filter((e) => e.length > 0);
    if (entries.length > 0) {
      // No stash, reset, clean or merge: the user's work is never displaced.
      throw new ChangeSetSourceDirtyError(
        metadata.changeSetId,
        entries.length,
      );
    }
  }

  /**
   * Returns the recorded result tree, or derives it for a legacy Phase-5B
   * change set in an isolated temporary clone -- never by touching the real
   * source and never from provider-supplied metadata.
   */
  private async resolveResultTree(
    project: Project,
    metadata: ChangeSetMetadata,
    patch: Buffer,
    isolatedHome: string,
  ): Promise<string> {
    if (metadata.resultTree !== undefined) {
      return metadata.resultTree;
    }
    const derivationRoot = await mkdtemp(
      join(this.temporaryRoot, "synaphex-derive-tree-"),
    );
    try {
      const clonePath = join(derivationRoot, "repo");
      const cloned = await this.git(
        [
          "clone",
          "--quiet",
          "--no-local",
          "--no-hardlinks",
          "--no-checkout",
          project.sourcePath,
          clonePath,
        ],
        derivationRoot,
        isolatedHome,
      );
      if (cloned.exitCode !== 0) {
        throw new ChangeSetCorruptError(
          metadata.changeSetId,
          "result tree could not be derived",
        );
      }
      await this.git(
        ["checkout", "--quiet", "--force", "--detach", metadata.baseCommit],
        clonePath,
        isolatedHome,
      );
      const patchFile = join(derivationRoot, "derive.patch");
      await writeFile(patchFile, patch);
      const applied = await this.git(
        ["apply", "--index", "--binary", patchFile],
        clonePath,
        isolatedHome,
      );
      if (applied.exitCode !== 0) {
        throw new ChangeSetApplyCheckFailedError(
          metadata.changeSetId,
          "legacy tree derivation",
        );
      }
      const tree = await this.git(["write-tree"], clonePath, isolatedHome);
      const resultTree = tree.stdout.trim();
      if (!/^[0-9a-f]{40,64}$/.test(resultTree)) {
        throw new ChangeSetCorruptError(
          metadata.changeSetId,
          "derived result tree is invalid",
        );
      }
      return resultTree;
    } finally {
      await rm(derivationRoot, { recursive: true, force: true });
    }
  }

  /** Stronger than a zero exit code from `git apply`. */
  private async verifyApplied(
    project: Project,
    metadata: Pick<ChangeSetMetadata, "changeSetId" | "baseCommit">,
    expectedResultTree: string,
    isolatedHome: string,
  ): Promise<string | null> {
    const head = await this.git(
      ["rev-parse", "--verify", "HEAD^{commit}"],
      project.sourcePath,
      isolatedHome,
    );
    if (head.stdout.trim() !== metadata.baseCommit) {
      return "head_changed";
    }
    const tree = await this.git(
      ["write-tree"],
      project.sourcePath,
      isolatedHome,
    );
    if (tree.stdout.trim() !== expectedResultTree) {
      return "tree_mismatch";
    }
    // The worktree must match the index exactly.
    const unstaged = await this.git(
      ["diff", "--name-only", "-z"],
      project.sourcePath,
      isolatedHome,
    );
    if (unstaged.stdout.split("\0").filter((e) => e.length > 0).length > 0) {
      return "worktree_differs_from_index";
    }
    const untracked = await this.git(
      ["ls-files", "--others", "--exclude-standard", "-z"],
      project.sourcePath,
      isolatedHome,
    );
    if (untracked.stdout.split("\0").filter((e) => e.length > 0).length > 0) {
      return "untracked_present";
    }
    return null;
  }

  /**
   * Restores the known-clean baseline after a failed apply.
   *
   * `git clean` is deliberately NOT run: an external writer may have created
   * an untracked file concurrently, and destroying it would be worse than
   * failing. If the exact clean baseline is not restored, the intent is KEPT
   * and recovery becomes explicit.
   */
  private async rollback(
    project: Project,
    metadata: ChangeSetMetadata,
    isolatedHome: string,
    taskId: TaskId,
  ): Promise<void> {
    await this.git(
      ["reset", "--hard", "--quiet", metadata.baseCommit],
      project.sourcePath,
      isolatedHome,
    );
    const head = await this.git(
      ["rev-parse", "--verify", "HEAD^{commit}"],
      project.sourcePath,
      isolatedHome,
    );
    const status = await this.git(
      ["status", "--porcelain=v1", "--untracked-files=all", "-z"],
      project.sourcePath,
      isolatedHome,
    );
    const clean =
      head.stdout.trim() === metadata.baseCommit &&
      status.stdout.split("\0").filter((e) => e.length > 0).length === 0;
    if (clean) {
      await this.removeIntent(taskId, metadata.changeSetId);
      return;
    }
    throw new ChangeSetApplyRecoveryRequiredError(metadata.changeSetId);
  }

  private async readDecision(
    taskId: TaskId,
    changeSetId: string,
  ): Promise<ChangeSetDecisionRecord | null> {
    const value = await this.stateStore.readJson<unknown>(
      `${await this.changesDirectory(taskId)}/decisions/${changeSetId}.json`,
    );
    return isDecisionRecord(value) ? value : null;
  }

  private async readIntent(
    taskId: TaskId,
    changeSetId: string,
  ): Promise<ChangeSetApplyIntent | null> {
    const value = await this.stateStore.readJson<unknown>(
      `${await this.changesDirectory(taskId)}/apply-intents/${changeSetId}.json`,
    );
    return isApplyIntent(value) ? value : null;
  }

  private async writeDecision(
    taskId: TaskId,
    record: ChangeSetDecisionRecord,
  ): Promise<void> {
    const directory = `${await this.changesDirectory(taskId)}/decisions`;
    await this.stateStore.ensureDirectory(directory);
    // Exclusive: a terminal decision is immutable and never overwritten, so a
    // change set can never move between applied and rejected.
    const created = await this.stateStore.createJsonExclusive(
      `${directory}/${record.changeSetId}.json`,
      record,
    );
    if (!created) {
      throw new ChangeSetAlreadyDecidedError(
        record.changeSetId,
        record.decision,
      );
    }
  }

  private async writeIntent(
    taskId: TaskId,
    intent: ChangeSetApplyIntent,
  ): Promise<void> {
    const directory = `${await this.changesDirectory(taskId)}/apply-intents`;
    await this.stateStore.ensureDirectory(directory);
    await this.stateStore.writeJson(
      `${directory}/${intent.changeSetId}.json`,
      intent,
    );
  }

  private async removeIntent(
    taskId: TaskId,
    changeSetId: string,
  ): Promise<void> {
    await this.stateStore.removeFile(
      `${await this.changesDirectory(taskId)}/apply-intents/${changeSetId}.json`,
    );
  }

  private async changesDirectory(taskId: TaskId): Promise<string> {
    return `${await this.taskManager.getStateDirectoryByTaskId(taskId)}/changes`;
  }

  private async git(
    args: readonly string[],
    cwd: string,
    isolatedHome: string,
  ) {
    return this.gitRunner.run({ args, cwd, isolatedHome });
  }
}

function isDecisionRecord(value: unknown): value is ChangeSetDecisionRecord {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ChangeSetDecisionRecord>;
  return (
    candidate.version === 1 &&
    typeof candidate.changeSetId === "string" &&
    (candidate.decision === "applied" || candidate.decision === "rejected") &&
    typeof candidate.baseCommit === "string" &&
    typeof candidate.patchHash === "string"
  );
}

function isApplyIntent(value: unknown): value is ChangeSetApplyIntent {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ChangeSetApplyIntent>;
  return (
    candidate.version === 1 &&
    typeof candidate.changeSetId === "string" &&
    typeof candidate.baseCommit === "string" &&
    typeof candidate.expectedResultTree === "string" &&
    typeof candidate.patchHash === "string"
  );
}
