import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";
import {
  CoderStagingFailedError,
  CoderStagingRequiresGitError,
  CoderStagingUnsupportedRepositoryError,
  CoderStagingWorktreeDirtyError,
} from "../domain/errors.js";
import type { ProjectId } from "../domain/project.js";
import type { SessionId } from "../domain/session.js";
import type { TaskId } from "../domain/task.js";
import {
  SpawnIsolatedGitRunner,
  type IsolatedGitRunner,
} from "../infrastructure/isolated-git-runner.js";

/**
 * Prepares an isolated staging workspace so a future CODER provider never
 * writes to the user's registered source workspace.
 *
 * ```text
 * real source repo
 *   -> immutable baseline snapshot (HEAD commit)
 *      -> isolated staging repo (no remotes)
 *         -> provider edits ONLY here
 *            -> deterministic change set
 *
 * REAL SOURCE REMAINS UNCHANGED
 * ```
 *
 * Phase 5A supports staging only for a clean Git worktree, and fails closed
 * otherwise. The real source is never stashed, reset, cleaned, committed to,
 * or written to in any way.
 */
export interface PreparedCoderWorkspace {
  /**
   * Absolute path to the isolated staging repository.
   *
   * Internal only: never persisted into a durable change set and never
   * exposed through MCP.
   */
  readonly stagingPath: string;
  /** Full canonical object id of the source HEAD at preparation time. */
  readonly baseCommit: string;
  readonly projectId: ProjectId;
  readonly taskId: TaskId;
  readonly sessionId: SessionId;
  /** Isolated HOME used for Synaphex's Git subprocesses. */
  readonly isolatedHome: string;
}

export interface CoderChangeSetCandidate {
  readonly projectId: ProjectId;
  readonly taskId: TaskId;
  readonly baseCommit: string;
  /** Raw patch bytes; empty when the staging workspace has no changes. */
  readonly patch: Buffer;
  readonly changedFiles: readonly ChangedFile[];
}

export interface ChangedFile {
  /** Repository-relative, verified not to escape the staging root. */
  readonly path: string;
  readonly change: "added" | "modified" | "deleted";
  readonly binary: boolean;
}

export interface CoderWorkspaceStagerOptions {
  readonly gitRunner?: IsolatedGitRunner;
  /** Root for temporary staging directories; defaults to the OS temp dir. */
  readonly temporaryRoot?: string;
}

export interface PrepareCoderWorkspaceInput {
  readonly projectId: ProjectId;
  readonly taskId: TaskId;
  readonly sessionId: SessionId;
  /** The registered project's real source path. Never modified. */
  readonly sourcePath: string;
}

const GITLINK_MODE = "160000";
const SYMLINK_MODE = "120000";

export class CoderWorkspaceStager {
  private readonly gitRunner: IsolatedGitRunner;
  private readonly temporaryRoot: string;

  constructor(options: CoderWorkspaceStagerOptions = {}) {
    this.gitRunner = options.gitRunner ?? new SpawnIsolatedGitRunner();
    this.temporaryRoot = options.temporaryRoot ?? tmpdir();
  }

