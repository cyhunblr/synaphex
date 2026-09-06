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
import { AgentConfigManager } from "../src/core/agent-config-manager.js";
import { AgentInvocationService } from "../src/core/agent-invocation-service.js";
import { ArtifactManager } from "../src/core/artifact-manager.js";
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
  AgentExecutionFailedError,
  CoderStagingRequiresGitError,
  CoderStagingUnsupportedRepositoryError,
  CoderStagingWorktreeDirtyError,
  ReviewTargetNotAppliedError,
  TaskSessionOwnershipLostError,
} from "../src/domain/errors.js";
import type { Project } from "../src/domain/project.js";
import type { RuntimeAvailability } from "../src/domain/provider-routing.js";
import type { Task } from "../src/domain/task.js";
import { StateStore } from "../src/infrastructure/state-store.js";
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

/** A fake CODER that actually writes through the execution path it receives. */
class WritingCoderExecutor implements AgentExecutor {
  readonly calls: AgentExecutionInput[] = [];
  readonly observedPaths: string[] = [];

  constructor(
    private readonly work: (workspacePath: string) => Promise<void>,
    private readonly result: unknown = coderResult(),
  ) {}

  async execute(input: AgentExecutionInput): Promise<unknown> {
    this.calls.push(input);
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
    workRecord: { files_changed: ["reported by provider"] },
  };
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
  readonly sessionId: string;
}

async function createFixture(
  t: TestContext,
  options: { readonly git?: boolean } = {},
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-staged-coder-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateRoot = join(root, "state-root");
  const homeDirectory = join(root, "home");
  const sourcePath = join(root, "source");
  await Promise.all([
    mkdir(homeDirectory, { recursive: true }),
    mkdir(sourcePath, { recursive: true }),
  ]);
  if (options.git !== false) {
    git(sourcePath, "init", "--quiet");
    await writeFile(join(sourcePath, "keep.txt"), "original\n", "utf8");
    await writeFile(join(sourcePath, "remove.txt"), "delete me\n", "utf8");
    git(sourcePath, "add", "-A");
    git(sourcePath, "commit", "--quiet", "-m", "baseline");
  }
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
      model: "gpt-5.6-sol",
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
    sessionId: opened.sessionId,
  };
}

function service(
  f: Fixture,
  executor: AgentExecutor,
  staging?: CoderStagingCoordinator,
): AgentInvocationService {
  return new AgentInvocationService({
    executor,
    runtimeAvailability: available,
    synaphexRoot: f.stateRoot,
    homeDirectory: f.homeDirectory,
    ...(staging === undefined ? {} : { coderStaging: staging }),
  });
}

