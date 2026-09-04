import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { PlanManager } from "../src/core/plan-manager.js";
import { ProjectManager } from "../src/core/project-manager.js";
import { SessionManager } from "../src/core/session-manager.js";
import { TaskManager } from "../src/core/task-manager.js";
import {
  NoTaskBoundError,
  PlanDraftRevisionMismatchError,
  TaskSessionOwnershipLostError,
} from "../src/domain/errors.js";
import type { PlanDraftRevisionId } from "../src/domain/plan.js";
import type { Project } from "../src/domain/project.js";
import type { Task } from "../src/domain/task.js";
import { StateStore } from "../src/infrastructure/state-store.js";
import { PlanDecisionCommands } from "../src/operations/plan-decision-commands.js";
import { ProjectTaskCommands } from "../src/operations/project-task-commands.js";
import { SessionCommands } from "../src/operations/session-commands.js";

interface Fixture {
  readonly store: StateStore;
  readonly plans: PlanManager;
  readonly sessions: SessionManager;
  readonly tasks: TaskManager;
  readonly commands: PlanDecisionCommands;
  readonly sessionCommands: SessionCommands;
  readonly bootstrap: ProjectTaskCommands;
  readonly project: Project;
  readonly task: Task;
  readonly plansDirectory: string;
}

async function createFixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-plan-decision-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const homeDirectory = join(root, "home");
  const sourcePath = join(root, "source");
  await Promise.all([
    mkdir(homeDirectory, { recursive: true }),
    mkdir(sourcePath, { recursive: true }),
  ]);
  const stateRoot = join(root, "state-root");
  const store = new StateStore(stateRoot);
  const projects = new ProjectManager(store, { homeDirectory });
  const tasks = new TaskManager(store, projects);
  const sessions = new SessionManager(store);
  const plans = new PlanManager(store, tasks);
  const project = await projects.create("Plan Project", sourcePath);
  const task = await tasks.create(project.id, "Plan the work");
  const taskDirectory = await tasks.getStateDirectory(project.id, task.id);
  return {
    store,
    plans,
    sessions,
    tasks,
    commands: new PlanDecisionCommands({ plans, tasks, sessions }),
    sessionCommands: new SessionCommands({ projects, tasks, sessions }),
    bootstrap: new ProjectTaskCommands({ projects, tasks, sessions }),
    project,
    task,
    plansDirectory: join(stateRoot, taskDirectory, "plans"),
  };
}

async function openSession(f: Fixture): Promise<string> {
  const opened = await f.sessionCommands.openTaskSession(
    f.project.id,
    f.task.id,
  );
  return opened.sessionId;
}

// ---------------------------------------------------------------------------
// Revision identity
// ---------------------------------------------------------------------------

test("every draft write mints a new revision, even for identical content", async (t) => {
  const f = await createFixture(t);
  const content = "# Plan\n\n1. Do the thing.\n";
  const revisions = new Set<string>();
  for (let round = 0; round < 4; round += 1) {
    const draft = await f.plans.saveDraft(f.task.id, content);
    assert.match(draft.revisionId, /^planrev_[0-9a-f]{32}$/);
    assert.equal(
      revisions.has(draft.revisionId),
      false,
      "identical content must still yield a new revision",
    );
    revisions.add(draft.revisionId);
  }
  assert.equal(revisions.size, 4);
  // The plan itself stays human-readable Markdown.
  assert.equal(
    await readFile(join(f.plansDirectory, "draft.md"), "utf8"),
    content,
  );
});

test("the revision id is independent of content and of identifying state", async (t) => {
  const f = await createFixture(t);
  const draft = await f.plans.saveDraft(f.task.id, "# Plan\n");
  const metadata = JSON.parse(
    await readFile(join(f.plansDirectory, "draft.meta.json"), "utf8"),
  );
  assert.equal(metadata.version, 1);
  assert.equal(metadata.revisionId, draft.revisionId);
  // A content hash exists for integrity, but is NOT the revision identity.
  assert.match(metadata.contentHash, /^[0-9a-f]{64}$/);
  assert.notEqual(metadata.revisionId, metadata.contentHash);
  for (const forbidden of [
    f.task.id,
    f.project.id,
    String(process.pid),
    metadata.contentHash,
  ]) {
    assert.equal(draft.revisionId.includes(forbidden), false);
  }
});