  /**
   * Validates the source and creates the isolated staging repository.
   *
   * Preconditions, all checked BEFORE any staging directory is created, so a
   * rejected source leaves nothing behind:
   *  1. the source is a Git worktree (not bare), with HEAD on a real commit;
   *  2. the index contains no gitlink (submodule) entries;
   *  3. every tracked symlink stays inside the repository;
   *  4. the worktree is clean -- no staged, unstaged or untracked entries.
   *
   * Staging then uses a LOCAL-ONLY clone with `--no-local --no-hardlinks`, so
   * the staging repo gets its own object store rather than hardlinking or
   * alternating into the user's `.git`. All remotes are removed afterwards, so
   * the staging repo cannot reach the real source or any server.
   */
  async prepare(
    input: PrepareCoderWorkspaceInput,
  ): Promise<PreparedCoderWorkspace> {
    // A throwaway HOME for Synaphex's own Git subprocesses, created before any
    // Git command runs so no user global config can apply.
    const isolatedHome = await mkdtemp(
      join(this.temporaryRoot, "synaphex-git-home-"),
    );
    try {
      const baseCommit = await this.assertCleanGitSource(input, isolatedHome);
      const stagingPath = await this.createStagingClone(
        input,
        isolatedHome,
        baseCommit,
      );
      return {
        stagingPath,
        baseCommit,
        projectId: input.projectId,
        taskId: input.taskId,
        sessionId: input.sessionId,
        isolatedHome,
      };
    } catch (error) {
      await rm(isolatedHome, { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * Derives a deterministic change set from the staging workspace.
   *
   * The manifest and patch come from Git state in the STAGING repo, never from
   * provider-reported text. `git add -A` is run against the staging index
   * only; the user's real repository index is never touched.
   */
  async captureChanges(
    prepared: PreparedCoderWorkspace,
  ): Promise<CoderChangeSetCandidate> {
    // Stage everything in the STAGING repo so new and deleted files appear in
    // the diff. This mutates only the temporary clone's index.
    await this.git(prepared, ["add", "-A"], "staging index update");

    const status = await this.git(
      prepared,
      ["diff", "--cached", "--name-status", "-z", prepared.baseCommit],
      "change manifest",
    );
    const binaryNames = await this.binaryPaths(prepared);
    const changedFiles = parseNameStatus(status.stdout).map((entry) => ({
      ...entry,
      binary: binaryNames.has(entry.path),
    }));
    for (const file of changedFiles) {
      assertSafeRelativePath(file.path);
    }

    if (changedFiles.length === 0) {
      // No durable change-set state is created when nothing changed.
      return {
        projectId: prepared.projectId,
        taskId: prepared.taskId,
        baseCommit: prepared.baseCommit,
        patch: Buffer.alloc(0),
        changedFiles: [],
      };
    }

    const runner = this.gitRunner;
    if (!(runner instanceof SpawnIsolatedGitRunner)) {
      throw new CoderStagingFailedError("binary patch capture");
    }
    // --binary so binary file changes are representable; no commit is made.
    const patch = await runner.runBinary({
      args: [
        "diff",
        "--cached",
        "--binary",
        "--no-color",
        "--no-ext-diff",
        prepared.baseCommit,
      ],
      cwd: prepared.stagingPath,
      isolatedHome: prepared.isolatedHome,
    });
    if (patch.exitCode !== 0) {
      throw new CoderStagingFailedError("binary patch capture");
    }
    return {
      projectId: prepared.projectId,
      taskId: prepared.taskId,
      baseCommit: prepared.baseCommit,
      patch: patch.stdout,
      changedFiles,
    };
  }

  /**
   * Removes the staging workspace and its isolated HOME.
   *
   * Callers own this through `finally`, so no orphan temp directory survives a
   * normal error path. When a durable change set is being published, cleanup
   * must happen only after the patch bytes are safely persisted.
   */
  async dispose(prepared: PreparedCoderWorkspace): Promise<void> {
    await rm(prepared.stagingPath, { recursive: true, force: true });
    await rm(prepared.isolatedHome, { recursive: true, force: true });
  }

  private async assertCleanGitSource(
    input: PrepareCoderWorkspaceInput,
    isolatedHome: string,
  ): Promise<string> {
    const insideWorktree = await this.rawGit(
      ["rev-parse", "--is-inside-work-tree"],
      input.sourcePath,
      isolatedHome,
    );
    if (
      insideWorktree.exitCode !== 0 ||
      insideWorktree.stdout.trim() !== "true"
    ) {
      // Not a Git worktree, or bare. Synaphex never runs `git init` for the user.
      throw new CoderStagingRequiresGitError(input.projectId);
    }

    const head = await this.rawGit(
      ["rev-parse", "--verify", "HEAD^{commit}"],
      input.sourcePath,
      isolatedHome,
    );
    const baseCommit = head.stdout.trim();
    if (head.exitCode !== 0 || !/^[0-9a-f]{40,64}$/.test(baseCommit)) {
      // Unborn or detached-without-commit HEAD: no deterministic baseline.
      throw new CoderStagingUnsupportedRepositoryError(
        input.projectId,
        "detached_or_unborn_head",
      );
    }

    // Repository-shape checks run BEFORE the dirty check so an unsupported
    // structure reports its precise reason rather than surfacing as
    // "dirty" (an unchecked-out gitlink, for instance, also shows in status).
    await this.assertSupportedIndex(input, isolatedHome);

    // Clean means NO staged, unstaged or untracked entries. `--porcelain`
    // with untracked files included is the exact mechanism.
    const status = await this.rawGit(
      ["status", "--porcelain=v1", "--untracked-files=all", "-z"],
      input.sourcePath,
      isolatedHome,
    );
    if (status.exitCode !== 0) {
      throw new CoderStagingFailedError("source status inspection");
    }
    const entries = status.stdout.split("\0").filter((e) => e.length > 0);
    if (entries.length > 0) {
      throw new CoderStagingWorktreeDirtyError(
        input.projectId,
        entries.length,
      );
    }

    return baseCommit;
  }

  /** Rejects submodules and unsafe tracked symlinks. */
  private async assertSupportedIndex(
    input: PrepareCoderWorkspaceInput,
    isolatedHome: string,
  ): Promise<void> {
    const listed = await this.rawGit(
      ["ls-files", "-s", "-z"],
      input.sourcePath,
      isolatedHome,
    );
    if (listed.exitCode !== 0) {
      throw new CoderStagingFailedError("index inspection");
    }
    const symlinkPaths: string[] = [];
    for (const record of listed.stdout.split("\0")) {
      if (record.length === 0) {
        continue;
      }
      // "<mode> <oid> <stage>\t<path>"
      const tabIndex = record.indexOf("\t");
      if (tabIndex === -1) {
        continue;
      }
      const mode = record.slice(0, record.indexOf(" "));
      const path = record.slice(tabIndex + 1);
      if (mode === GITLINK_MODE) {
        // Submodule materialization can require external repositories and
        // network, and introduces a second source-authority boundary.
        throw new CoderStagingUnsupportedRepositoryError(
          input.projectId,
          "submodule_gitlink",
        );
      }
      if (mode === SYMLINK_MODE) {
        symlinkPaths.push(path);
      }
    }

    for (const path of symlinkPaths) {
      const target = await this.rawGit(
        ["cat-file", "blob", `HEAD:${path}`],
        input.sourcePath,
        isolatedHome,
      );
      if (target.exitCode !== 0) {
        throw new CoderStagingFailedError("symlink inspection");
      }
      if (!isInternalSymlink(path, target.stdout)) {
        // An absolute or escaping symlink would become a path out of the
        // staging root into arbitrary host files.
        throw new CoderStagingUnsupportedRepositoryError(
          input.projectId,
          "unsafe_symlink",
        );
      }
    }
  }

  private async createStagingClone(
    input: PrepareCoderWorkspaceInput,
    isolatedHome: string,
    baseCommit: string,
  ): Promise<string> {
    const stagingRoot = await mkdtemp(
      join(this.temporaryRoot, "synaphex-coder-staging-"),
    );
    // Restrictive permissions on the staging container.
    await mkdir(join(stagingRoot, "workspace"), { recursive: true, mode: 0o700 });
    const stagingPath = join(stagingRoot, "workspace");
    try {
      // Local path source only -- never a remote URL, so no network. The
      // clone is by path, and --no-local --no-hardlinks gives the staging repo
      // its own object store rather than hardlinking into the user's .git.
      const cloned = await this.rawGit(
        [
          "clone",
          "--quiet",
          "--no-local",
          "--no-hardlinks",
          "--no-checkout",
          "--origin",
          "synaphex-temp",
          resolve(input.sourcePath),
          stagingPath,
        ],
        this.temporaryRoot,
        isolatedHome,
      );
      if (cloned.exitCode !== 0) {
        throw new CoderStagingFailedError("staging clone");
      }
      // Check out the exact baseline commit, not a branch: branches move.
      const checkedOut = await this.rawGit(
        ["checkout", "--quiet", "--force", "--detach", baseCommit],
        stagingPath,
        isolatedHome,
      );
      if (checkedOut.exitCode !== 0) {
        throw new CoderStagingFailedError("staging checkout");
      }
      // Remove EVERY remote: the staging repo must not be able to reach the
      // real source path or any server, so `git push` has no destination.
      const remotes = await this.rawGit(
        ["remote"],
        stagingPath,
        isolatedHome,
      );
      for (const remote of remotes.stdout.split("\n").map((r) => r.trim())) {
        if (remote.length === 0) {
          continue;
        }
        await this.rawGit(
          ["remote", "remove", remote],
          stagingPath,
          isolatedHome,
        );
      }
      const remaining = await this.rawGit(
        ["remote"],
        stagingPath,
        isolatedHome,
      );
      if (remaining.stdout.trim().length > 0) {
        throw new CoderStagingFailedError("remote removal");
      }
      // The staging baseline must be exactly the captured source HEAD.
      const stagedHead = await this.rawGit(
        ["rev-parse", "--verify", "HEAD^{commit}"],
        stagingPath,
        isolatedHome,
      );
      if (stagedHead.stdout.trim() !== baseCommit) {
        throw new CoderStagingFailedError("baseline verification");
      }
      return stagingPath;
    } catch (error) {
      await rm(stagingRoot, { recursive: true, force: true });
      throw error;
    }
  }

  private async binaryPaths(
    prepared: PreparedCoderWorkspace,
  ): Promise<ReadonlySet<string>> {
    const numstat = await this.git(
      prepared,
      [
        "diff",
        "--cached",
        "--numstat",
        "-z",
        "--no-ext-diff",
        prepared.baseCommit,
      ],
      "binary detection",
    );
    const binary = new Set<string>();
    // `-z` numstat: "added\tdeleted\t\0path\0" for renames, else
    // "added\tdeleted\tpath\0". Binary files report "-" for both counts.
    const fields = numstat.stdout.split("\0");
    for (let index = 0; index < fields.length; index += 1) {
      const record = fields[index];
      if (record === undefined || record.length === 0) {
        continue;
      }
      const parts = record.split("\t");
      if (parts.length >= 3 && parts[0] === "-" && parts[1] === "-") {
        binary.add(parts[2]!);
      }
    }
    return binary;
  }

  private async git(
    prepared: PreparedCoderWorkspace,
    args: readonly string[],
    operation: string,
  ) {
    const result = await this.rawGit(
      args,
      prepared.stagingPath,
      prepared.isolatedHome,
    );
    if (result.exitCode !== 0) {
      throw new CoderStagingFailedError(operation);
    }
    return result;
  }

  private async rawGit(
    args: readonly string[],
    cwd: string,
    isolatedHome: string,
  ) {
    return this.gitRunner.run({ args, cwd, isolatedHome });
  }
}

/** A symlink is internal only when it stays inside the repository root. */
export function isInternalSymlink(
  linkPath: string,
  target: string,
): boolean {
  const trimmed = target.trim();
  if (trimmed.length === 0 || isAbsolute(trimmed) || trimmed.startsWith("~")) {
    return false;
  }
  const linkDirectory = normalize(join(linkPath, ".."));
  const resolved = normalize(join(linkDirectory, trimmed));
  return !(resolved === ".." || resolved.startsWith(`..${sep}`) || resolved.startsWith("../"));
}

/** Repository-relative, no absolute paths and no traversal. */
export function assertSafeRelativePath(path: string): void {
  if (
    path.length === 0 ||
    isAbsolute(path) ||
    path.includes("\0") ||
    path === ".." ||
    path.startsWith("../") ||
    path.startsWith(`..${sep}`) ||
    normalize(path).startsWith("..")
  ) {
    throw new CoderStagingFailedError("changed path validation");
  }
}

/** Parses `git diff --name-status -z` into a deterministic manifest. */
export function parseNameStatus(
  output: string,
): readonly { path: string; change: "added" | "modified" | "deleted" }[] {
  const fields = output.split("\0").filter((field) => field.length > 0);
  const entries: { path: string; change: "added" | "modified" | "deleted" }[] =
    [];
  for (let index = 0; index < fields.length; index += 1) {
    const status = fields[index]!;
    const code = status[0];
    if (code === "R" || code === "C") {
      // Rename/copy: source then destination. Represent as delete + add so the
      // manifest stays in the three documented categories.
      const from = fields[index + 1];
      const to = fields[index + 2];
      if (from !== undefined && to !== undefined) {
        entries.push({ path: from, change: "deleted" });
        entries.push({ path: to, change: "added" });
        index += 2;
      }
      continue;
    }
    const path = fields[index + 1];
    if (path === undefined) {
      continue;
    }
    index += 1;
    if (code === "A") {
      entries.push({ path, change: "added" });
    } else if (code === "D") {
      entries.push({ path, change: "deleted" });
    } else if (code === "M" || code === "T") {
      entries.push({ path, change: "modified" });
    }
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}