function stagingWith(
  f: Fixture,
  overrides: Partial<{
    /**
     * Deterministic seam fired AFTER the change set is captured but BEFORE the
     * publish authority lock is taken -- the real post-capture window. It must
     * not run inside `withTaskOwnershipAuthority`, which already holds the
     * task-binding lock (doing so would self-deadlock, which is exactly the
     * interleaving the guard exists to prevent).
     */
    afterCapture: () => Promise<void>;
  }> = {},
): CoderStagingCoordinator {
  const stager = new CoderWorkspaceStager({ temporaryRoot: f.root });
  const wrappedStager = {
    prepare: stager.prepare.bind(stager),
    dispose: stager.dispose.bind(stager),
    inspectStagedTree: stager.inspectStagedTree.bind(stager),
    captureChanges: async (
      prepared: Parameters<typeof stager.captureChanges>[0],
    ) => {
      const candidate = await stager.captureChanges(prepared);
      if (overrides.afterCapture !== undefined) {
        await overrides.afterCapture();
      }
      return candidate;
    },
  };
  return new CoderStagingCoordinator({
    stager: wrappedStager as never,
    changeSets: new CoderChangeSetManager(f.store, f.tasks),
    sessions: f.sessions,
  });
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

// ---------------------------------------------------------------------------
// THE integration proof: staged execution, real source untouched
// ---------------------------------------------------------------------------

test("a staged CODER invocation edits staging only and leaves the real source untouched", async (t) => {
  const f = await createFixture(t);
  const headBefore = git(f.sourcePath, "rev-parse", "HEAD").trim();
  const snapshotBefore = await sourceSnapshot(f.sourcePath);

  const executor = new WritingCoderExecutor(async (workspace) => {
    await writeFile(join(workspace, "keep.txt"), "modified by coder\n", "utf8");
    await writeFile(join(workspace, "created.txt"), "new file\n", "utf8");
    await rm(join(workspace, "remove.txt"));
  });

  const result = await service(f, executor, stagingWith(f)).invokeUserAgent({
    sessionId: f.sessionId,
    agent: "coder",
    host: { provider: "openai" },
    instruction: "Implement it.",
  });

  // The provider's workspace was the staging clone, not the registered source.
  assert.equal(executor.observedPaths.length, 1);
  assert.notEqual(executor.observedPaths[0], f.sourcePath);
  assert.equal(executor.observedPaths[0]!.startsWith(f.sourcePath), false);

  // The real source is untouched on every axis.
  assert.equal(git(f.sourcePath, "rev-parse", "HEAD").trim(), headBefore);
  assert.equal(git(f.sourcePath, "status", "--porcelain").trim(), "");
  assert.deepEqual(await sourceSnapshot(f.sourcePath), snapshotBefore);
  const sourceEntries = await readdir(f.sourcePath);
  assert.equal(sourceEntries.includes("created.txt"), false);
  assert.equal(sourceEntries.includes("remove.txt"), true);
  assert.equal(
    await readFile(join(f.sourcePath, "keep.txt"), "utf8"),
    "original\n",
  );

  // An immutable change set was published, derived from Git state.
  const changeSet = (
    result.processedResult as { coderChangeSet?: { id: string } | null }
  ).coderChangeSet;
  assert.notEqual(changeSet, null);
  assert.notEqual(changeSet, undefined);
  const stored = await f.changeSets.get(f.task.id, changeSet!.id);
  assert.equal(stored.metadata.baseCommit, headBefore);
  const paths = stored.metadata.changedFiles.map((file) => file.path).sort();
  assert.deepEqual(paths, ["created.txt", "keep.txt", "remove.txt"]);
  // Synaphex derived the manifest; the provider's own claim is ignored.
  assert.equal(paths.includes("reported by provider"), false);

  // The CODER work record links the authoritative change set.
  const records = await f.artifacts.listCoderWorkRecords({
    kind: "task",
    projectId: f.project.id,
    taskId: f.task.id,
  });
  assert.equal(records.length, 1);
  assert.equal(records[0]?.changeSet?.id, changeSet!.id);
  assert.equal(records[0]?.changeSet?.patchHash, stored.metadata.patchHash);
  // Provider payload is preserved separately and holds no change-set authority.
  assert.deepEqual(records[0]?.payload, {
    files_changed: ["reported by provider"],
  });

  // No staging temp directory survives.
  const leftovers = (await readdir(f.root)).filter((name) =>
    name.startsWith("synaphex-coder-staging-"),
  );
  assert.deepEqual(leftovers, []);
});

test("the real source path is structurally absent from the CODER provider context", async (t) => {
  const f = await createFixture(t);
  const executor = new WritingCoderExecutor(async (workspace) => {
    await writeFile(join(workspace, "keep.txt"), "changed\n", "utf8");
  });
  await service(f, executor, stagingWith(f)).invokeUserAgent({
    sessionId: f.sessionId,
    agent: "coder",
    host: { provider: "openai" },
    instruction: "Implement it.",
  });
  const delivered = executor.calls[0]!;
  // The structural project source field is the staging workspace.
  assert.equal(
    delivered.context.project.sourcePath,
    executor.observedPaths[0],
  );
  assert.notEqual(delivered.context.project.sourcePath, f.sourcePath);
  // Nothing in the structured context discloses the real source path.
  assert.equal(
    JSON.stringify({
      project: delivered.context.project,
      task: delivered.context.task,
      route: delivered.route,
      executionPolicy: delivered.executionPolicy,
    }).includes(f.sourcePath),
    false,
  );
  // CODER keeps workspace_write; it now applies to staging.
  assert.equal(delivered.executionPolicy.sourceModification, "workspace_write");
});

test("the persisted project source path is never rewritten", async (t) => {
  const f = await createFixture(t);
  const executor = new WritingCoderExecutor(async (workspace) => {
    await writeFile(join(workspace, "keep.txt"), "changed\n", "utf8");
  });
  await service(f, executor, stagingWith(f)).invokeUserAgent({
    sessionId: f.sessionId,
    agent: "coder",
    host: { provider: "openai" },
    instruction: "Implement it.",
  });
  const project = await f.projects.get(f.project.id);
  assert.equal(project.sourcePath, f.project.sourcePath);
});

// ---------------------------------------------------------------------------
// Precondition failures happen before the provider
// ---------------------------------------------------------------------------

test("a non-Git or dirty source blocks CODER before the provider runs", async (t) => {
  const nonGit = await createFixture(t, { git: false });
  const executorA = new WritingCoderExecutor(async () => {
    throw new Error("provider must not run");
  });
  await assert.rejects(
    service(nonGit, executorA, stagingWith(nonGit)).invokeUserAgent({
      sessionId: nonGit.sessionId,
      agent: "coder",
      host: { provider: "openai" },
    }),
    (error: unknown) => error instanceof CoderStagingRequiresGitError,
  );
  assert.equal(executorA.calls.length, 0);

  const dirty = await createFixture(t);
  await writeFile(join(dirty.sourcePath, "keep.txt"), "dirty\n", "utf8");
  const snapshotBefore = await sourceSnapshot(dirty.sourcePath);
  const executorB = new WritingCoderExecutor(async () => {
    throw new Error("provider must not run");
  });
  await assert.rejects(
    service(dirty, executorB, stagingWith(dirty)).invokeUserAgent({
      sessionId: dirty.sessionId,
      agent: "coder",
      host: { provider: "openai" },
    }),
    (error: unknown) => error instanceof CoderStagingWorktreeDirtyError,
  );
  assert.equal(executorB.calls.length, 0);
  // The user's dirty work is untouched.
  assert.deepEqual(await sourceSnapshot(dirty.sourcePath), snapshotBefore);
});

// ---------------------------------------------------------------------------
// Post-provider repository safety
// ---------------------------------------------------------------------------

async function assertUnsafeOutputRejected(
  t: TestContext,
  label: string,
  work: (workspace: string) => Promise<void>,
  expectedReason: string,
): Promise<void> {
  const f = await createFixture(t);
  const snapshotBefore = await sourceSnapshot(f.sourcePath);
  const executor = new WritingCoderExecutor(work);
  await assert.rejects(
    service(f, executor, stagingWith(f)).invokeUserAgent({
      sessionId: f.sessionId,
      agent: "coder",
      host: { provider: "openai" },
    }),
    (error: unknown) =>
      error instanceof CoderStagingUnsupportedRepositoryError &&
      error.details?.reason === expectedReason,
    label,
  );
  // The provider DID run, but its unsafe output was rejected.
  assert.equal(executor.calls.length, 1, label);
  // Nothing durable was written and the real source is untouched.
  assert.deepEqual(await f.changeSets.list(f.task.id), [], label);
  assert.deepEqual(
    await f.artifacts.listCoderWorkRecords({
      kind: "task",
      projectId: f.project.id,
      taskId: f.task.id,
    }),
    [],
    label,
  );
  assert.deepEqual(await sourceSnapshot(f.sourcePath), snapshotBefore, label);
}

test("a provider-created absolute symlink is rejected after execution", async (t) => {
  await assertUnsafeOutputRejected(
    t,
    "absolute symlink",
    async (workspace) => {
      await symlink("/etc/passwd", join(workspace, "danger.link"));
    },
    "unsafe_symlink",
  );
});

test("a provider-created escaping symlink is rejected after execution", async (t) => {
  await assertUnsafeOutputRejected(
    t,
    "escaping symlink",
    async (workspace) => {
      await mkdir(join(workspace, "nested"), { recursive: true });
      await symlink("../../outside.txt", join(workspace, "nested", "escape.link"));
    },
    "unsafe_symlink",
  );
});

test("a provider-created nested Git repository is rejected as a gitlink", async (t) => {
  await assertUnsafeOutputRejected(
    t,
    "nested repository",
    async (workspace) => {
      const nested = join(workspace, "vendor", "inner");
      await mkdir(nested, { recursive: true });
      git(nested, "init", "--quiet");
      await writeFile(join(nested, "inner.txt"), "inner\n", "utf8");
      git(nested, "add", "-A");
      git(nested, "commit", "--quiet", "-m", "inner");
    },
    "submodule_gitlink",
  );
});

test("a provider re-adding a remote is rejected after execution", async (t) => {
  await assertUnsafeOutputRejected(
    t,
    "remote re-added",
    async (workspace) => {
      await writeFile(join(workspace, "keep.txt"), "changed\n", "utf8");
      git(workspace, "remote", "add", "origin", "https://example.invalid/x.git");
    },
    "provider_added_remote",
  );
});

test("provider Git manipulation cannot redefine the authoritative baseline", async (t) => {
  const f = await createFixture(t);
  const baseline = git(f.sourcePath, "rev-parse", "HEAD").trim();
  const executor = new WritingCoderExecutor(async (workspace) => {
    // The provider commits its own work and moves HEAD.
    await writeFile(join(workspace, "keep.txt"), "provider commit\n", "utf8");
    git(workspace, "add", "-A");
    git(workspace, "commit", "--quiet", "-m", "provider commit");
    // Then makes a further uncommitted edit.
    await writeFile(join(workspace, "extra.txt"), "extra\n", "utf8");
  });

  const result = await service(f, executor, stagingWith(f)).invokeUserAgent({
    sessionId: f.sessionId,
    agent: "coder",
    host: { provider: "openai" },
  });
  const changeSet = (
    result.processedResult as { coderChangeSet?: { id: string } | null }
  ).coderChangeSet;
  const stored = await f.changeSets.get(f.task.id, changeSet!.id);

  // The baseline remains the ORIGINAL source HEAD, not the provider's commit.
  assert.equal(stored.metadata.baseCommit, baseline);
  // And the patch spans baseline -> final staged state, covering both the
  // committed and uncommitted provider edits.
  const paths = stored.metadata.changedFiles.map((file) => file.path).sort();
  assert.deepEqual(paths, ["extra.txt", "keep.txt"]);
});

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

test("ownership loss before the provider blocks execution and publishes nothing", async (t) => {
  const f = await createFixture(t);
  const executor = new WritingCoderExecutor(async () => {
    throw new Error("provider must not run");
  });
  // Revoke the claim while leaving the binding, so the scope still resolves.
  const staging = stagingWith(f);
  await f.store.removeFile(`state/task-bindings/${f.task.id}.json`);
  await assert.rejects(
    service(f, executor, staging).invokeUserAgent({
      sessionId: f.sessionId,
      agent: "coder",
      host: { provider: "openai" },
    }),
    (error: unknown) => error instanceof TaskSessionOwnershipLostError,
  );
  assert.equal(executor.calls.length, 0);
  assert.deepEqual(await f.changeSets.list(f.task.id), []);
});

test("force release during provider execution prevents publication", async (t) => {
  const f = await createFixture(t);
  const snapshotBefore = await sourceSnapshot(f.sourcePath);
  let releaseProvider!: () => void;
  const providerBlocked = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });
  let providerStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    providerStarted = resolve;
  });

  const executor = new WritingCoderExecutor(async (workspace) => {
    await writeFile(join(workspace, "keep.txt"), "staged edit\n", "utf8");
    providerStarted();
    await providerBlocked;
  });

  const pending = service(f, executor, stagingWith(f)).invokeUserAgent({
    sessionId: f.sessionId,
    agent: "coder",
    host: { provider: "openai" },
  });

  // No sleeps: the barrier proves the provider is mid-flight.
  await started;
  await f.commands.forceReleaseTaskSession(f.project.id, f.task.id);
  const newOwner = await f.commands.openTaskSession(f.project.id, f.task.id);
  releaseProvider();

  await assert.rejects(
    pending,
    (error: unknown) => error instanceof TaskSessionOwnershipLostError,
  );
  // Nothing durable, and the replacement owner is intact.
  assert.deepEqual(await f.changeSets.list(f.task.id), []);
  assert.deepEqual(
    await f.artifacts.listCoderWorkRecords({
      kind: "task",
      projectId: f.project.id,
      taskId: f.task.id,
    }),
    [],
  );
  assert.equal(
    (await f.sessions.findTaskOwner(f.task.id))?.sessionId,
    newOwner.sessionId,
  );
  assert.deepEqual(await sourceSnapshot(f.sourcePath), snapshotBefore);
});