test("a legacy draft with no metadata is hydrated lazily with a fresh revision", async (t) => {
  const f = await createFixture(t);
  // Simulate a draft written before revision metadata existed.
  await writeFile(join(f.plansDirectory, "draft.md"), "# Legacy plan\n", "utf8");
  assert.deepEqual(
    (await readdir(f.plansDirectory)).filter((n) => n.endsWith(".json")),
    [],
  );

  // Still readable, but not decidable until hydrated.
  const unhydrated = await f.plans.getDraft(f.task.id);
  assert.equal(unhydrated?.content, "# Legacy plan\n");
  await assert.rejects(
    f.plans.acceptDraft(f.task.id, unhydrated!.revisionId),
    (error: unknown) => error instanceof PlanDraftRevisionMismatchError,
  );

  const hydrated = await f.plans.getDraftWithRevision(f.task.id);
  assert.match(hydrated!.revisionId, /^planrev_[0-9a-f]{32}$/);
  // Content is untouched by hydration.
  assert.equal(hydrated!.content, "# Legacy plan\n");
  assert.equal(
    await readFile(join(f.plansDirectory, "draft.md"), "utf8"),
    "# Legacy plan\n",
  );
  // And is now decidable.
  const accepted = await f.plans.acceptDraft(f.task.id, hydrated!.revisionId);
  assert.equal(accepted.content, "# Legacy plan\n");
});

test("metadata whose hash does not match the draft is never trusted", async (t) => {
  const f = await createFixture(t);
  const draft = await f.plans.saveDraft(f.task.id, "# Original\n");
  // Simulate a crash between the content write and the metadata write: the
  // draft bytes change while stale metadata remains.
  await writeFile(join(f.plansDirectory, "draft.md"), "# Replaced\n", "utf8");

  // The old revision must NOT be inherited by the new bytes.
  await assert.rejects(
    f.plans.acceptDraft(f.task.id, draft.revisionId),
    (error: unknown) => error instanceof PlanDraftRevisionMismatchError,
  );
  const rehydrated = await f.plans.getDraftWithRevision(f.task.id);
  assert.notEqual(rehydrated!.revisionId, draft.revisionId);
  assert.equal(rehydrated!.content, "# Replaced\n");
});

// ---------------------------------------------------------------------------
// Accept / reject semantics
// ---------------------------------------------------------------------------

test("accepting an exact revision archives current and promotes the draft", async (t) => {
  const f = await createFixture(t);
  const sessionId = await openSession(f);
  await f.plans.saveDraft(f.task.id, "# First plan\n");
  const first = await f.commands.getPlanReviewState(sessionId);
  await f.commands.acceptPlanDraft(sessionId, first.draft!.revisionId);
  assert.equal((await f.plans.getCurrent(f.task.id))?.content, "# First plan\n");
  assert.equal(await f.plans.getDraft(f.task.id), null);

  // A second accepted plan archives the first.
  await f.plans.saveDraft(f.task.id, "# Second plan\n");
  const second = await f.commands.getPlanReviewState(sessionId);
  const result = await f.commands.acceptPlanDraft(
    sessionId,
    second.draft!.revisionId,
  );
  assert.equal(result.currentContent, "# Second plan\n");
  assert.equal((await f.plans.getCurrent(f.task.id))?.content, "# Second plan\n");
  const archived = await readdir(join(f.plansDirectory, "archive"));
  assert.equal(archived.length, 1);
  assert.equal(
    await readFile(join(f.plansDirectory, "archive", archived[0]!), "utf8"),
    "# First plan\n",
  );
  // Draft metadata is cleaned up with the draft.
  assert.equal(
    (await readdir(f.plansDirectory)).includes("draft.meta.json"),
    false,
  );
});

