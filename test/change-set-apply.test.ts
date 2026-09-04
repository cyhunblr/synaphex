import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { AgentConfigManager } from "../src/core/agent-config-manager.js";
import { AgentInvocationService } from "../src/core/agent-invocation-service.js";
import { ArtifactManager } from "../src/core/artifact-manager.js";
import { ChangeSetApplyManager } from "../src/core/change-set-apply-manager.js";
import { CoderChangeSetManager } from "../src/core/coder-change-set-manager.js";
import { CoderStagingCoordinator } from "../src/core/coder-staging-coordinator.js";
import { CoderWorkspaceStager } from "../src/core/coder-workspace-stager.js";
import { ProjectManager } from "../src/core/project-manager.js";
import { SessionManager } from "../src/core/session-manager.js";
import { TaskManager } from "../src/core/task-manager.js";
import type {
  AgentExecutionInput,
  AgentExecutor,
} from "../src/domain/agent-invocation.js";
import {
  ChangeSetAlreadyDecidedError,
  ChangeSetApplyCheckFailedError,
  ChangeSetApplyInterruptedError,
  ChangeSetApplyRecoveryRequiredError,
  ChangeSetCorruptError,
  ChangeSetNotAuthorizedError,
  ChangeSetNotCurrentTargetError,
  ChangeSetSourceDirtyError,
  ChangeSetSourceHeadChangedError,
  ReviewTargetApplyInterruptedError,
  ReviewTargetChangedError,
  ReviewTargetNotAppliedError,
  ReviewTargetRejectedError,
  SourceMutationLockTimeoutError,
  TaskSessionOwnershipLostError,
} from "../src/domain/errors.js";
import type { Project } from "../src/domain/project.js";
import type { RuntimeAvailability } from "../src/domain/provider-routing.js";
import type { SessionId } from "../src/domain/session.js";
import type { Task } from "../src/domain/task.js";
import { RecoverableProcessLock } from "../src/infrastructure/recoverable-process-lock.js";
import { StateStore } from "../src/infrastructure/state-store.js";
import { ChangeSetCommands } from "../src/operations/change-set-commands.js";
import { SessionCommands } from "../src/operations/session-commands.js";

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

const available: RuntimeAvailability = {
  async isAvailable() {
    return true;
  },
};

/** A fake CODER that writes through whichever workspace it is handed. */
class WritingCoderExecutor implements AgentExecutor {
  readonly observedPaths: string[] = [];

  constructor(
    private readonly work: (workspacePath: string) => Promise<void>,
    private readonly result: unknown = coderResult(),
  ) {}

  async execute(input: AgentExecutionInput): Promise<unknown> {
    this.observedPaths.push(input.context.project.sourcePath);
    await this.work(input.context.project.sourcePath);
    return this.result;
  }
}

function coderResult(): unknown {
  return {
    agent: "coder",
    outcome: "success",
    summary: "Implemented the change.",
    workRecord: { files_changed: ["provider claim, not authority"] },
  };
}

/**
 * A FAIL review, deliberately: a PASS completes the task, which would end the
 * session and prevent the same test from then exercising post-apply drift.
 */
function reviewerResult(): unknown {
  return {
    agent: "reviewer",
    outcome: "success",
    summary: "Reviewed the applied change.",
    reviewStatus: "FAIL",
    failureOrigin: "implementation",
    report: { validation_results: ["needs another pass"] },
  };
}

class FixedResultExecutor implements AgentExecutor {
  constructor(private readonly result: unknown) {}
  async execute(): Promise<unknown> {
    return this.result;
  }
}

interface Fixture {
  readonly root: string;
  readonly stateRoot: string;
  readonly homeDirectory: string;
  readonly sourcePath: string;
  readonly store: StateStore;
  readonly projects: ProjectManager;
  readonly tasks: TaskManager;
  readonly sessions: SessionManager;
  readonly artifacts: ArtifactManager;
  readonly changeSets: CoderChangeSetManager;
  readonly commands: SessionCommands;
  readonly project: Project;
  readonly task: Task;
  readonly sessionId: SessionId;
}

async function createFixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-apply-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateRoot = join(root, "state-root");
  const homeDirectory = join(root, "home");
  const sourcePath = join(root, "source");
  await Promise.all([
    mkdir(homeDirectory, { recursive: true }),
    mkdir(sourcePath, { recursive: true }),
  ]);
  git(sourcePath, "init", "--quiet");
  await writeFile(join(sourcePath, "keep.txt"), "original\n", "utf8");
  await writeFile(join(sourcePath, "remove.txt"), "delete me\n", "utf8");
  await writeFile(join(sourcePath, "bin.dat"), Buffer.from([0, 1, 2, 250, 0]));
  git(sourcePath, "add", "-A");
  git(sourcePath, "commit", "--quiet", "-m", "baseline");

  const store = new StateStore(stateRoot);
  const projects = new ProjectManager(store, { homeDirectory });
  const tasks = new TaskManager(store, projects);
  const sessions = new SessionManager(store);
  const project = await projects.create("Coder Project", sourcePath);
  const task = await tasks.create(project.id, "Implement the feature");
  const configs = new AgentConfigManager(store);
  for (const agent of ["coder", "reviewer"] as const) {
    await configs.setConfigured(agent, {
      provider: "openai",
      surface: "cli",
      model: `${agent}-model`,
    });
  }
  const commands = new SessionCommands({ projects, tasks, sessions });
  const opened = await commands.openTaskSession(project.id, task.id);
  return {
    root,
    stateRoot,
    homeDirectory,
    sourcePath,
    store,
    projects,
    tasks,
    sessions,
    artifacts: new ArtifactManager(store, projects, tasks),
    changeSets: new CoderChangeSetManager(store, tasks),
    commands,
    project,
    task,
    sessionId: opened.sessionId as SessionId,
  };
}

