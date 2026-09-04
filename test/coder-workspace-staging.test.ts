import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { CoderChangeSetManager } from "../src/core/coder-change-set-manager.js";
import {
  CoderWorkspaceStager,
  assertSafeRelativePath,
  isInternalSymlink,
  parseNameStatus,
} from "../src/core/coder-workspace-stager.js";
import { ProjectManager } from "../src/core/project-manager.js";
import { TaskManager } from "../src/core/task-manager.js";
import {
  ChangeSetCorruptError,
  CoderStagingRequiresGitError,
  CoderStagingUnsupportedRepositoryError,
  CoderStagingWorktreeDirtyError,
} from "../src/domain/errors.js";
import type { Project } from "../src/domain/project.js";
import type { SessionId } from "../src/domain/session.js";
import type { Task } from "../src/domain/task.js";
import { StateStore } from "../src/infrastructure/state-store.js";

/** Deterministic local git for FIXTURE setup only (never the code under test). */
function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: cwd,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@localhost",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@localhost",
      LC_ALL: "C",
    },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

interface Fixture {
  readonly root: string;
  readonly store: StateStore;
  readonly projects: ProjectManager;
  readonly tasks: TaskManager;
  readonly stager: CoderWorkspaceStager;
  readonly changeSets: CoderChangeSetManager;
  readonly sourcePath: string;
  readonly sessionId: SessionId;
}

async function baseFixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-staging-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const homeDirectory = join(root, "home");
  const sourcePath = join(root, "source");
  await Promise.all([
    mkdir(homeDirectory, { recursive: true }),
    mkdir(sourcePath, { recursive: true }),
  ]);
  const store = new StateStore(join(root, "state-root"));
  const projects = new ProjectManager(store, { homeDirectory });
  const tasks = new TaskManager(store, projects);
  return {
    root,
    store,
    projects,
    tasks,
    stager: new CoderWorkspaceStager({ temporaryRoot: root }),
    changeSets: new CoderChangeSetManager(store, tasks),
    sourcePath,
    sessionId: "ses_00000000000000000000000000000001",
  };
}

/** A clean git source with a text file, a binary file and a nested file. */
async function cleanGitFixture(
  t: TestContext,
): Promise<Fixture & { project: Project; task: Task }> {
  const f = await baseFixture(t);
  git(f.sourcePath, "init", "--quiet");
  await writeFile(join(f.sourcePath, "keep.txt"), "original\n", "utf8");
  await writeFile(join(f.sourcePath, "remove.txt"), "delete me\n", "utf8");
  await mkdir(join(f.sourcePath, "nested"), { recursive: true });
  await writeFile(
    join(f.sourcePath, "nested", "image.bin"),
    Buffer.from([0, 1, 2, 250, 251, 0, 3]),
  );
  git(f.sourcePath, "add", "-A");
  git(f.sourcePath, "commit", "--quiet", "-m", "initial");
  const project = await f.projects.create("Staging Project", f.sourcePath);
  const task = await f.tasks.create(project.id, "Implement the change");
  return { ...f, project, task };
}

async function directorySnapshot(
  root: string,
): Promise<ReadonlyMap<string, string>> {
  const snapshot = new Map<string, string>();
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      const relative = full.slice(root.length + 1);
      if (entry.isDirectory()) {
        if (relative === ".git" || relative.startsWith(`.git/`)) {
          continue;
        }
        stack.push(full);
        continue;
      }
      snapshot.set(
        relative,
        createHash("sha256").update(await readFile(full)).digest("hex"),
      );
    }
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("symlink safety classifies absolute and escaping targets as unsafe", () => {
  assert.equal(isInternalSymlink("link", "target.txt"), true);
  assert.equal(isInternalSymlink("dir/link", "../other.txt"), true);
  assert.equal(isInternalSymlink("dir/link", "sub/other.txt"), true);
  // Unsafe: absolute, home-relative, or escaping the repository root.
  assert.equal(isInternalSymlink("link", "/etc/passwd"), false);
  assert.equal(isInternalSymlink("link", "~/.ssh/id_rsa"), false);
  assert.equal(isInternalSymlink("link", "../outside.txt"), false);
  assert.equal(isInternalSymlink("dir/link", "../../outside.txt"), false);
  assert.equal(isInternalSymlink("link", ""), false);
});