test("rejecting an exact revision deletes the draft and leaves current intact", async (t) => {
  const f = await createFixture(t);
  const sessionId = await openSession(f);
  await f.plans.saveDraft(f.task.id, "# Accepted plan\n");
  const accepted = await f.commands.getPlanReviewState(sessionId);
  await f.commands.acceptPlanDraft(sessionId, accepted.draft!.revisionId);

  await f.plans.saveDraft(f.task.id, "# Rejected proposal\n");
  const proposal = await f.commands.getPlanReviewState(sessionId);
  await f.commands.rejectPlanDraft(sessionId, proposal.draft!.revisionId);

  // Draft is deleted, not archived; current is unchanged.
  assert.equal(await f.plans.getDraft(f.task.id), null);
  assert.equal(
    (await f.plans.getCurrent(f.task.id))?.content,
    "# Accepted plan\n",
  );
  assert.deepEqual(await readdir(join(f.plansDirectory, "archive")), []);
  // The task lifecycle is untouched.
  const task = await f.tasks.get(f.project.id, f.task.id);
  assert.equal(task.status, "active");
  assert.equal(task.completedAt, null);
});

test("a stale revision decision changes nothing and discloses no new content", async (t) => {
  const f = await createFixture(t);
  const sessionId = await openSession(f);
  await f.plans.saveDraft(f.task.id, "# Draft A\n");
  const reviewed = await f.commands.getPlanReviewState(sessionId);
  const staleRevision = reviewed.draft!.revisionId;

  // A new Planner draft replaces the reviewed one.
  await f.plans.saveDraft(f.task.id, "# Draft B\n");

  for (const decide of [
    () => f.commands.acceptPlanDraft(sessionId, staleRevision),
    () => f.commands.rejectPlanDraft(sessionId, staleRevision),
  ]) {
    await assert.rejects(decide, (error: unknown) => {
      assert.ok(error instanceof PlanDraftRevisionMismatchError);
      assert.equal(error.code, "PLAN_DRAFT_REVISION_MISMATCH");
      // The stale error must not leak the new draft content.
      const serialized = JSON.stringify(error.details);
      assert.equal(serialized.includes("Draft B"), false);
      return true;
    });
  }
  // Draft B survives untouched and current is still unset.
  assert.equal((await f.plans.getDraft(f.task.id))?.content, "# Draft B\n");
  assert.equal(await f.plans.getCurrent(f.task.id), null);
});

test("same-content ABA: an old revision cannot decide an identical new draft", async (t) => {
  const f = await createFixture(t);
  const sessionId = await openSession(f);
  const content = "# Identical plan\n\n1. Same bytes.\n";

  const draftA = await f.plans.saveDraft(f.task.id, content);
  const reviewedA = await f.commands.getPlanReviewState(sessionId);
  assert.equal(reviewedA.draft!.revisionId, draftA.revisionId);

  // Draft A is rejected, then a byte-identical draft B appears.
  await f.commands.rejectPlanDraft(sessionId, draftA.revisionId);
  const draftB = await f.plans.saveDraft(f.task.id, content);

  // Identical content, different instance identity.
  assert.equal(draftB.content, draftA.content);
  assert.notEqual(draftB.revisionId, draftA.revisionId);

  // The stale decision for A must NOT apply to B.
  await assert.rejects(
    f.commands.acceptPlanDraft(sessionId, draftA.revisionId),
    (error: unknown) => error instanceof PlanDraftRevisionMismatchError,
  );
  assert.equal((await f.plans.getDraft(f.task.id))?.content, content);
  assert.equal(await f.plans.getCurrent(f.task.id), null);

  // The correct revision works.
  await f.commands.acceptPlanDraft(sessionId, draftB.revisionId);
  assert.equal((await f.plans.getCurrent(f.task.id))?.content, content);
});

// ---------------------------------------------------------------------------
// Session / ownership authority
// ---------------------------------------------------------------------------

