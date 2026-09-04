# ADR 0005: Deterministic task lifecycle

Status: accepted (Phase 6A)

```text
active → completed → archived
```

One-way. There is no reopen and no un-archive: new work after completion means a
new task.

## Two ways to complete

```text
REVIEWER PASS / PASS_WITH_WARNINGS   completes the task as part of its own result
synaphex_complete_task               completes it at the user's explicit request
```

A user may complete **without** REVIEWER. That is a deliberate user override of
workflow, not a fabricated review: no Reviewer artifact is written, and nothing
records a review that did not happen.

## Completion retains the session; archive closes it

Completion is `active → completed` and nothing else. It does not archive, close
the session, release the task claim, remove plans or artifacts, touch the source
workspace or run Git. A completed task stays bound so follow-up work that its
role contract permits (RESEARCHER, EXAMINER) can still run.

Archive is the terminal step. It releases any task session still owning the task,
moves the task into the archive collection, and preserves plans, artifacts,
change sets, decision receipts, Reviewer reports and memory. There is no cleanup
GC in this slice.

## Completion authority is the bound session alone

`synaphex_complete_task` accepts **only** `{ sessionId }`. There is no
`projectId`, `taskId`, `status`, `force` or `completed` input, so a caller cannot
complete a task it does not currently own, and cannot address one by id. Project
and task are resolved from authoritative binding, and current task ownership is
required.

## Archive authority is administrative

`synaphex_archive_task` accepts `{ projectId, taskId }`. A completed task's
session may legitimately be gone, and requiring the user to reopen one merely to
archive would be perverse. The client cannot supply an owner SessionId to
force-close — any owner is **discovered** from authoritative task-binding state.

This is analogous to explicit task-session force recovery: local stdio invocation
is the direct user authority. Before any remote transport, this operation needs
an authorization review.

## Completion blockers

Manual completion fails closed when the task still has an explicit decision flow
outstanding, because completing over it would strand authoritative state nothing
would ever resolve:

| condition | error |
| --- | --- |
| plan draft exists | `PLAN_DRAFT_PENDING` |
| latest change set `pending` | `TASK_HAS_PENDING_CHANGE_SET` |
| latest change set `applying_interrupted` | `TASK_HAS_PENDING_CHANGE_SET` |

The user resolves these with `accept_plan_draft` / `reject_plan_draft`, or
`apply_change_set` / `reject_change_set` / `reconcile_interrupted_apply`. An
`applied` or `rejected` change set does not block, and a CODER record with
`changeSet: null` (it changed nothing) does not block.

## The commit-boundary race

Manual completion introduced a real race: a task-bound provider can be running
when the user completes the task.

```text
CODER starts while active → provider works → user completes → CODER returns
```

CODER must not publish a change set or work record against a completed task.
Phase 6A closes this at the **durable commit boundary**:

```text
withTaskOwnershipAuthority(fence, async () => {
  re-read the task
  re-assert role/lifecycle eligibility
  publish change set        (CODER only)
  ResultProcessor.process   (durable task-scoped writes)
})
```

Previously ownership was checked and the lock then released *before* publication
and processing — a check-then-mutate window. The task-binding lock now spans
validation and the durable write together.

The lock spans **only** that short deterministic boundary. Provider execution,
the staging clone and Git capture all happen outside it. Capture was split from
publication specifically so the expensive Git work stays outside the lock; the
staging coordinator's publication is reentrancy-aware, because the task-binding
lock is not reentrant and the caller now holds it.

## Role contracts, not a hardcoded "active"

The commit-time check reuses the **same** role contract table as invocation
preflight, via one extracted `assertRoleLifecycleEligible`. Duplicating a second
table would let the two drift apart.

```text
questioner / planner / coder / reviewer   ["active"]
researcher / examiner                     ["active", "completed"]
```

So a RESEARCHER invocation that was running when the task completed still
commits — its contract permits a completed task. Mutation-testing confirms this:
replacing the check with a hardcoded `status !== "active"` fails that test, and
removing the check entirely fails the CODER race test.

REVIEWER is a deliberate subtlety: its own PASS completes the task. The check
runs **before** ResultProcessor, so REVIEWER is never rejected by the state it is
itself about to create.

## Archive ordering and crash window

```text
release task ownership/session  →  archive task state
```

A crash between them leaves `completed + unbound`, which is safe and simply
retryable. The reverse order could leave a session claiming an archived task.
Releasing first cannot admit competing work, because a completed task cannot be
claimed as a new active task under the accepted lifecycle.

An active task is refused **before** any session state is touched, so a failed
archive never releases a live task claim as a side effect.

**Residual window:** archive is not atomic across the two steps. If the process
dies after release but before the state write, the task remains `completed` and
unbound; re-running archive completes it. Nothing is lost or double-applied.

## Continuations

Lifecycle mutation deliberately does **not** scan or delete continuation records.
A stale handle may survive in process memory; using it fails through the ordinary
binding/lifecycle/ownership preflight instead. Authority is never resurrected.

## Archived task lookup

Unchanged: `synaphex_get_task(projectId, taskId)` already resolves archived tasks,
because task lookup spans both the open and archive collections. No separate
archive browser was added.

## Tool surface

```text
synaphex_complete_task    { sessionId }              destructive, non-idempotent
synaphex_archive_task     { projectId, taskId }      destructive, non-idempotent
```

Both `openWorldHint: false`. Neither is idempotent: a second call raises
`INVALID_TASK_TRANSITION` rather than succeeding, and claiming idempotency merely
because the end state matches would be dishonest.

Count: **27 → 29**. No reopen, un-archive, delete or list tool was added; an
audit test asserts no tool exists that moves a task backwards, and that no tool
accepts a `status`, `force` or `reopen` field.
