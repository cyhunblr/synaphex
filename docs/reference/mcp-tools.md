# MCP tools reference

Synaphex exposes **29 MCP tools**. This page is the canonical list. Every name
below is registered by the running server; nothing here is aspirational.


## Reference index

- [CLI](cli.md)
- **MCP tools**
- [Errors](errors.md)
- [Filesystem layout](filesystem-layout.md)
- [Compatibility](compatibility.md)

## What is deliberately absent

Before the list, the shape of the surface matters as much as its contents:

- **No generic shell or command-execution tool.**
- **No arbitrary filesystem read/write tool.**
- **No host-context override.** Host identity is a startup flag; no tool input can change it.
- **No arbitrary provider executor.** Agents are invoked by role, not by naming a binary.
- **No task reopen or unarchive.**
- **No host-action executor.** Requests like `git_push` or CI triggers are recorded, never executed.
- **No lock-deletion or force-unlock escape hatch** beyond the audited task-session release below.

See [security model](../security/security-model.md) and [permissions](../security/permissions.md).

## Category index

| Category | Tools | Count |
| --- | --- | --- |
| [Project and task bootstrap](#project-and-task-bootstrap) | `register_project`, `create_task` | 2 |
| [Sessions and ownership](#sessions-and-ownership) | `open_project_session`, `open_task_session`, `close_session`, `get_task_session_owner`, `force_release_task_session` | 5 |
| [Reads and inspection](#reads-and-inspection) | `get_project`, `get_task`, `get_session`, `get_agent_config`, `get_effective_rules` | 5 |
| [Agent invocation](#agent-invocation) | `invoke_agent` | 1 |
| [Continuations and approvals](#continuations-and-approvals) | `execute_helper`, `approve_and_execute_helper`, `resume_caller`, `approve_network_action`, `continue_allowed_network` | 5 |
| [Plans](#plans) | `get_plan_state`, `accept_plan_draft`, `reject_plan_draft` | 3 |
| [Change sets](#change-sets) | `get_change_set`, `read_change_set_patch`, `apply_change_set`, `reject_change_set` | 4 |
| [Interrupted-apply recovery](#interrupted-apply-recovery) | `get_apply_recovery_state`, `reconcile_interrupted_apply` | 2 |
| [Task lifecycle](#task-lifecycle) | `complete_task`, `archive_task` | 2 |

All names carry the `synaphex_` prefix.

## Identifier formats

Identifiers are server-generated. The examples below are **illustrative only** and would not pass validation:

```text
prj_example      real form: prj_<32 hex chars>
task_example     real form: task_<32 hex chars>
ses_example      real form: ses_<uuid>
changeset_example real form: changeset_<timestamp>_<16 hex chars>
```

Always pass back an id a tool actually returned.

## Annotations

Destructive tools are marked. `R` = read-only, `D` = destructive, `I` = idempotent, `O` = open-world (may invoke a provider).

| Tool | R | D | I | O |
| --- | :-: | :-: | :-: | :-: |
| `get_project`, `get_task`, `get_session`, `get_agent_config`, `get_effective_rules` | ✓ | | ✓ | |
| `get_change_set`, `read_change_set_patch`, `get_apply_recovery_state`, `get_plan_state` | ✓ | | ✓ | |
| `get_task_session_owner` | ✓ | | ✓ | |
| `register_project`, `create_task`, `open_project_session`, `open_task_session` | | | | |
| `close_session` | | | ✓ | |
| `apply_change_set`, `reject_change_set`, `reconcile_interrupted_apply` | | ✓ | | |
| `accept_plan_draft`, `reject_plan_draft` | | ✓ | | |
| `complete_task`, `archive_task` | | ✓ | | |
| `force_release_task_session` | | ✓ | ✓ | |
| `invoke_agent`, `approve_and_execute_helper`, `approve_network_action` | | ✓ | | ✓ |
| `execute_helper`, `resume_caller`, `continue_allowed_network` | | | | ✓ |

## Authority model

Three distinct authority styles appear across the surface. Mixing them up is the most common integration error.

| Authority | Meaning | Used by |
| --- | --- | --- |
| **Session authority** | Requires a live session id whose task binding is still owned | `complete_task`, plan tools, change-set tools |
| **Administrative authority** | Takes `projectId` + `taskId` directly, no session required | `archive_task`, `get_task_session_owner`, `force_release_task_session` |
| **Exact-target authority** | Session authority *plus* an exact id that must match the current authoritative target | `accept_plan_draft` (draft revision), change-set apply/reject (`changeSetId`) |

Exact-target authority exists so a stale client cannot approve something that has since been superseded.

---

## Project and task bootstrap

### `synaphex_register_project`

Registers an existing local directory as a Synaphex project.

```json
{ "name": "Example", "sourcePath": "/path/to/project" }
```

Creates the project state directory. Returns the project record including its generated `projectId`.

Fails with `PROJECT_PATH_NOT_FOUND`, `INVALID_PROJECT_PATH`, or `PROJECT_PATH_ALREADY_REGISTERED`.

### `synaphex_create_task`

```json
{ "projectId": "prj_example", "description": "Add retry to the upload client" }
```

Creates a task in `active` state with its plan, artifact, and memory directories. Returns the task record with its `taskId`.

Fails with `PROJECT_NOT_FOUND` or `INVALID_TASK_DESCRIPTION`.

## Sessions and ownership

A task may have **at most one writable session at a time**. This is the core concurrency invariant.

### `synaphex_open_project_session`

```json
{ "projectId": "prj_example" }
```

Opens a session bound to a project but not to a task. Returns `sessionId`.

### `synaphex_open_task_session`

```json
{ "projectId": "prj_example", "taskId": "task_example" }
```

Opens a session and claims writable ownership of the task.

Fails with `TASK_ALREADY_BOUND` when another live session holds the claim, and with `TASK_COMPLETED` or `TASK_ARCHIVED` for non-active tasks.

### `synaphex_close_session`

```json
{ "sessionId": "ses_example" }
```

Closes the session and releases any task claim it held. Idempotent.

### `synaphex_get_task_session_owner`

```json
{ "projectId": "prj_example", "taskId": "task_example" }
```

Read-only. Reports whether the task is currently claimed. An unbound task reports `bound: false` rather than failing.

### `synaphex_force_release_task_session`

> **Destructive, administrative.** Releases another session's claim on a task.

```json
{ "projectId": "prj_example", "taskId": "task_example" }
```

This is a recovery operation for a genuinely abandoned claim — for example after a host crashed. Synaphex never steals a claim on a timer; this is the explicit, human-authorized path. The released session loses its ability to commit, surfacing `TASK_SESSION_OWNERSHIP_LOST`.

## Reads and inspection

All read-only and idempotent.

| Tool | Input | Returns |
| --- | --- | --- |
| `synaphex_get_project` | `{ "projectId": "prj_example" }` | Project record: id, name, source path |
| `synaphex_get_task` | `{ "projectId": "prj_example", "taskId": "task_example" }` | Task record: id, description, state |
| `synaphex_get_session` | `{ "sessionId": "ses_example" }` | Session record and its project/task binding |
| `synaphex_get_agent_config` | `{ "agent": "researcher" }` | Configured target, or `{"status":"unconfigured"}` |
| `synaphex_get_effective_rules` | `{ "projectId": "prj_example", "taskId": "task_example" }` | Resolved rule decisions after precedence |

For `get_effective_rules`, both fields are optional: omitting them resolves at a broader scope. Precedence is `task > project > global > default_deny`; see [rules](../configuration/rules.md).

## Agent invocation

### `synaphex_invoke_agent`

> **Destructive and open-world.** Launches a provider CLI process.

```json
{
  "agent": "researcher",
  "scope": { "kind": "task_session", "sessionId": "ses_example" },
  "instruction": "Summarize how uploads currently retry."
}
```

Invokes one of the six agents: `questioner`, `researcher`, `examiner`,
`planner`, `coder`, `reviewer`.

`scope` is a tagged union and **`kind` is required**:

| `kind` | Requires | Use for |
| --- | --- | --- |
| `task_session` | A session bound to a task | Task work: PLANNER, CODER, REVIEWER, and task-scoped research |
| `project` | A session bound to a project with no task | Project-level work with no task binding |

The session binding — not the tool input — resolves which project and task the
invocation runs under. `instruction` is 1–8000 characters.

**CODER specifics.** CODER is available for direct invocation. A task-bound CODER invocation **always stages** — it runs in an isolated Git clone and produces a change set rather than touching your working tree. See [CODER isolation](../security/coder-isolation.md) and [change sets](../workflows/coder-change-sets.md).

The result carries the agent's outcome, summary, warnings, persisted artifacts, and any requested calls or actions. Requested items are **recorded, not executed** — they become continuation entries you decide on.

Common failures: `AGENT_UNCONFIGURED`, `INVALID_PROVIDER_ROUTE`,
`AGENT_TARGET_SURFACE_UNSUPPORTED`, `PROVIDER_EXECUTION_POLICY_UNSUPPORTED`,
`PROVIDER_CLI_UNAVAILABLE`, `AGENT_EXECUTION_FAILED`, `INVALID_AGENT_RESULT`,
`PLAN_DRAFT_PENDING`, `TASK_SESSION_OWNERSHIP_LOST`.


## Continuations and approvals

When an agent asks to call another agent or perform an action, Synaphex records a **continuation** instead of acting. Nothing in this group auto-runs; each requires an explicit call from you.

Continuations are addressed by `continuationId` plus a `requestIndex` selecting which request in that continuation you mean.

### `synaphex_execute_helper`

```json
{ "continuationId": "cont_example", "requestIndex": 0 }
```

Executes a helper agent call whose rule decision is already `allow`. No approval step, because the rule already granted it.

### `synaphex_approve_and_execute_helper`

> **Destructive and open-world.**

Same input shape. Used when the rule decision is `ask`: this call *is* the approval, and it executes in the same step. Approval is one-time and per-invocation — it is not remembered.

**CODER is excluded from helper continuation invocation.** An agent cannot spawn CODER as a helper; CODER runs only through direct top-level invocation.

### `synaphex_resume_caller`

```json
{ "continuationId": "cont_example" }
```

Returns control to the agent that requested the continuation, carrying results back to it.

### Network actions

There is **no generic network tool**. Network access is a rule-governed capability with three outcomes:

| Rule decision | Tool to call | Approval needed |
| --- | --- | --- |
| `allow` | `synaphex_continue_allowed_network` | No — already granted |
| `ask` | `synaphex_approve_network_action` | Yes — this call is the approval |
| `deny` | none | No continuation executes |

Both take `{ "continuationId": "...", "requestIndex": 0 }`. Under `deny` there is no tool to call; the request stays recorded and unexecuted.

## Plans

### `synaphex_get_plan_state`

```json
{ "sessionId": "ses_example" }
```

Read-only. Reports whether a draft is pending, whether a plan is accepted, and the current draft revision identifier you must echo back to decide on it.

### `synaphex_accept_plan_draft` / `synaphex_reject_plan_draft`

> **Destructive.** Both require exact revision authority.

```json
{ "sessionId": "ses_example", "draftRevisionId": "rev_example" }
```

The `draftRevisionId` must match the current draft exactly. If the draft changed since you read it, the call fails with `PLAN_DRAFT_REVISION_MISMATCH` rather than deciding on content you did not see.

**There is no natural-language approval equivalence.** Telling an agent "the plan looks good" does not accept a plan; only this tool does.

Other failures: `NO_PLAN_DRAFT`, `PLAN_ALREADY_ACCEPTED`, `INVALID_PLAN_CONTENT`, `PLAN_MUTATION_LOCK_TIMEOUT`.

## Change sets

A change set is immutable proposed source mutation. Reading one never modifies your source; applying is a separate, explicit decision.

### `synaphex_get_change_set`

```json
{ "sessionId": "ses_example", "changeSetId": "changeset_example" }
```

Read-only. Returns metadata: base commit, changed-file list, patch size, and current state (`pending`, `applying_interrupted`, `applied`, `rejected`).

### `synaphex_read_change_set_patch`

Read-only, and **paginated** — you will usually need more than one call.

```json
{
  "sessionId": "ses_example",
  "changeSetId": "changeset_example",
  "offset": 0,
  "maxBytes": 65536
}
```

`offset` and `maxBytes` are optional but meaningful: the patch is returned in bounded slices. The result reports the slice returned and whether more remains; advance `offset` until the patch is fully read. Patch integrity is verified against a stored SHA-256 and byte length on every read, so a tampered patch surfaces `CHANGE_SET_CORRUPT` instead of returning.

### `synaphex_apply_change_set` / `synaphex_reject_change_set`

> **Destructive.** `apply` is the only tool that modifies your working tree.

```json
{ "sessionId": "ses_example", "changeSetId": "changeset_example" }
```

Both require current task ownership **and** that the given id is the **latest authoritative CODER target**. An older change set fails with `CHANGE_SET_NOT_CURRENT_TARGET`, so a stale client cannot apply superseded work.

Apply preconditions are checked against real Git state: `CHANGE_SET_SOURCE_HEAD_CHANGED` if HEAD moved off the recorded base, `CHANGE_SET_SOURCE_DIRTY` if the worktree is not clean, `CHANGE_SET_APPLY_CHECK_FAILED` if the patch will not apply.

A decided change set cannot be decided again (`CHANGE_SET_ALREADY_DECIDED`). Applying **stages** the changes in Git; it does not commit or push.

## Interrupted-apply recovery

If Synaphex is interrupted mid-apply, the change set enters `applying_interrupted` and normal operations refuse to proceed with `CHANGE_SET_APPLY_RECOVERY_REQUIRED`.

### `synaphex_get_apply_recovery_state`

```json
{ "sessionId": "ses_example", "changeSetId": "changeset_example" }
```

Read-only. Classifies your actual source into one of three observed states:

| `observedSourceState` | Meaning |
| --- | --- |
| `base_clean` | Source matches the recorded base commit; the apply did not land |
| `exact_applied` | Source exactly matches the expected result tree; the apply did land |
| `divergent` | Neither is provable — the source differs from both |

`divergent` is the deliberate fallback whenever the state cannot be proven; Synaphex does not guess.

### `synaphex_reconcile_interrupted_apply`

> **Destructive.** Resolves the interrupted state.

Same input. The resolution follows the observed state — `base_clean` reconciles to not-applied, `exact_applied` reconciles to applied. Under `divergent` Synaphex will not silently pick an outcome for you.

**Synaphex never runs `git reset --hard` or `git clean` on your behalf.** The client does not select a recovery action; the observed source state determines it. See [interrupted-apply recovery](../workflows/interrupted-apply-recovery.md).

Fails with `CHANGE_SET_NOT_INTERRUPTED` if the change set is not in that state.

## Task lifecycle

The lifecycle is one-way: `active → completed → archived`. There is no reopen and no unarchive.

### `synaphex_complete_task`

> **Destructive.** Requires **current task-bound session authority**.

```json
{ "sessionId": "ses_example" }
```

Marks the task completed. **The session retains its binding and claim** — completion is a state change, not a release.

Refuses with `TASK_HAS_PENDING_CHANGE_SET` when an undecided change set exists, so work cannot be closed out while a proposal is unresolved. Also `INVALID_TASK_TRANSITION`, `TASK_SESSION_OWNERSHIP_LOST`.

### `synaphex_archive_task`

> **Destructive.** Requires **administrative authority** — not a session.

```json
{ "projectId": "prj_example", "taskId": "task_example" }
```

Moves the task from `tasks/open/` to `tasks/archive/`. **Archiving releases the task session and claim.**

This authority difference is deliberate: completion is done by whoever is doing the work, archival is an administrative action that does not require holding the claim.

Fails with `INVALID_TASK_TRANSITION` when the task is not completed.

## Error handling

Domain errors surface with a stable `code` you can branch on. Unrecognized internal errors collapse to `INTERNAL_ERROR`; stack traces, provider stderr, and credential state are never returned to the client. See [errors](errors.md).

## Related pages

- [Errors](errors.md)
- [Permissions](../security/permissions.md)
- [Change-set workflow](../workflows/coder-change-sets.md)