test("a project-only session cannot review or decide task plans", async (t) => {
  const f = await createFixture(t);
  await f.plans.saveDraft(f.task.id, "# Plan\n");
  const projectSession = await f.bootstrap.openProjectSession(f.project.id);
  for (const operation of [
    () => f.commands.getPlanReviewState(projectSession.sessionId),
    () =>
      f.commands.acceptPlanDraft(
        projectSession.sessionId,
        "planrev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as PlanDraftRevisionId,
      ),
    () =>
      f.commands.rejectPlanDraft(
        projectSession.sessionId,
        "planrev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as PlanDraftRevisionId,
      ),
  ]) {
    await assert.rejects(operation, (e: unknown) => e instanceof NoTaskBoundError);
  }
  // The draft is untouched.
  assert.equal((await f.plans.getDraft(f.task.id))?.content, "# Plan\n");
});

test("a session that lost its task claim cannot decide", async (t) => {
  const f = await createFixture(t);
  const sessionId = await openSession(f);
  await f.plans.saveDraft(f.task.id, "# Plan\n");
  const reviewed = await f.commands.getPlanReviewState(sessionId);

  // Another actor force-releases the claim, then a new session takes it.
  await f.sessionCommands.forceReleaseTaskSession(f.project.id, f.task.id);
  const newOwner = await f.sessionCommands.openTaskSession(
    f.project.id,
    f.task.id,
  );

  // Force release also deletes the old session's binding record (Phase 2B),
  // so the stale session fails at task-scope resolution -- still fail-closed,
  // just earlier than the ownership fence.
  for (const operation of [
    () => f.commands.acceptPlanDraft(sessionId, reviewed.draft!.revisionId),
    () => f.commands.rejectPlanDraft(sessionId, reviewed.draft!.revisionId),
  ]) {
    await assert.rejects(
      operation,
      (error: unknown) => error instanceof NoTaskBoundError,
    );
  }
  // Nothing was decided on the replacement owner's behalf.
  assert.equal((await f.plans.getDraft(f.task.id))?.content, "# Plan\n");
  assert.equal(await f.plans.getCurrent(f.task.id), null);

  // The new owner can decide normally.
  const state = await f.commands.getPlanReviewState(newOwner.sessionId);
  await f.commands.acceptPlanDraft(
    newOwner.sessionId,
    state.draft!.revisionId,
  );
  assert.equal((await f.plans.getCurrent(f.task.id))?.content, "# Plan\n");
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

test("C: concurrent accept and reject of the same revision -- exactly one wins", async (t) => {
  for (let round = 0; round < 10; round += 1) {
    const f = await createFixture(t);
    const sessionId = await openSession(f);
    const draft = await f.plans.saveDraft(f.task.id, "# Contested plan\n");

    const [acceptOutcome, rejectOutcome] = await Promise.allSettled([
      f.commands.acceptPlanDraft(sessionId, draft.revisionId),
      f.commands.rejectPlanDraft(sessionId, draft.revisionId),
    ]);
    const winners = [acceptOutcome, rejectOutcome].filter(
      (outcome) => outcome.status === "fulfilled",
    );
    assert.equal(winners.length, 1, "exactly one decision may mutate");

    // Coherent end state either way: the draft is gone, and current is set
    // only if acceptance won. No duplicate archive entries.
    assert.equal(await f.plans.getDraft(f.task.id), null);
    const current = await f.plans.getCurrent(f.task.id);
    if (acceptOutcome.status === "fulfilled") {
      assert.equal(current?.content, "# Contested plan\n");
    } else {
      assert.equal(current, null);
    }
    assert.deepEqual(await readdir(join(f.plansDirectory, "archive")), []);
  }
});

test("D: a Planner draft write racing an accept never accepts an unspecified revision", async (t) => {
  for (let round = 0; round < 10; round += 1) {
    const f = await createFixture(t);
    const sessionId = await openSession(f);
    const reviewed = await f.plans.saveDraft(f.task.id, "# Reviewed plan\n");

    const [acceptOutcome] = await Promise.allSettled([
      f.commands.acceptPlanDraft(sessionId, reviewed.revisionId),
      f.plans.saveDraft(f.task.id, "# Planner replacement\n"),
    ]);

    const current = await f.plans.getCurrent(f.task.id);
    if (acceptOutcome.status === "fulfilled") {
      // Acceptance won the lock first: only the reviewed plan can be current.
      assert.equal(current?.content, "# Reviewed plan\n");
    } else {
      // The replacement landed first, so the stale decision failed and the
      // replacement is still just a draft.
      assert.ok(
        (acceptOutcome as PromiseRejectedResult).reason instanceof
          PlanDraftRevisionMismatchError,
      );
      assert.equal(current, null);
      assert.equal(
        (await f.plans.getDraft(f.task.id))?.content,
        "# Planner replacement\n",
      );
    }
    // The replacement plan is never silently promoted.
    assert.notEqual(current?.content, "# Planner replacement\n");
  }
});

test("concurrent Planner writes serialize and leave exactly one usable revision", async (t) => {
  const f = await createFixture(t);
  const results = await Promise.all(
    Array.from({ length: 5 }, (_unused, index) =>
      f.plans.saveDraft(f.task.id, `# Plan ${index}\n`),
    ),
  );
  const revisions = new Set(results.map((draft) => draft.revisionId));
  assert.equal(revisions.size, 5, "each write has its own identity");

  // The persisted draft is one coherent instance whose metadata matches.
  const persisted = await f.plans.getDraftWithRevision(f.task.id);
  assert.notEqual(persisted, null);
  assert.ok(revisions.has(persisted!.revisionId));
  const metadata = JSON.parse(
    await readFile(join(f.plansDirectory, "draft.meta.json"), "utf8"),
  );
  assert.equal(metadata.revisionId, persisted!.revisionId);
});

test("plan decisions never expose an ownership token", async (t) => {
  const f = await createFixture(t);
  const sessionId = await openSession(f);
  await f.plans.saveDraft(f.task.id, "# Plan\n");
  const claim = await f.store.readJson<{ ownershipToken?: string }>(
    `state/task-bindings/${f.task.id}.json`,
  );
  const token = claim?.ownershipToken;
  assert.equal(typeof token, "string");

  const state = await f.commands.getPlanReviewState(sessionId);
  const accepted = await f.commands.acceptPlanDraft(
    sessionId,
    state.draft!.revisionId,
  );
  for (const payload of [state, accepted]) {
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes(token as string), false);
    assert.equal(serialized.includes("ownershipToken"), false);
    // No filesystem paths are exposed either.
    assert.equal(serialized.includes("/plans"), false);
    assert.equal(serialized.includes("draft.md"), false);
  }
});


test("the ownership fence blocks a session whose claim was taken but binding kept", async (t) => {
  const f = await createFixture(t);
  const sessionId = await openSession(f);
  await f.plans.saveDraft(f.task.id, "# Plan\n");
  const reviewed = await f.commands.getPlanReviewState(sessionId);

  // Remove only the CLAIM, leaving the binding record naming the task. The
  // session still resolves a task scope but holds no authority, so the
  // Phase-2C ownership fence is what refuses the decision.
  await f.store.removeFile(`state/task-bindings/${f.task.id}.json`);

  for (const operation of [
    () => f.commands.acceptPlanDraft(sessionId, reviewed.draft!.revisionId),
    () => f.commands.rejectPlanDraft(sessionId, reviewed.draft!.revisionId),
  ]) {
    await assert.rejects(
      operation,
      (error: unknown) =>
        error instanceof TaskSessionOwnershipLostError &&
        error.code === "TASK_SESSION_OWNERSHIP_LOST",
    );
  }
  // Nothing was decided.
  assert.equal((await f.plans.getDraft(f.task.id))?.content, "# Plan\n");
  assert.equal(await f.plans.getCurrent(f.task.id), null);
});