test("changed paths must be repository-relative with no traversal", () => {
  for (const safe of ["a.txt", "dir/a.txt", "dir/sub/a.txt"]) {
    assert.doesNotThrow(() => assertSafeRelativePath(safe));
  }
  for (const unsafe of ["/etc/passwd", "../escape", "..", "a\0b"]) {
    assert.throws(() => assertSafeRelativePath(unsafe));
  }
});

test("the manifest parser derives added, modified and deleted entries", () => {
  const parsed = parseNameStatus(
    ["M", "keep.txt", "A", "new.txt", "D", "gone.txt"].join("\0") + "\0",
  );
  assert.deepEqual(parsed, [
    { path: "gone.txt", change: "deleted" },
    { path: "keep.txt", change: "modified" },
    { path: "new.txt", change: "added" },
  ]);
});

// ---------------------------------------------------------------------------
// Unsupported source cases -- all fail closed BEFORE staging
// ---------------------------------------------------------------------------

test("a non-Git source is refused and Git is never initialised for the user", async (t) => {
  const f = await baseFixture(t);
  await writeFile(join(f.sourcePath, "file.txt"), "plain\n", "utf8");
  const project = await f.projects.create("Plain", f.sourcePath);
  const task = await f.tasks.create(project.id, "Task");
  await assert.rejects(
    f.stager.prepare({
      projectId: project.id,
      taskId: task.id,
      sessionId: f.sessionId,
      sourcePath: f.sourcePath,
    }),
    (error: unknown) =>
      error instanceof CoderStagingRequiresGitError &&
      error.code === "CODER_STAGING_REQUIRES_GIT",
  );
  // No .git was created on the user's behalf.
  assert.equal((await readdir(f.sourcePath)).includes(".git"), false);
});

test("a dirty worktree is refused for every kind of dirtiness", async (t) => {
  const cases: readonly [string, (path: string) => Promise<void>][] = [
    [
      "unstaged modification",
      async (path) => {
        await writeFile(join(path, "keep.txt"), "modified\n", "utf8");
      },
    ],
    [
      "untracked file",
      async (path) => {
        await writeFile(join(path, "untracked.txt"), "new\n", "utf8");
      },
    ],
  ];
  for (const [label, dirty] of cases) {
    const f = await cleanGitFixture(t);
    await dirty(f.sourcePath);
    const before = await directorySnapshot(f.sourcePath);
    const headBefore = git(f.sourcePath, "rev-parse", "HEAD").trim();

    await assert.rejects(
      f.stager.prepare({
        projectId: f.project.id,
        taskId: f.task.id,
        sessionId: f.sessionId,
        sourcePath: f.sourcePath,
      }),
      (error: unknown) =>
        error instanceof CoderStagingWorktreeDirtyError &&
        error.code === "CODER_STAGING_WORKTREE_DIRTY",
      label,
    );

    // The user's work is never stashed, reset, cleaned or committed.
    assert.deepEqual(await directorySnapshot(f.sourcePath), before, label);
    assert.equal(git(f.sourcePath, "rev-parse", "HEAD").trim(), headBefore);
  }
});

test("a staged-only modification is also refused", async (t) => {
  const f = await cleanGitFixture(t);
  await writeFile(join(f.sourcePath, "keep.txt"), "staged\n", "utf8");
  git(f.sourcePath, "add", "keep.txt");
  const before = await directorySnapshot(f.sourcePath);
  await assert.rejects(
    f.stager.prepare({
      projectId: f.project.id,
      taskId: f.task.id,
      sessionId: f.sessionId,
      sourcePath: f.sourcePath,
    }),
    (error: unknown) => error instanceof CoderStagingWorktreeDirtyError,
  );
  assert.deepEqual(await directorySnapshot(f.sourcePath), before);
  // Still staged: Synaphex did not reset the index.
  assert.match(git(f.sourcePath, "status", "--porcelain"), /^M/m);
});