test("ownership loss after capture but before publish blocks the durable write", async (t) => {
  const f = await createFixture(t);
  const executor = new WritingCoderExecutor(async (workspace) => {
    await writeFile(join(workspace, "keep.txt"), "captured\n", "utf8");
  });
  // Deterministic seam: revoke ownership between capture and publish.
  const staging = stagingWith(f, {
    afterCapture: async () => {
      await f.commands.forceReleaseTaskSession(f.project.id, f.task.id);
    },
  });

  await assert.rejects(
    service(f, executor, staging).invokeUserAgent({
      sessionId: f.sessionId,
      agent: "coder",
      host: { provider: "openai" },
    }),
    (error: unknown) => error instanceof TaskSessionOwnershipLostError,
  );
  // The publish-time fence, not merely the pre-ResultProcessor one, held.
  assert.deepEqual(await f.changeSets.list(f.task.id), []);
  assert.deepEqual(
    await f.artifacts.listCoderWorkRecords({
      kind: "task",
      projectId: f.project.id,
      taskId: f.task.id,
    }),
    [],
  );
});

// ---------------------------------------------------------------------------
// Empty change, provider failure, Reviewer gate
// ---------------------------------------------------------------------------

test("a CODER invocation that changes nothing writes a work record with changeSet null", async (t) => {
  const f = await createFixture(t);
  const executor = new WritingCoderExecutor(async () => {
    // Deliberately no filesystem change.
  });
  const result = await service(f, executor, stagingWith(f)).invokeUserAgent({
    sessionId: f.sessionId,
    agent: "coder",
    host: { provider: "openai" },
  });
  const processed = result.processedResult as { coderChangeSet?: unknown };
  assert.ok("coderChangeSet" in processed);
  assert.equal(processed.coderChangeSet, null);
  // No fake patch and no change-set directory.
  assert.deepEqual(await f.changeSets.list(f.task.id), []);
  const records = await f.artifacts.listCoderWorkRecords({
    kind: "task",
    projectId: f.project.id,
    taskId: f.task.id,
  });
  assert.equal(records.length, 1);
  assert.equal(records[0]?.changeSet, null);
  // Task completion is not decided automatically.
  assert.equal(
    (await f.tasks.get(f.project.id, f.task.id)).status,
    "active",
  );
});