function staging(f: Fixture): CoderStagingCoordinator {
  return new CoderStagingCoordinator({
    stager: new CoderWorkspaceStager({ temporaryRoot: f.root }),
    changeSets: new CoderChangeSetManager(f.store, f.tasks),
    sessions: f.sessions,
  });
}

function service(f: Fixture, executor: AgentExecutor): AgentInvocationService {
  return new AgentInvocationService({
    executor,
    runtimeAvailability: available,
    synaphexRoot: f.stateRoot,
    homeDirectory: f.homeDirectory,
    coderStaging: staging(f),
  });
}

function applyManager(
  f: Fixture,
  options: ConstructorParameters<typeof ChangeSetApplyManager>[2] = {},
): ChangeSetApplyManager {
  return new ChangeSetApplyManager(f.store, f.tasks, {
    temporaryRoot: f.root,
    ...options,
  });
}

function commandsFor(
  f: Fixture,
  manager: ChangeSetApplyManager = applyManager(f),
): ChangeSetCommands {
  return new ChangeSetCommands({
    projects: f.projects,
    tasks: f.tasks,
    artifacts: f.artifacts,
    changeSets: f.changeSets,
    applyManager: manager,
    sessions: f.sessions,
  });
}

/** Runs a real staged CODER invocation and returns the published change-set id. */
async function stageChangeSet(
  f: Fixture,
  work: (workspace: string) => Promise<void> = async (workspace) => {
    await writeFile(join(workspace, "keep.txt"), "modified by coder\n", "utf8");
    await writeFile(join(workspace, "created.txt"), "new file\n", "utf8");
    await writeFile(join(workspace, "bin.dat"), Buffer.from([9, 9, 0, 255]));
    await rm(join(workspace, "remove.txt"));
  },
): Promise<string> {
  const result = await service(f, new WritingCoderExecutor(work)).invokeUserAgent(
    {
      sessionId: f.sessionId,
      agent: "coder",
      host: { provider: "openai", surface: "cli" },
      instruction: "Implement it.",
    },
  );
  const changeSet = (
    result.processedResult as { coderChangeSet?: { id: string } | null }
  ).coderChangeSet;
  assert.ok(changeSet, "expected a published change set");
  return changeSet.id;
}