test("a repository containing a submodule gitlink is refused without fetching", async (t) => {
  const f = await cleanGitFixture(t);
  // Build a second repo and add it as a gitlink WITHOUT any network.
  const innerPath = join(f.root, "inner");
  await mkdir(innerPath, { recursive: true });
  git(innerPath, "init", "--quiet");
  await writeFile(join(innerPath, "inner.txt"), "inner\n", "utf8");
  git(innerPath, "add", "-A");
  git(innerPath, "commit", "--quiet", "-m", "inner");
  const innerCommit = git(innerPath, "rev-parse", "HEAD").trim();
  // Insert a gitlink index entry directly, avoiding `submodule add` network paths.
  const result = spawnSync(
    "git",
    ["update-index", "--add", "--cacheinfo", `160000,${innerCommit},vendor/inner`],
    {
      cwd: f.sourcePath,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: f.sourcePath,
        GIT_CONFIG_NOSYSTEM: "1",
        LC_ALL: "C",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  git(f.sourcePath, "commit", "--quiet", "-m", "add gitlink");

  await assert.rejects(
    f.stager.prepare({
      projectId: f.project.id,
      taskId: f.task.id,
      sessionId: f.sessionId,
      sourcePath: f.sourcePath,
    }),
    (error: unknown) =>
      error instanceof CoderStagingUnsupportedRepositoryError &&
      error.details?.reason === "submodule_gitlink",
  );
});

test("tracked unsafe symlinks are refused", async (t) => {
  for (const [label, target] of [
    ["absolute", "/etc/passwd"],
    ["escaping", "../../outside.txt"],
  ] as const) {
    const f = await cleanGitFixture(t);
    await symlink(target, join(f.sourcePath, "danger.link"));
    git(f.sourcePath, "add", "-A");
    git(f.sourcePath, "commit", "--quiet", "-m", `add ${label} symlink`);

    await assert.rejects(
      f.stager.prepare({
        projectId: f.project.id,
        taskId: f.task.id,
        sessionId: f.sessionId,
        sourcePath: f.sourcePath,
      }),
      (error: unknown) =>
        error instanceof CoderStagingUnsupportedRepositoryError &&
        error.details?.reason === "unsafe_symlink",
      label,
    );
  }
});

test("an internal relative symlink is supported and stays internal", async (t) => {
  const f = await cleanGitFixture(t);
  await symlink("keep.txt", join(f.sourcePath, "alias.link"));
  git(f.sourcePath, "add", "-A");
  git(f.sourcePath, "commit", "--quiet", "-m", "internal symlink");

  const prepared = await f.stager.prepare({
    projectId: f.project.id,
    taskId: f.task.id,
    sessionId: f.sessionId,
    sourcePath: f.sourcePath,
  });
  try {
    const staged = await readFile(
      join(prepared.stagingPath, "alias.link"),
      "utf8",
    );
    // Resolves inside staging to the staged copy, not the real source.
    assert.equal(staged, "original\n");
  } finally {
    await f.stager.dispose(prepared);
  }
});

// ---------------------------------------------------------------------------
// Staging isolation
// ---------------------------------------------------------------------------

test("staging has no remotes and its baseline is the exact source HEAD", async (t) => {
  const f = await cleanGitFixture(t);
  // Give the real repo remotes that must NOT survive into staging.
  git(f.sourcePath, "remote", "add", "origin", "https://example.invalid/x.git");
  git(f.sourcePath, "remote", "add", "upstream", f.sourcePath);
  const headBefore = git(f.sourcePath, "rev-parse", "HEAD").trim();

  const prepared = await f.stager.prepare({
    projectId: f.project.id,
    taskId: f.task.id,
    sessionId: f.sessionId,
    sourcePath: f.sourcePath,
  });
  try {
    assert.equal(prepared.baseCommit, headBefore);
    // Full canonical object id, never abbreviated.
    assert.match(prepared.baseCommit, /^[0-9a-f]{40,64}$/);
    assert.equal(
      git(prepared.stagingPath, "rev-parse", "HEAD").trim(),
      headBefore,
    );
    // No remote survives: the provider cannot push anywhere.
    assert.equal(git(prepared.stagingPath, "remote").trim(), "");
    // The real source path is not embedded in staging git config.
    const config = await readFile(
      join(prepared.stagingPath, ".git", "config"),
      "utf8",
    );
    assert.equal(config.includes(f.sourcePath), false);
    // No shared object store with the real repository.
    assert.equal(
      (await readdir(join(prepared.stagingPath, ".git", "objects"))).includes(
        "info",
      ) &&
        (
          await readdir(join(prepared.stagingPath, ".git", "objects", "info"))
        ).includes("alternates"),
      false,
    );
    // Staging lives outside the source workspace.
    assert.equal(prepared.stagingPath.startsWith(f.sourcePath), false);
  } finally {
    await f.stager.dispose(prepared);
  }
});

test("Synaphex staging runs no repository hook", async (t) => {
  const f = await cleanGitFixture(t);
  const evidence = join(f.root, "hook-ran.txt");
  const hooksDirectory = join(f.sourcePath, ".git", "hooks");
  await mkdir(hooksDirectory, { recursive: true });
  for (const hook of ["post-checkout", "pre-commit", "post-index-change"]) {
    await writeFile(
      join(hooksDirectory, hook),
      `#!/bin/sh\necho ran > ${evidence}\n`,
      { encoding: "utf8", mode: 0o755 },
    );
  }

  const prepared = await f.stager.prepare({
    projectId: f.project.id,
    taskId: f.task.id,
    sessionId: f.sessionId,
    sourcePath: f.sourcePath,
  });
  try {
    await writeFile(join(prepared.stagingPath, "keep.txt"), "changed\n", "utf8");
    await f.stager.captureChanges(prepared);
    // No hook executed as a side effect of any Synaphex command.
    await assert.rejects(readFile(evidence, "utf8"));
  } finally {
    await f.stager.dispose(prepared);
  }
});

test("staging and its isolated home are removed on dispose", async (t) => {
  const f = await cleanGitFixture(t);
  const prepared = await f.stager.prepare({
    projectId: f.project.id,
    taskId: f.task.id,
    sessionId: f.sessionId,
    sourcePath: f.sourcePath,
  });
  await f.stager.dispose(prepared);
  await assert.rejects(readdir(prepared.stagingPath));
  await assert.rejects(readdir(prepared.isolatedHome));
});

test("a rejected source leaves no temporary directory behind", async (t) => {
  const f = await cleanGitFixture(t);
  await writeFile(join(f.sourcePath, "dirty.txt"), "x\n", "utf8");
  const before = await readdir(f.root);
  await assert.rejects(
    f.stager.prepare({
      projectId: f.project.id,
      taskId: f.task.id,
      sessionId: f.sessionId,
      sourcePath: f.sourcePath,
    }),
  );
  const after = await readdir(f.root);
  assert.deepEqual(
    after.filter((n) => n.startsWith("synaphex-")),
    before.filter((n) => n.startsWith("synaphex-")),
    "no orphan temp directory",
  );
});

// ---------------------------------------------------------------------------
// THE critical test: the real source is never modified
// ---------------------------------------------------------------------------

test("provider-style edits in staging leave the real source byte-identical", async (t) => {
  const f = await cleanGitFixture(t);
  const headBefore = git(f.sourcePath, "rev-parse", "HEAD").trim();
  const statusBefore = git(f.sourcePath, "status", "--porcelain");
  const snapshotBefore = await directorySnapshot(f.sourcePath);
  assert.equal(statusBefore.trim(), "", "fixture must start clean");

  const prepared = await f.stager.prepare({
    projectId: f.project.id,
    taskId: f.task.id,
    sessionId: f.sessionId,
    sourcePath: f.sourcePath,
  });
  let published;
  try {
    // Edits happen ONLY in staging: modify, add, delete, and change a binary.
    await writeFile(
      join(prepared.stagingPath, "keep.txt"),
      "modified by coder\n",
      "utf8",
    );
    await writeFile(
      join(prepared.stagingPath, "created.txt"),
      "brand new\n",
      "utf8",
    );
    await rm(join(prepared.stagingPath, "remove.txt"));
    await writeFile(
      join(prepared.stagingPath, "nested", "image.bin"),
      Buffer.from([9, 9, 9, 0, 254, 7]),
    );

    const candidate = await f.stager.captureChanges(prepared);
    assert.ok(candidate.patch.byteLength > 0);
    const changes = new Map(
      candidate.changedFiles.map((file) => [file.path, file]),
    );
    assert.equal(changes.get("keep.txt")?.change, "modified");
    assert.equal(changes.get("created.txt")?.change, "added");
    assert.equal(changes.get("remove.txt")?.change, "deleted");
    assert.equal(changes.get("nested/image.bin")?.change, "modified");
    assert.equal(changes.get("nested/image.bin")?.binary, true);
    assert.equal(changes.get("keep.txt")?.binary, false);
    // Every path is repository-relative.
    for (const file of candidate.changedFiles) {
      assert.doesNotThrow(() => assertSafeRelativePath(file.path));
    }
    // Patch must be published before staging cleanup.
    published = await f.changeSets.publish(candidate);
    assert.notEqual(published, null);
  } finally {
    await f.stager.dispose(prepared);
  }

  // THE assertion: the real source is untouched in every respect.
  assert.equal(git(f.sourcePath, "rev-parse", "HEAD").trim(), headBefore);
  assert.equal(git(f.sourcePath, "status", "--porcelain").trim(), "");
  assert.deepEqual(await directorySnapshot(f.sourcePath), snapshotBefore);
  const sourceEntries = await readdir(f.sourcePath);
  assert.equal(sourceEntries.includes("created.txt"), false);
  assert.equal(sourceEntries.includes("remove.txt"), true);
  assert.equal(
    sourceEntries.some((name) => name.startsWith(".synaphex")),
    false,
  );
  assert.equal(
    await readFile(join(f.sourcePath, "keep.txt"), "utf8"),
    "original\n",
  );

  // The published change set describes only the staging edits.
  const stored = await f.changeSets.get(f.task.id, published!.metadata.changeSetId);
  assert.equal(stored.metadata.baseCommit, headBefore);
  assert.equal(stored.metadata.changedFiles.length, 4);
  const patchText = stored.patch.toString("utf8");
  assert.match(patchText, /created\.txt/);
  assert.match(patchText, /GIT binary patch|literal /);
});

// ---------------------------------------------------------------------------
// Change-set durability and integrity
// ---------------------------------------------------------------------------

async function publishTwice(
  f: Awaited<ReturnType<typeof cleanGitFixture>>,
): Promise<readonly [string, string]> {
  const ids: string[] = [];
  for (let round = 0; round < 2; round += 1) {
    const prepared = await f.stager.prepare({
      projectId: f.project.id,
      taskId: f.task.id,
      sessionId: f.sessionId,
      sourcePath: f.sourcePath,
    });
    try {
      // Byte-identical change both times.
      await writeFile(
        join(prepared.stagingPath, "keep.txt"),
        "identical change\n",
        "utf8",
      );
      const candidate = await f.stager.captureChanges(prepared);
      const published = await f.changeSets.publish(candidate);
      ids.push(published!.metadata.changeSetId);
    } finally {
      await f.stager.dispose(prepared);
    }
  }
  return [ids[0]!, ids[1]!];
}

test("two captures of identical content get different change-set ids", async (t) => {
  const f = await cleanGitFixture(t);
  const [first, second] = await publishTwice(f);
  assert.notEqual(first, second);
  const [a, b] = await Promise.all([
    f.changeSets.get(f.task.id, first),
    f.changeSets.get(f.task.id, second),
  ]);
  // Identical patch bytes, distinct identities.
  assert.equal(a.metadata.patchHash, b.metadata.patchHash);
  assert.notEqual(a.metadata.changeSetId, b.metadata.changeSetId);
  assert.deepEqual((await f.changeSets.list(f.task.id)).length, 2);
});

test("a change-set id is opaque and derived from nothing identifying", async (t) => {
  const f = await cleanGitFixture(t);
  const [id] = await publishTwice(f);
  const stored = await f.changeSets.get(f.task.id, id);
  for (const forbidden of [
    f.sessionId,
    stored.metadata.baseCommit,
    stored.metadata.patchHash,
    f.task.id.replace("task_", ""),
  ]) {
    assert.equal(id.includes(forbidden), false, `id leaks ${forbidden}`);
  }
});

test("metadata records the patch hash and never leaks internal state", async (t) => {
  const f = await cleanGitFixture(t);
  const [id] = await publishTwice(f);
  const stored = await f.changeSets.get(f.task.id, id);
  assert.equal(
    stored.metadata.patchHash,
    createHash("sha256").update(stored.patch).digest("hex"),
  );
  assert.equal(stored.metadata.patchBytes, stored.patch.byteLength);
  const serialized = JSON.stringify(stored.metadata);
  for (const forbidden of [
    "ownershipToken",
    "staging",
    "isolatedHome",
    "/tmp/synaphex-staging",
    "stagingPath",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `leaks ${forbidden}`);
  }
  // The real source path is not embedded in change-set metadata.
  assert.equal(serialized.includes(f.sourcePath), false);
});

test("a tampered patch is reported corrupt rather than returned", async (t) => {
  const f = await cleanGitFixture(t);
  const [id] = await publishTwice(f);
  const taskDirectory = await f.tasks.getStateDirectoryByTaskId(f.task.id);
  await f.store.writeText(
    `${taskDirectory}/changes/${id}/changes.patch`,
    "tampered content\n",
  );
  await assert.rejects(
    f.changeSets.get(f.task.id, id),
    (error: unknown) =>
      error instanceof ChangeSetCorruptError &&
      error.code === "CHANGE_SET_CORRUPT",
  );
});

test("a published change set cannot be overwritten in place", async (t) => {
  const f = await cleanGitFixture(t);
  const [id] = await publishTwice(f);
  const taskDirectory = await f.tasks.getStateDirectoryByTaskId(f.task.id);
  // Exclusive creation means re-publishing into the same directory fails.
  assert.equal(
    await f.store.createTextExclusive(
      `${taskDirectory}/changes/${id}/changes.patch`,
      "attempted overwrite",
    ),
    false,
  );
  assert.equal(
    await f.store.createJsonExclusive(
      `${taskDirectory}/changes/${id}/metadata.json`,
      { version: 1 },
    ),
    false,
  );
  // The original remains valid.
  const stored = await f.changeSets.get(f.task.id, id);
  assert.equal(stored.metadata.changeSetId, id);
});

test("an empty capture publishes no durable change-set state", async (t) => {
  const f = await cleanGitFixture(t);
  const prepared = await f.stager.prepare({
    projectId: f.project.id,
    taskId: f.task.id,
    sessionId: f.sessionId,
    sourcePath: f.sourcePath,
  });
  try {
    // No edits at all.
    const candidate = await f.stager.captureChanges(prepared);
    assert.deepEqual(candidate.changedFiles, []);
    assert.equal(candidate.patch.byteLength, 0);
    // No fake non-empty patch, and no change-set directory.
    assert.equal(await f.changeSets.publish(candidate), null);
    assert.deepEqual(await f.changeSets.list(f.task.id), []);
  } finally {
    await f.stager.dispose(prepared);
  }
});

test("change sets live in task state, never in the source workspace", async (t) => {
  const f = await cleanGitFixture(t);
  const [id] = await publishTwice(f);
  const taskDirectory = await f.tasks.getStateDirectoryByTaskId(f.task.id);
  assert.equal(
    await f.store.exists(`${taskDirectory}/changes/${id}/metadata.json`),
    true,
  );
  // Nothing generated inside the user's repository.
  const sourceEntries = await readdir(f.sourcePath);
  assert.equal(sourceEntries.includes("changes"), false);
  assert.equal(
    sourceEntries.some((name) => name.startsWith(".synaphex")),
    false,
  );
});

// ---------------------------------------------------------------------------
// Isolation and scope audits
// ---------------------------------------------------------------------------

test("Synaphex Git commands never use a shell and never reach the network", async () => {
  const source = await readFile(
    join(process.cwd(), "src", "infrastructure", "isolated-git-runner.ts"),
    "utf8",
  );
  assert.ok(source.includes("shell: false"));
  // Check actual invocation, not the comment that documents the prohibition.
  const code = source
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/\/\/.*$/gm, "");
  for (const forbidden of [
    'spawn("bash"',
    'spawn("sh"',
    "shell: true",
    "/bin/sh",
    "execSync",
  ]) {
    assert.equal(code.includes(forbidden), false, `must not use ${forbidden}`);
  }
  // git is the only executable spawned.
  const spawnTargets = [...code.matchAll(/spawn\(\s*"([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual([...new Set(spawnTargets)], ["git"]);
  // Isolation controls that must be present.
  for (const required of [
    "GIT_CONFIG_NOSYSTEM",
    "core.hooksPath",
    "core.fsmonitor=",
    "diff.external=",
    "credential.helper=",
    "GIT_TERMINAL_PROMPT",
    "submodule.recurse=false",
  ]) {
    assert.ok(source.includes(required), `missing isolation: ${required}`);
  }

  // The stager never performs a network or remote-URL operation.
  const stager = await readFile(
    join(process.cwd(), "src", "core", "coder-workspace-stager.ts"),
    "utf8",
  );
  for (const forbidden of [
    '"fetch"',
    '"pull"',
    '"push"',
    '"submodule"',
    "https://",
    "git@",
    "--recurse-submodules",
  ]) {
    assert.equal(stager.includes(forbidden), false, `must not use ${forbidden}`);
  }
  // Local-only clone with its own object store.
  assert.ok(stager.includes("--no-local"));
  assert.ok(stager.includes("--no-hardlinks"));
});

test("no apply, merge or commit-to-real-source capability exists", async () => {
  for (const file of [
    join(process.cwd(), "src", "core", "coder-workspace-stager.ts"),
    join(process.cwd(), "src", "core", "coder-change-set-manager.ts"),
  ]) {
    const source = await readFile(file, "utf8");
    for (const forbidden of [
      "applyChangeSet",
      '"apply"',
      '"am"',
      '"cherry-pick"',
      '"merge"',
      '"rebase"',
      '"stash"',
      '"reset"',
      '"clean"',
      '"commit"',
    ]) {
      assert.equal(
        source.includes(forbidden),
        false,
        `${file} must not perform ${forbidden}`,
      );
    }
  }
});

test("staging internals stay internal, and only the sanctioned change-set tools exist", async () => {
  const { SYNAPHEX_MCP_TOOLS, MCP_DIRECT_INVOCABLE_AGENTS } = await import(
    "../src/index.js"
  );
  assert.equal(SYNAPHEX_MCP_TOOLS.length, 29);
  // Phase 5B: direct CODER is enabled because every path is staged.
  assert.equal(
    (MCP_DIRECT_INVOCABLE_AGENTS as readonly string[]).includes("coder"),
    true,
  );
  // Phase 5C exposes review and decisions over the CHANGE SET only. There is
  // still no tool that hands out staging paths, commits, pushes, merges, or
  // arbitrary bytes from the source workspace.
  for (const present of [
    "synaphex_get_change_set",
    "synaphex_read_change_set_patch",
    "synaphex_apply_change_set",
    "synaphex_reject_change_set",
  ]) {
    assert.equal(
      (SYNAPHEX_MCP_TOOLS as readonly string[]).includes(present),
      true,
      `${present} must be registered`,
    );
  }
  for (const absent of [
    "synaphex_invoke_coder",
    "synaphex_commit_change_set",
    "synaphex_push_change_set",
    "synaphex_merge_change_set",
    "synaphex_get_staging_workspace",
    "synaphex_read_source_file",
  ]) {
    assert.equal(
      (SYNAPHEX_MCP_TOOLS as readonly string[]).includes(absent),
      false,
      `${absent} must not exist`,
    );
  }
  // No MCP HANDLER module references the staging or change-set foundation --
  // stdio-main.ts is the composition root and is allowed to construct them.
  const mcpDirectory = join(process.cwd(), "src", "mcp");
  const { readdir: readDir } = await import("node:fs/promises");
  for (const name of (await readDir(mcpDirectory)).filter(
    (n) => n.endsWith(".ts") && n !== "stdio-main.ts",
  )) {
    const source = await readFile(join(mcpDirectory, name), "utf8");
    for (const forbidden of [
      "CoderWorkspaceStager",
      "CoderChangeSetManager",
      "stagingPath",
      "isolatedHome",
    ]) {
      assert.equal(
        source.includes(forbidden),
        false,
        `${name} must not reference ${forbidden}`,
      );
    }
  }
  // Even the composition root never leaks a staging path or isolated HOME.
  const main = await readFile(join(mcpDirectory, "stdio-main.ts"), "utf8");
  for (const forbidden of ["CoderWorkspaceStager", "stagingPath", "isolatedHome"]) {
    assert.equal(main.includes(forbidden), false, `stdio-main leaks ${forbidden}`);
  }
});
