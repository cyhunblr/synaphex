# Troubleshooting: sessions and locks

Ownership conflicts, lost claims, lifecycle refusals, and stuck locks.

## Troubleshooting index

- [Installation](installation.md)
- [Providers and agent execution](providers.md)
- **Sessions and locks**
- [CODER and change sets](coder-and-change-sets.md)

## Symptom index

| Symptom | Code | Jump to |
| --- | --- | --- |
| Cannot open a second session on a task | `TASK_ALREADY_BOUND` | [Task already bound](#task-already-bound) |
| Operation says no task is bound | `NO_TASK_BOUND` | [Project vs task sessions](#project-vs-task-sessions) |
| Work finished but could not be saved | `TASK_SESSION_OWNERSHIP_LOST` | [Ownership lost mid-operation](#ownership-lost-mid-operation) |
| Cannot open a completed or archived task | `TASK_COMPLETED` / `TASK_ARCHIVED` | [Completed vs archived](#completed-vs-archived) |
| An agent refuses on a completed task | — | [Completed vs archived](#completed-vs-archived) |
| Owner is gone and cannot be closed | — | [Force release](#force-release) |
| A lock timeout keeps appearing | `*_LOCK_TIMEOUT` | [Locks](#locks) |
| Files under `state/.lock-quarantine/` | — | [Quarantine leftovers](#quarantine-leftovers) |

## Task already bound

**Symptom.** `synaphex_open_task_session` fails with `TASK_ALREADY_BOUND`.

**Likely cause.** A task may have **at most one writable session at a time**. Another live session already holds the claim — often another host window, or an earlier session you never closed.

**How to confirm.** Ask who owns it — this is read-only and safe:

```json
{ "projectId": "prj_example", "taskId": "task_example" }
```

via `synaphex_get_task_session_owner`.

**Safe next step.** In order of preference:

1. **Keep using the existing session** if it is still yours and reachable.
2. **Close it cleanly** with `synaphex_close_session` if you are finished with it.
3. Only if the owner genuinely cannot be closed, use [force release](#force-release).

**What not to do.** Don't edit anything under `state/task-bindings/`. That is the authority record for who may write to the task; editing it by hand can leave two sessions believing they own the same task.

## Project vs task sessions

**Symptom.** An operation fails with `NO_TASK_BOUND`, or a tool insists on task authority you thought you had.

**Likely cause.** You are holding a project session where a task session is required.

| Session kind | Opened with | Gives you |
| --- | --- | --- |
| Project | `synaphex_open_project_session` | Project context, no task claim |
| Task | `synaphex_open_task_session` | Writable authority over one task |

A project session is **not** a weaker task session — it holds no task claim at all. Anything that mutates task state (plans, change sets, completion) requires a task session.

**Safe next step.** Open a task session for the task you mean to work on.

## Ownership lost mid-operation

**Symptom.** A long invocation appears to run, then fails with `TASK_SESSION_OWNERSHIP_LOST`. The result is not saved.

**Likely cause.** Ownership or lifecycle eligibility changed between the start of the operation and the moment its result was about to be committed — the session was closed, the claim was force-released, or the task's status changed.

**This is intentional, and it is not data corruption.** Synaphex checks authority twice: once before starting, and again at the commit boundary. A result produced under authority that has since been lost is refused rather than written, so a superseded session cannot overwrite whoever holds the task now.

**Safe next step.** Inspect current state with `synaphex_get_task` and `synaphex_get_task_session_owner`, then re-run under valid authority if that is still what you want.

**What not to do.** Don't treat it as corruption and start repairing state by hand. Nothing was half-written — the refusal happened *instead of* the write.

## Completed vs archived

These two states are not the same, and they refuse different things.

| Task state | Open a session? | Agents that may still run |
| --- | --- | --- |
| `active` | Yes | All six |
| `completed` | No — `TASK_COMPLETED` | RESEARCHER and EXAMINER only |
| `archived` | No — `TASK_ARCHIVED` | None |

RESEARCHER and EXAMINER remain valid against a completed task, so you can still research it or reconcile memory from it. QUESTIONER, PLANNER, CODER, and REVIEWER require an `active` task.

An archived task accepts no agent invocation at all.

> **There is no reopen and no unarchive.** The lifecycle is one-way: `active → completed → archived`. If you need to do more work, create a new task.

**Related.** [Task lifecycle workflow](../workflows/review-complete-archive.md).

## Force release

`synaphex_force_release_task_session` is a **recovery and administrative operation**, not the normal way to switch sessions.

```json
{ "projectId": "prj_example", "taskId": "task_example" }
```

**Use it only when** the current writable owner cannot be closed normally — for example the host process that held it is gone.

**What it does.** Releases the task claim so a new session can open.

**What it does not do.** It rolls nothing back. Plans, memory, change sets, and any source mutation already applied are **left exactly as they are**. The previous owner simply loses the ability to commit, and will see `TASK_SESSION_OWNERSHIP_LOST` if it tries.

**Safe next step.** Check the owner first with `synaphex_get_task_session_owner`. If the claim is genuinely abandoned, release it, then open a fresh task session and inspect current state before continuing.

## Locks

Synaphex uses recoverable process locks around four areas:

```text
task binding · memory · plans · source mutation
```

**Symptom.** An operation fails with a lock timeout — `TASK_BINDING_LOCK_TIMEOUT`, `PLAN_MUTATION_LOCK_TIMEOUT`, or `SOURCE_MUTATION_LOCK_TIMEOUT`. (Memory has its own lock, but its timeout is not surfaced as a public MCP code.)

**Likely cause.** Genuine concurrent activity, or a previous holder that died while holding the lock.

**How recovery works.** A lock held by a dead owner is reclaimed only when Synaphex can establish that the owner is definitely gone, using a generation-safe capture-verify-restore sequence. If ownership is uncertain — an unknown or foreign owner — it **fails closed** rather than stealing the lock.

**Safe next step.** Retry the operation shortly. If it persists, check whether another host or session is still running against the same state.

> **Locks do not expire on a timer.** There is no TTL and no timeout-based stealing, so "wait for it to expire" is not a remedy — waiting alone will not release a lock. Recovery happens through the ownership check, on the next attempt.

**What not to do.** Don't delete lock files to unblock yourself. Deleting a lock whose owner is actually alive removes the very protection that keeps two writers apart.

## Quarantine leftovers

**Symptom.** You notice files under `state/.lock-quarantine/`.

**What they are.** Transient artifacts of lock recovery. After certain crash windows, inert markers can remain. **Their presence does not mean work is in progress** and does not by itself block anything.

**Safe next step.** Normally nothing. Inspect current state through the read tools; if operations succeed, the markers are harmless.

There is **no public garbage-collection operation** in v0.1, and manual cleanup is not part of the normal workflow. This is known maintenance debt, tracked as such rather than as a user task.

**Related.** [Filesystem layout](../reference/filesystem-layout.md).

## Sharing diagnostics safely

Session and task ids are safe to share. Avoid posting tokens, full environment dumps, `~/.synaphex` memory or artifacts, or personal absolute paths where a placeholder would do.