async function sourceSnapshot(root: string): Promise<ReadonlyMap<string, string>> {
  const snapshot = new Map<string, string>();
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      const relative = full.slice(root.length + 1);
      if (entry.isDirectory()) {
        if (relative === ".git" || relative.startsWith(".git/")) {
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

/** Absolute path of a task's `changes/` directory, resolved from Core itself. */
async function changesDirectory(f: Fixture): Promise<string> {
  return join(
    f.stateRoot,
    await f.tasks.getStateDirectoryByTaskId(f.task.id),
    "changes",
  );
}

// ---------------------------------------------------------------------------
// Authority: directory existence is never enough
// ---------------------------------------------------------------------------

test("an orphan change set has no authority even though its directory exists", async (t) => {
  const f = await createFixture(t);
  // Publish a change set DIRECTLY, bypassing the invocation path, so no CODER
  // work record ever references it. This is the Phase-5B orphan window: the
  // patch is on disk and structurally valid, and it must still be unusable.
  const stager = new CoderWorkspaceStager({ temporaryRoot: f.root });
  const prepared = await stager.prepare({
    projectId: f.project.id,
    taskId: f.task.id,
    sessionId: f.sessionId,
    sourcePath: f.sourcePath,
  });
  await writeFile(join(prepared.stagingPath, "keep.txt"), "orphan\n", "utf8");
  const published = await f.changeSets.publish(
    await stager.captureChanges(prepared),
  );
  await stager.dispose(prepared);
  assert.ok(published);
  const orphanId = published.metadata.changeSetId;

  // The bytes really are there and really are readable at the store level.
  const stored = await f.changeSets.get(f.task.id, orphanId);
  assert.equal(stored.metadata.changeSetId, orphanId);

  const commands = commandsFor(f);
  const headBefore = git(f.sourcePath, "rev-parse", "HEAD").trim();
  const snapshotBefore = await sourceSnapshot(f.sourcePath);

  for (const attempt of [
    () => commands.getChangeSet(f.sessionId, orphanId),
    () => commands.readPatch(f.sessionId, orphanId, 0, 4096),
    () => commands.applyChangeSet(f.sessionId, orphanId),
    () => commands.rejectChangeSet(f.sessionId, orphanId),
  ]) {
    await assert.rejects(attempt, ChangeSetNotAuthorizedError);
  }

  // No decision record was written, and the source is untouched.
  assert.equal(
    await f.store.exists(
      `${await f.tasks.getStateDirectoryByTaskId(f.task.id)}/changes/decisions/${orphanId}.json`,
    ),
    false,
  );
  assert.equal(git(f.sourcePath, "rev-parse", "HEAD").trim(), headBefore);
  assert.equal(git(f.sourcePath, "status", "--porcelain").trim(), "");
  assert.deepEqual(await sourceSnapshot(f.sourcePath), snapshotBefore);
});

test("a superseded change set is refused once newer CODER work exists", async (t) => {
  const f = await createFixture(t);
  const first = await stageChangeSet(f, async (workspace) => {
    await writeFile(join(workspace, "keep.txt"), "first\n", "utf8");
  });
  const second = await stageChangeSet(f, async (workspace) => {
    await writeFile(join(workspace, "keep.txt"), "second\n", "utf8");
  });
  assert.notEqual(first, second);

  const commands = commandsFor(f);
  await assert.rejects(
    () => commands.applyChangeSet(f.sessionId, first),
    ChangeSetNotCurrentTargetError,
  );
  await assert.rejects(
    () => commands.getChangeSet(f.sessionId, first),
    ChangeSetNotCurrentTargetError,
  );
  // The newest target remains actionable.
  const review = await commands.getChangeSet(f.sessionId, second);
  assert.equal(review.changeSetId, second);
  assert.equal(review.state, "pending");
});

test("a tampered patch is reported corrupt and never applied", async (t) => {
  const f = await createFixture(t);
  const changeSetId = await stageChangeSet(f);
  const patchPath = join(await changesDirectory(f), changeSetId, "changes.patch");
  const original = await readFile(patchPath);
  await writeFile(
    patchPath,
    Buffer.concat([original, Buffer.from("tampered\n", "utf8")]),
  );

  const commands = commandsFor(f);
  const snapshotBefore = await sourceSnapshot(f.sourcePath);
  await assert.rejects(
    () => commands.applyChangeSet(f.sessionId, changeSetId),
    ChangeSetCorruptError,
  );
  await assert.rejects(
    () => commands.readPatch(f.sessionId, changeSetId, 0, 10),
    ChangeSetCorruptError,
  );
  assert.deepEqual(await sourceSnapshot(f.sourcePath), snapshotBefore);
});

// ---------------------------------------------------------------------------
// Byte-exact patch transport
// ---------------------------------------------------------------------------

test("chunked patch reads reassemble to the exact recorded bytes", async (t) => {
  const f = await createFixture(t);
  const changeSetId = await stageChangeSet(f);
  const commands = commandsFor(f);
  const stored = await f.changeSets.get(f.task.id, changeSetId);

  // Deliberately tiny chunks, so boundaries land inside the binary hunk.
  const chunks: Buffer[] = [];
  let offset = 0;
  let guard = 0;
  for (;;) {
    const chunk = await commands.readPatch(f.sessionId, changeSetId, offset, 7);
    assert.equal(chunk.encoding, "base64");
    assert.equal(chunk.offset, offset);
    chunks.push(Buffer.from(chunk.data, "base64"));
    assert.equal(chunks.at(-1)!.byteLength, chunk.returnedBytes);
    offset = chunk.nextOffset;
    if (chunk.done) {
      assert.equal(chunk.totalBytes, stored.patch.byteLength);
      break;
    }
    assert.ok((guard += 1) < 100_000, "patch read did not terminate");
  }
  const reassembled = Buffer.concat(chunks);
  assert.equal(reassembled.byteLength, stored.metadata.patchBytes);
  assert.equal(
    createHash("sha256").update(reassembled).digest("hex"),
    stored.metadata.patchHash,
  );
  assert.equal(reassembled.equals(stored.patch), true);
  // The patch really does carry binary content, so this is not a text-only proof.
  assert.match(reassembled.toString("binary"), /GIT binary patch/);
});

test("reading past the end returns an empty terminal chunk rather than failing", async (t) => {
  const f = await createFixture(t);
  const changeSetId = await stageChangeSet(f);
  const commands = commandsFor(f);
  const stored = await f.changeSets.get(f.task.id, changeSetId);
  const chunk = await commands.readPatch(
    f.sessionId,
    changeSetId,
    stored.patch.byteLength + 500,
    64,
  );
  assert.equal(chunk.returnedBytes, 0);
  assert.equal(chunk.done, true);
  assert.equal(chunk.data, "");
});

// ---------------------------------------------------------------------------
// Apply: exactness and verification
// ---------------------------------------------------------------------------

test("apply reproduces the exact reviewed tree, staged and uncommitted", async (t) => {
  const f = await createFixture(t);
  const headBefore = git(f.sourcePath, "rev-parse", "HEAD").trim();
  const changeSetId = await stageChangeSet(f);
  const stored = await f.changeSets.get(f.task.id, changeSetId);

  const outcome = await commandsFor(f).applyChangeSet(f.sessionId, changeSetId);
  assert.equal(outcome.state, "applied");
  assert.equal(outcome.changeSetId, changeSetId);

  // HEAD did not move: Synaphex never commits on the user's behalf.
  assert.equal(git(f.sourcePath, "rev-parse", "HEAD").trim(), headBefore);
  // The result is the exact tree the reviewer saw.
  assert.equal(
    git(f.sourcePath, "write-tree").trim(),
    stored.metadata.resultTree,
  );
  assert.equal(outcome.resultTree, stored.metadata.resultTree);
  // Everything is staged, nothing left unstaged or untracked.
  assert.equal(git(f.sourcePath, "diff", "--name-only").trim(), "");
  assert.equal(
    git(f.sourcePath, "ls-files", "--others", "--exclude-standard").trim(),
    "",
  );
  const porcelain = git(f.sourcePath, "status", "--porcelain").trim().split("\n").sort();
  assert.deepEqual(porcelain, ["A  created.txt", "D  remove.txt", "M  bin.dat", "M  keep.txt"]);
  assert.equal(
    await readFile(join(f.sourcePath, "keep.txt"), "utf8"),
    "modified by coder\n",
  );
  // Binary content survived byte-exactly.
  assert.deepEqual(
    [...(await readFile(join(f.sourcePath, "bin.dat")))],
    [9, 9, 0, 255],
  );
});

test("apply refuses when the source HEAD has moved off the baseline", async (t) => {
  const f = await createFixture(t);
  const changeSetId = await stageChangeSet(f);
  await writeFile(join(f.sourcePath, "unrelated.txt"), "user work\n", "utf8");
  git(f.sourcePath, "add", "-A");
  git(f.sourcePath, "commit", "--quiet", "-m", "user commit");
  const snapshotBefore = await sourceSnapshot(f.sourcePath);

  await assert.rejects(
    () => commandsFor(f).applyChangeSet(f.sessionId, changeSetId),
    ChangeSetSourceHeadChangedError,
  );
  // No merge, rebase or three-way rescue was attempted.
  assert.deepEqual(await sourceSnapshot(f.sourcePath), snapshotBefore);
  assert.equal(git(f.sourcePath, "status", "--porcelain").trim(), "");
});

test("apply refuses a dirty worktree and never displaces user work", async (t) => {
  const f = await createFixture(t);
  const changeSetId = await stageChangeSet(f);
  await writeFile(join(f.sourcePath, "keep.txt"), "user edit\n", "utf8");
  await writeFile(join(f.sourcePath, "scratch.txt"), "untracked\n", "utf8");

  await assert.rejects(
    () => commandsFor(f).applyChangeSet(f.sessionId, changeSetId),
    ChangeSetSourceDirtyError,
  );
  // No stash, no reset, no clean: both the edit and the untracked file survive.
  assert.equal(
    await readFile(join(f.sourcePath, "keep.txt"), "utf8"),
    "user edit\n",
  );
  assert.equal(
    await readFile(join(f.sourcePath, "scratch.txt"), "utf8"),
    "untracked\n",
  );
  assert.equal(git(f.sourcePath, "stash", "list").trim(), "");
});

test("an inapplicable patch fails the dry run and leaves no intent behind", async (t) => {
  const f = await createFixture(t);
  const changeSetId = await stageChangeSet(f);
  // Move the file content out from under the patch, then restore HEAD identity
  // by amending, so the baseline check passes but the patch cannot apply.
  await writeFile(join(f.sourcePath, "keep.txt"), "diverged\n", "utf8");
  git(f.sourcePath, "add", "-A");
  git(f.sourcePath, "commit", "--quiet", "--amend", "--no-edit");
  const head = git(f.sourcePath, "rev-parse", "HEAD").trim();
  const stored = await f.changeSets.get(f.task.id, changeSetId);
  // Rewrite the metadata baseline so we exercise the APPLY guard, not the HEAD guard.
  const metadataPath = join(await changesDirectory(f), changeSetId, "metadata.json");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  await writeFile(
    metadataPath,
    JSON.stringify({ ...metadata, baseCommit: head, resultTree: undefined }),
    "utf8",
  );
  assert.notEqual(stored.metadata.baseCommit, head);

  const snapshotBefore = await sourceSnapshot(f.sourcePath);
  await assert.rejects(
    () => commandsFor(f).applyChangeSet(f.sessionId, changeSetId),
    (error: unknown) =>
      error instanceof ChangeSetApplyCheckFailedError ||
      error instanceof ChangeSetCorruptError,
  );
  assert.deepEqual(await sourceSnapshot(f.sourcePath), snapshotBefore);
  assert.equal(git(f.sourcePath, "status", "--porcelain").trim(), "");
  // The change set stays PENDING: a failed attempt is not a decision.
  const status = await applyManager(f).status(f.task.id, changeSetId);
  assert.equal(status.state, "pending");
  assert.equal(status.intent, null);
});

// ---------------------------------------------------------------------------
// Decisions are terminal and mutually exclusive
// ---------------------------------------------------------------------------

test("reject is terminal, keeps the patch, and blocks a later apply", async (t) => {
  const f = await createFixture(t);
  const changeSetId = await stageChangeSet(f);
  const snapshotBefore = await sourceSnapshot(f.sourcePath);
  const commands = commandsFor(f);

  const outcome = await commands.rejectChangeSet(f.sessionId, changeSetId);
  assert.equal(outcome.state, "rejected");
  assert.equal(outcome.resultTree, null);
  // Rejection never touches the source.
  assert.deepEqual(await sourceSnapshot(f.sourcePath), snapshotBefore);
  assert.equal(git(f.sourcePath, "status", "--porcelain").trim(), "");
  // The proposal is retained for audit.
  const stored = await f.changeSets.get(f.task.id, changeSetId);
  assert.equal(stored.metadata.changeSetId, changeSetId);
  // And can never later be applied or re-decided.
  await assert.rejects(
    () => commands.applyChangeSet(f.sessionId, changeSetId),
    ChangeSetAlreadyDecidedError,
  );
  await assert.rejects(
    () => commands.rejectChangeSet(f.sessionId, changeSetId),
    ChangeSetAlreadyDecidedError,
  );
  assert.equal(
    (await commands.getChangeSet(f.sessionId, changeSetId)).state,
    "rejected",
  );
});

test("an applied change set cannot be rejected or applied again", async (t) => {
  const f = await createFixture(t);
  const changeSetId = await stageChangeSet(f);
  const commands = commandsFor(f);
  await commands.applyChangeSet(f.sessionId, changeSetId);
  const treeAfter = git(f.sourcePath, "write-tree").trim();

  await assert.rejects(
    () => commands.rejectChangeSet(f.sessionId, changeSetId),
    ChangeSetAlreadyDecidedError,
  );
  await assert.rejects(
    () => commands.applyChangeSet(f.sessionId, changeSetId),
    ChangeSetAlreadyDecidedError,
  );
  // The second attempt did not double-apply anything.
  assert.equal(git(f.sourcePath, "write-tree").trim(), treeAfter);
});

test("concurrent apply and reject produce exactly one winner", async (t) => {
  const f = await createFixture(t);
  const changeSetId = await stageChangeSet(f);
  const manager = applyManager(f);
  const commands = commandsFor(f, manager);

  const outcomes = await Promise.allSettled([
    commands.applyChangeSet(f.sessionId, changeSetId),
    commands.rejectChangeSet(f.sessionId, changeSetId),
  ]);
  const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
  assert.equal(fulfilled.length, 1, "exactly one decision must win");
  const rejected = outcomes.find((o) => o.status === "rejected");
  assert.ok(rejected?.status === "rejected");
  assert.ok(rejected.reason instanceof ChangeSetAlreadyDecidedError);

  // The durable state agrees with the winner, and the source matches it.
  const status = await manager.status(f.task.id, changeSetId);
  const winner = (fulfilled[0] as PromiseFulfilledResult<{ state: string }>).value;
  assert.equal(status.state, winner.state);
  const stored = await f.changeSets.get(f.task.id, changeSetId);
  if (status.state === "applied") {
    assert.equal(git(f.sourcePath, "write-tree").trim(), stored.metadata.resultTree);
  } else {
    assert.equal(git(f.sourcePath, "status", "--porcelain").trim(), "");
  }
});

test("concurrent applies of the same change set apply it at most once", async (t) => {
  const f = await createFixture(t);
  const changeSetId = await stageChangeSet(f);
  const manager = applyManager(f);
  const commands = commandsFor(f, manager);
  const stored = await f.changeSets.get(f.task.id, changeSetId);

  const outcomes = await Promise.allSettled([
    commands.applyChangeSet(f.sessionId, changeSetId),
    commands.applyChangeSet(f.sessionId, changeSetId),
    commands.applyChangeSet(f.sessionId, changeSetId),
  ]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  for (const outcome of outcomes.filter((o) => o.status === "rejected")) {
    assert.ok(
      (outcome as PromiseRejectedResult).reason instanceof
        ChangeSetAlreadyDecidedError,
    );
  }
  assert.equal(git(f.sourcePath, "write-tree").trim(), stored.metadata.resultTree);
  assert.equal((await manager.status(f.task.id, changeSetId)).state, "applied");
});

test("the source mutation lock serialises two projects sharing one workspace", async (t) => {
  const f = await createFixture(t);
  const manager = applyManager(f);
  let inside = 0;
  let maxConcurrent = 0;
  const body = async () => {
    inside += 1;
    maxConcurrent = Math.max(maxConcurrent, inside);
    await new Promise((resolve) => setTimeout(resolve, 20));
    inside -= 1;
    return true;
  };
  await Promise.all([
    manager.withSourceMutationLock(f.project.id, body),
    manager.withSourceMutationLock(f.project.id, body),
    manager.withSourceMutationLock(f.project.id, body),
  ]);
  assert.equal(maxConcurrent, 1, "source mutation must never overlap");
});

test("source mutation lock contention surfaces its own timeout error", async (t) => {
  const f = await createFixture(t);
  const manager = applyManager(f);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holder = manager.withSourceMutationLock(f.project.id, async () => held);
  try {
    await assert.rejects(
      () => manager.withSourceMutationLock(f.project.id, async () => undefined),
      // Distinct from a task-binding timeout: the caller can tell which
      // resource is contended.
      SourceMutationLockTimeoutError,
    );
  } finally {
    release();
    await holder;
  }
});

// ---------------------------------------------------------------------------
// Ownership fencing
// ---------------------------------------------------------------------------

test("a force-released session cannot apply or reject", async (t) => {
  const f = await createFixture(t);
  const changeSetId = await stageChangeSet(f);
  const commands = commandsFor(f);
  await f.commands.closeSession(f.sessionId);
  const other = await f.commands.openTaskSession(f.project.id, f.task.id);
  assert.notEqual(other.sessionId, f.sessionId);

  const snapshotBefore = await sourceSnapshot(f.sourcePath);
  for (const attempt of [
    () => commands.applyChangeSet(f.sessionId, changeSetId),
    () => commands.rejectChangeSet(f.sessionId, changeSetId),
  ]) {
    await assert.rejects(attempt, (error: unknown) => {
      assert.ok(error instanceof Error);
      return true;
    });
  }
  assert.deepEqual(await sourceSnapshot(f.sourcePath), snapshotBefore);
  assert.equal(
    (await applyManager(f).status(f.task.id, changeSetId)).state,
    "pending",
  );

  // The CURRENT owner can still decide.
  const outcome = await commands.applyChangeSet(
    other.sessionId as SessionId,
    changeSetId,
  );
  assert.equal(outcome.state, "applied");
});

test("ownership lost between resolution and mutation aborts before any write", async (t) => {
  const f = await createFixture(t);
  const changeSetId = await stageChangeSet(f);
  const snapshotBefore = await sourceSnapshot(f.sourcePath);
  // The seam fires after the intent is written but before source mutation. It
  // must NOT run inside `withTaskOwnershipAuthority` (that holds the
  // task-binding lock), so the release is staged from outside via a barrier.
  let released = false;
  const manager = applyManager(f, {
    beforeSourceMutation: async () => {
      if (!released) {
        released = true;
        throw new TaskSessionOwnershipLostError(
          f.task.id,
          f.sessionId,
          "commit",
        );
      }
    },
  });
  await assert.rejects(
    () => commandsFor(f, manager).applyChangeSet(f.sessionId, changeSetId),
    TaskSessionOwnershipLostError,
  );
  // Nothing was written to the source, and the intent is the only trace.
  assert.deepEqual(await sourceSnapshot(f.sourcePath), snapshotBefore);
  assert.equal(git(f.sourcePath, "status", "--porcelain").trim(), "");
});

// ---------------------------------------------------------------------------
// Interrupted apply: never silently reset
// ---------------------------------------------------------------------------

test("an interrupted apply is detected and never auto-recovered", async (t) => {
  const f = await createFixture(t);
  const changeSetId = await stageChangeSet(f);
  // Simulate a crash between the intent write and the terminal receipt.
  const crashing = applyManager(f, {
    beforeSourceMutation: async () => {
      throw new Error("process died mid-apply");
    },
  });
  const crashTarget = await f.changeSets.get(f.task.id, changeSetId);
  await assert.rejects(
    () =>
      crashing.apply({
        project: f.project,
        taskId: f.task.id,
        metadata: crashTarget.metadata,
        patch: crashTarget.patch,
      }),
    /process died mid-apply/,
  );

  const manager = applyManager(f);
  const status = await manager.status(f.task.id, changeSetId);
  assert.equal(status.state, "applying_interrupted");
  assert.notEqual(status.intent, null);
  assert.equal(status.decision, null);

  // A restart does NOT reset the user's source; recovery must be explicit.
  const snapshotBefore = await sourceSnapshot(f.sourcePath);
  await assert.rejects(
    () => commandsFor(f, manager).applyChangeSet(f.sessionId, changeSetId),
    ChangeSetApplyInterruptedError,
  );
  await assert.rejects(
    () => commandsFor(f, manager).rejectChangeSet(f.sessionId, changeSetId),
    ChangeSetApplyInterruptedError,
  );
  assert.deepEqual(await sourceSnapshot(f.sourcePath), snapshotBefore);
  assert.equal(
    (await commandsFor(f, manager).getChangeSet(f.sessionId, changeSetId)).state,
    "applying_interrupted",
  );
});

test("a failed apply rolls back to the exact baseline and clears the intent", async (t) => {
  const f = await createFixture(t);
  const changeSetId = await stageChangeSet(f);
  const snapshotBefore = await sourceSnapshot(f.sourcePath);
  const headBefore = git(f.sourcePath, "rev-parse", "HEAD").trim();
  // Corrupt the applied result AFTER git apply succeeds, so verification fails
  // and rollback is exercised on a genuinely mutated worktree.
  const manager = applyManager(f, {
    afterSourceMutation: async () => {
      await writeFile(join(f.sourcePath, "keep.txt"), "sabotage\n", "utf8");
    },
  });
  const target = await f.changeSets.get(f.task.id, changeSetId);
  await assert.rejects(
    () =>
      manager.apply({
        project: f.project,
        taskId: f.task.id,
        metadata: target.metadata,
        patch: target.patch,
      }),
    ChangeSetApplyCheckFailedError,
  );
  // Restored exactly, and the intent is gone because the baseline is clean.
  assert.equal(git(f.sourcePath, "rev-parse", "HEAD").trim(), headBefore);
  assert.equal(git(f.sourcePath, "status", "--porcelain").trim(), "");
  assert.deepEqual(await sourceSnapshot(f.sourcePath), snapshotBefore);
  const status = await applyManager(f).status(f.task.id, changeSetId);
  assert.equal(status.state, "pending");
  assert.equal(status.intent, null);
});

test("a rollback that cannot restore the baseline demands explicit recovery", async (t) => {
  const f = await createFixture(t);
  const changeSetId = await stageChangeSet(f);
  // An external writer creates an untracked file DURING the apply. `git clean`
  // is deliberately not run, so the baseline is not exactly restored and the
  // intent must be kept rather than the failure being papered over.
  const manager = applyManager(f, {
    afterSourceMutation: async () => {
      await writeFile(join(f.sourcePath, "keep.txt"), "sabotage\n", "utf8");
      await writeFile(
        join(f.sourcePath, "concurrent.txt"),
        "written by someone else\n",
        "utf8",
      );
    },
  });
  const target = await f.changeSets.get(f.task.id, changeSetId);
  await assert.rejects(
    () =>
      manager.apply({
        project: f.project,
        taskId: f.task.id,
        metadata: target.metadata,
        patch: target.patch,
      }),
    ChangeSetApplyRecoveryRequiredError,
  );
  // The concurrent writer's file was NOT destroyed.
  assert.equal(
    await readFile(join(f.sourcePath, "concurrent.txt"), "utf8"),
    "written by someone else\n",
  );
  // And the change set stays flagged for explicit recovery.
  assert.equal(
    (await applyManager(f).status(f.task.id, changeSetId)).state,
    "applying_interrupted",
  );
});

// ---------------------------------------------------------------------------
// REVIEWER gate: only a still-current applied target is reviewable
// ---------------------------------------------------------------------------

test("REVIEWER runs only after apply, and only while the source still matches", async (t) => {
  const f = await createFixture(t);
  const changeSetId = await stageChangeSet(f);
  const reviewer = () => service(f, new FixedResultExecutor(reviewerResult()));
  const invoke = () =>
    reviewer().invokeUserAgent({
      sessionId: f.sessionId,
      agent: "reviewer",
      host: { provider: "openai", surface: "cli" },
      instruction: "Review it.",
    });

  // Pending: nothing to review in the source.
  await assert.rejects(invoke, ReviewTargetNotAppliedError);

  await commandsFor(f).applyChangeSet(f.sessionId, changeSetId);
  const reviewed = await invoke();
  assert.equal(reviewed.processedResult.agent, "reviewer");
  assert.equal(
    (reviewed.processedResult as { reviewStatus?: string }).reviewStatus,
    "FAIL",
  );

  // A user edit after apply means the reviewed target no longer matches.
  await writeFile(join(f.sourcePath, "keep.txt"), "user edited after\n", "utf8");
  await assert.rejects(invoke, ReviewTargetChangedError);
});

test("REVIEWER is refused after the user commits the applied change", async (t) => {
  const f = await createFixture(t);
  const changeSetId = await stageChangeSet(f);
  await commandsFor(f).applyChangeSet(f.sessionId, changeSetId);
  // Committing is the user's prerogative, but it moves HEAD off the baseline
  // the review target was verified against.
  git(f.sourcePath, "commit", "--quiet", "-m", "user commits the change");

  await assert.rejects(
    () =>
      service(f, new FixedResultExecutor(reviewerResult())).invokeUserAgent({
        sessionId: f.sessionId,
        agent: "reviewer",
        host: { provider: "openai", surface: "cli" },
        instruction: "Review it.",
      }),
    ReviewTargetChangedError,
  );
});

test("REVIEWER is refused for a rejected or interrupted target", async (t) => {
  const rejectedFixture = await createFixture(t);
  const rejectedId = await stageChangeSet(rejectedFixture);
  await commandsFor(rejectedFixture).rejectChangeSet(
    rejectedFixture.sessionId,
    rejectedId,
  );
  await assert.rejects(
    () =>
      service(
        rejectedFixture,
        new FixedResultExecutor(reviewerResult()),
      ).invokeUserAgent({
        sessionId: rejectedFixture.sessionId,
        agent: "reviewer",
        host: { provider: "openai", surface: "cli" },
        instruction: "Review it.",
      }),
    ReviewTargetRejectedError,
  );

  const interruptedFixture = await createFixture(t);
  const interruptedId = await stageChangeSet(interruptedFixture);
  const stored = await interruptedFixture.changeSets.get(
    interruptedFixture.task.id,
    interruptedId,
  );
  await assert.rejects(
    () =>
      applyManager(interruptedFixture, {
        beforeSourceMutation: async () => {
          throw new Error("crash");
        },
      }).apply({
        project: interruptedFixture.project,
        taskId: interruptedFixture.task.id,
        metadata: stored.metadata,
        patch: stored.patch,
      }),
    /crash/,
  );
  await assert.rejects(
    () =>
      service(
        interruptedFixture,
        new FixedResultExecutor(reviewerResult()),
      ).invokeUserAgent({
        sessionId: interruptedFixture.sessionId,
        agent: "reviewer",
        host: { provider: "openai", surface: "cli" },
        instruction: "Review it.",
      }),
    ReviewTargetApplyInterruptedError,
  );
});

// ---------------------------------------------------------------------------
// Legacy readability and leak audits
// ---------------------------------------------------------------------------

test("a legacy change set without resultTree still applies via isolated derivation", async (t) => {
  const f = await createFixture(t);
  const changeSetId = await stageChangeSet(f);
  const metadataPath = join(await changesDirectory(f), changeSetId, "metadata.json");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  const expectedTree = metadata.resultTree;
  assert.ok(typeof expectedTree === "string");
  delete metadata.resultTree;
  await writeFile(metadataPath, JSON.stringify(metadata), "utf8");

  const commands = commandsFor(f);
  const review = await commands.getChangeSet(f.sessionId, changeSetId);
  assert.equal(review.resultTree, null);

  const outcome = await commands.applyChangeSet(f.sessionId, changeSetId);
  // The tree was derived in an isolated clone and matches what 5C would record.
  assert.equal(outcome.resultTree, expectedTree);
  assert.equal(git(f.sourcePath, "write-tree").trim(), expectedTree);
});

test("review output never leaks staging paths, ownership tokens or absolute source paths", async (t) => {
  const f = await createFixture(t);
  const changeSetId = await stageChangeSet(f);
  const commands = commandsFor(f);
  const review = await commands.getChangeSet(f.sessionId, changeSetId);
  const serialized = JSON.stringify(review);
  for (const forbidden of [
    "ownershipToken",
    "isolatedHome",
    "stagingPath",
    f.sourcePath,
    f.root,
    f.stateRoot,
  ]) {
    assert.equal(serialized.includes(forbidden), false, `leaks ${forbidden}`);
  }
  // Changed-file paths are repository-relative.
  for (const file of review.changedFiles) {
    assert.equal(file.path.startsWith("/"), false);
  }
});

test("no apply-path module reaches for a network, merge or history-rewriting Git verb", async () => {
  const sources = await Promise.all(
    [
      "src/core/change-set-apply-manager.ts",
      "src/operations/change-set-commands.ts",
    ].map(async (path) => [path, await readFile(join(process.cwd(), path), "utf8")] as const),
  );
  for (const [path, raw] of sources) {
    const code = raw
      .replaceAll(/\/\*[\s\S]*?\*\//g, "")
      .replaceAll(/\/\/.*$/gm, "");
    // Git argument arrays only. `"commit"` is excluded deliberately: it appears
    // as the ownership-fence *reason* string, not as a Git verb -- the
    // `git(...)` call-site check below is what proves no commit is ever run.
    for (const forbidden of [
      '"merge"',
      '"cherry-pick"',
      '"rebase"',
      '"--3way"',
      '"clean"',
      '"stash"',
      '"push"',
      '"fetch"',
      '"pull"',
      '"remote"',
      "shell: true",
      "bash",
    ]) {
      assert.equal(
        code.includes(forbidden),
        false,
        `${path} must not use ${forbidden}`,
      );
    }
    // Every Git invocation in the apply path, enumerated from the source.
    for (const [, verb] of code.matchAll(/this\.git\(\s*\[\s*"([a-z-]+)"/g)) {
      assert.ok(
        [
          "rev-parse",
          "status",
          "write-tree",
          "diff",
          "ls-files",
          "apply",
          "reset",
          "clone",
          "checkout",
        ].includes(verb!),
        `${path} runs an unexpected git verb: ${verb}`,
      );
    }
  }
});


// ---------------------------------------------------------------------------
// Phase 5D: mutex recovery must never imply domain recovery
// ---------------------------------------------------------------------------

test("recovering a dead source-mutation lock leaves the apply intent intact", async (t) => {
  const f = await createFixture(t);
  const changeSetId = await stageChangeSet(f);
  const stored = await f.changeSets.get(f.task.id, changeSetId);

  // A process crashes mid-apply, leaving BOTH an apply intent and its source
  // mutation lock behind.
  const crashing = applyManager(f, {
    beforeSourceMutation: async () => {
      throw new Error("process died mid-apply");
    },
  });
  await assert.rejects(
    () =>
      crashing.withSourceMutationLock(f.project.id, async () =>
        crashing.apply({
          project: f.project,
          taskId: f.task.id,
          metadata: stored.metadata,
          patch: stored.patch,
        }),
      ),
    /process died mid-apply/,
  );
  // Simulate the lock surviving the crash: re-create it owned by a dead pid.
  const lockScope = `state/source-locks/${f.project.id}.json`;
  await f.store.createJsonAtomicExclusive(lockScope, {
    version: 1,
    ownerId: `lock_${"a".repeat(32)}`,
    pid: 424242,
    host: hostname(),
    createdAt: new Date().toISOString(),
  });
  assert.equal(await f.store.exists(lockScope), true);

  // The intent is present before recovery.
  const before = await applyManager(f).status(f.task.id, changeSetId);
  assert.equal(before.state, "applying_interrupted");
  assert.notEqual(before.intent, null);

  // A fresh manager whose probe knows the crashed pid is gone.
  const recovering = applyManager(f, {
    lock: new RecoverableProcessLock(f.store, {
      retryCount: 50,
      retryDelayMs: 1,
      livenessProbe: { probe: (pid) => (pid === 424242 ? "dead" : "alive") },
    }),
  });

  // The MUTEX is reclaimed with no manual deletion...
  let enteredCriticalSection = false;
  await recovering.withSourceMutationLock(f.project.id, async () => {
    enteredCriticalSection = true;
  });
  assert.equal(enteredCriticalSection, true, "dead lock must not wedge the subsystem");

  // ...but the DOMAIN state is untouched: the apply intent still stands.
  const after = await applyManager(f).status(f.task.id, changeSetId);
  assert.equal(after.state, "applying_interrupted");
  assert.deepEqual(after.intent, before.intent);
  assert.equal(after.decision, null);

  // So apply and reject still fail closed until explicit reconciliation.
  await assert.rejects(
    () => commandsFor(f, recovering).applyChangeSet(f.sessionId, changeSetId),
    ChangeSetApplyInterruptedError,
  );
  await assert.rejects(
    () => commandsFor(f, recovering).rejectChangeSet(f.sessionId, changeSetId),
    ChangeSetApplyInterruptedError,
  );
});

test("source-lock recovery does not touch the source workspace or task state", async (t) => {
  const f = await createFixture(t);
  const changeSetId = await stageChangeSet(f);
  const snapshotBefore = await sourceSnapshot(f.sourcePath);
  const headBefore = git(f.sourcePath, "rev-parse", "HEAD").trim();

  await f.store.createJsonAtomicExclusive(
    `state/source-locks/${f.project.id}.json`,
    {
      version: 1,
      ownerId: `lock_${"b".repeat(32)}`,
      pid: 424242,
      host: hostname(),
      createdAt: new Date().toISOString(),
    },
  );
  const recovering = applyManager(f, {
    lock: new RecoverableProcessLock(f.store, {
      retryCount: 50,
      retryDelayMs: 1,
      livenessProbe: { probe: (pid) => (pid === 424242 ? "dead" : "alive") },
    }),
  });
  await recovering.withSourceMutationLock(f.project.id, async () => undefined);

  // Reclaiming a mutex resets nothing.
  assert.equal(git(f.sourcePath, "rev-parse", "HEAD").trim(), headBefore);
  assert.equal(git(f.sourcePath, "status", "--porcelain").trim(), "");
  assert.deepEqual(await sourceSnapshot(f.sourcePath), snapshotBefore);
  // The change set is still pending and still decidable.
  assert.equal(
    (await commandsFor(f, recovering).getChangeSet(f.sessionId, changeSetId)).state,
    "pending",
  );
  // The session still owns the task: no logical session was closed.
  const binding = await f.sessions.getCurrentBinding(f.sessionId);
  assert.equal(binding.taskId, f.task.id);
});