test("a provider failure publishes nothing and leaves the real source clean", async (t) => {
  const f = await createFixture(t);
  const snapshotBefore = await sourceSnapshot(f.sourcePath);
  const executor = new WritingCoderExecutor(async (workspace) => {
    await writeFile(join(workspace, "keep.txt"), "half done\n", "utf8");
    throw new Error("provider crashed");
  });
  await assert.rejects(
    service(f, executor, stagingWith(f)).invokeUserAgent({
      sessionId: f.sessionId,
      agent: "coder",
      host: { provider: "openai" },
    }),
    (error: unknown) =>
      error instanceof AgentExecutionFailedError &&
      error.code === "AGENT_EXECUTION_FAILED",
  );
  assert.deepEqual(await f.changeSets.list(f.task.id), []);
  assert.deepEqual(
    await f.artifacts.listCoderWorkRecords({
      kind: "task",
      projectId: f.project.id,
      taskId: f.task.id,
    }),
    [],
  );
  assert.deepEqual(await sourceSnapshot(f.sourcePath), snapshotBefore);
  assert.deepEqual(
    (await readdir(f.root)).filter((n) => n.startsWith("synaphex-coder-staging-")),
    [],
  );
});

test("REVIEWER is blocked while the latest CODER work is staged and unapplied", async (t) => {
  const f = await createFixture(t);
  const executor = new WritingCoderExecutor(async (workspace) => {
    await writeFile(join(workspace, "keep.txt"), "staged change\n", "utf8");
  });
  const coderResultValue = await service(
    f,
    executor,
    stagingWith(f),
  ).invokeUserAgent({
    sessionId: f.sessionId,
    agent: "coder",
    host: { provider: "openai" },
  });
  const changeSetId = (
    coderResultValue.processedResult as { coderChangeSet?: { id: string } }
  ).coderChangeSet?.id;
  assert.notEqual(changeSetId, undefined);

  const reviewerExecutor = new WritingCoderExecutor(async () => {
    throw new Error("reviewer provider must not run");
  });
  await assert.rejects(
    service(f, reviewerExecutor, stagingWith(f)).invokeUserAgent({
      sessionId: f.sessionId,
      agent: "reviewer",
      host: { provider: "openai" },
    }),
    (error: unknown) =>
      error instanceof ReviewTargetNotAppliedError &&
      error.code === "REVIEW_TARGET_NOT_APPLIED" &&
      error.details?.changeSetId === changeSetId,
  );
  assert.equal(reviewerExecutor.calls.length, 0);
  // No Reviewer PASS artifact, and the task stays active.
  assert.deepEqual(
    await f.artifacts.listReviewerReports({
      kind: "task",
      projectId: f.project.id,
      taskId: f.task.id,
    }),
    [],
  );
  assert.equal((await f.tasks.get(f.project.id, f.task.id)).status, "active");
});

test("a legacy CODER work record keeps its accepted Reviewer behavior", async (t) => {
  const f = await createFixture(t);
  // A pre-staging record has NO changeSet field at all.
  const legacy = await f.artifacts.saveCoderWorkRecord(
    { kind: "task", projectId: f.project.id, taskId: f.task.id },
    { files_changed: ["src/legacy.ts"] },
  );
  assert.equal("changeSet" in legacy, false, "legacy shape preserved");
  assert.deepEqual(legacy.payload, { files_changed: ["src/legacy.ts"] });

  // Reviewer may still run: the record is not reinterpreted as staged.
  const reviewerExecutor = new WritingCoderExecutor(async () => {}, {
    agent: "reviewer",
    outcome: "success",
    summary: "Reviewed the legacy implementation.",
    reviewStatus: "PASS_WITH_WARNINGS",
    warnings: ["legacy record"],
    report: { requirement_compliance: "met" },
  });
  const reviewed = await service(f, reviewerExecutor, stagingWith(f)).invokeUserAgent({
    sessionId: f.sessionId,
    agent: "reviewer",
    host: { provider: "openai" },
  });
  assert.equal(reviewed.processedResult.outcome, "success");
  assert.equal(reviewerExecutor.calls.length, 1);
});
