# Error reference

Synaphex returns a stable `code` you can branch on. This page documents the
**63 error codes exposed over MCP** — the complete public set.


## Reference index

- [CLI](cli.md)
- [MCP tools](mcp-tools.md)
- **Errors**
- [Filesystem layout](filesystem-layout.md)
- [Compatibility](compatibility.md)

## How errors are layered

Three different things can fail, and they surface differently:

| Layer | What it is | What you see |
| --- | --- | --- |
| **Domain error** | A Synaphex rule or state check refused the operation | A stable code from the table below, plus a short safe message |
| **MCP protocol wrapper** | Malformed tool input, before any domain logic | An input-validation failure naming the offending field |
| **Provider execution error** | The provider CLI itself failed | `AGENT_EXECUTION_FAILED` — deliberately generic |

Only codes on the exposed allowlist are returned. **Anything else collapses to `INTERNAL_ERROR`.** Stack traces, `cause` chains, provider stderr, command arguments, and environment values are never sent to the client — diagnostics go to the server's stderr instead. Do not expect to parse internal detail out of an MCP error.

`AGENT_EXECUTION_FAILED` is generic on purpose: provider stderr can contain credentials, so it is not forwarded.

---

## Project, task, and session

| Code | Meaning | Typical cause | Safe next action |
| --- | --- | --- | --- |
| `PROJECT_NOT_FOUND` | No such project | Stale or wrong `projectId` | List projects and re-read the id |
| `TASK_NOT_FOUND` | No such task | Stale or wrong `taskId` | Re-read the task id |
| `PROJECT_PATH_NOT_FOUND` | Source path does not exist | Directory moved or deleted | Re-register at the correct path |
| `PROJECT_PATH_ALREADY_REGISTERED` | Path is already a project | Duplicate registration | Use the existing project |
| `INVALID_PROJECT_PATH` | Path is not a usable directory | File instead of a directory | Point at a real directory |
| `INVALID_TASK_DESCRIPTION` | Description empty | Blank description | Provide a non-empty description |
| `INVALID_SESSION_ID` | Session id malformed or unknown | Expired or fabricated id | Open a new session |
| `NO_PROJECT_BOUND` | Session has no project | Wrong session for the operation | Open a project session |
| `NO_TASK_BOUND` | Session has no task | Task-scoped call on a project session | Open a task session |
| `SESSION_ALREADY_BOUND_TO_TASK` | Session already bound | Rebinding an in-use session | Use the existing binding or a new session |

## Ownership and lifecycle

| Code | Meaning | Typical cause | Safe next action |
| --- | --- | --- | --- |
| `TASK_ALREADY_BOUND` | Another live session owns this task | Two hosts on one task | Check the owner; release only if genuinely abandoned |
| `TASK_SESSION_OWNERSHIP_LOST` | Ownership ended before commit | Session closed, or claim force-released | Re-open a task session and redo the step |
| `TASK_BINDING_LOCK_TIMEOUT` | Could not acquire binding lock | Concurrent binding activity | Retry shortly |
| `TASK_COMPLETED` | Task is completed | Reopening completed work | Create a new task — there is no reopen |
| `TASK_ARCHIVED` | Task is archived | Reopening archived work | Create a new task — there is no unarchive |
| `INVALID_TASK_TRANSITION` | Illegal lifecycle move | Archiving a task that is not completed | Complete before archiving |
| `TASK_HAS_PENDING_CHANGE_SET` | Undecided change set exists | Completing with a proposal open | Apply or reject the change set first |

## Agent configuration and routing

| Code | Meaning | Typical cause | Safe next action |
| --- | --- | --- | --- |
| `AGENT_UNCONFIGURED` | No target configured for that agent | Agent left unconfigured | Configure it in `agent_config.jsonc` |
| `AGENT_CONFIGURATION_REMOVED` | Config disappeared mid-flight | Edited during an invocation | Re-check config and retry |
| `INVALID_PROVIDER_ROUTE` | Target unreachable from this host | Unsupported host/target combination | See [providers and routing](../concepts/providers-and-routing.md) |
| `AGENT_TARGET_SURFACE_UNSUPPORTED` | Target surface is not executable | Agent configured with `surface: "vscode"` | Configure a `cli` target; see [agent config](../configuration/agent-config.md) |
| `NATIVE_HOST_EXECUTION_UNAVAILABLE` | Route valid, native execution absent | Expecting in-host execution | Configure the agent for `cli` execution |
| `UNSUPPORTED_AGENT_INVOCATION` | Agent/scope not invocable here | Wrong scope kind for that agent | Use the correct scope |
| `PROVIDER_CLI_UNAVAILABLE` | Provider CLI missing or too old | Not installed, or below minimum | See [compatibility](compatibility.md) |
| `PROVIDER_EXECUTION_POLICY_UNSUPPORTED` | Provider cannot enforce the required execution policy for a single invocation | Runtime exposes only persistent, provider-owned policy settings | Use a provider with invocation-scoped policy control; see [compatibility](compatibility.md#google--antigravity) |
| `AGENT_EXECUTION_FAILED` | Provider execution failed | Provider error, timeout, or crash | Check server stderr; retry |
| `INVALID_AGENT_RESULT` | Result did not match contract | Provider returned malformed output | Retry; narrow `outputFields` if persistent |
| `ARTIFACT_NOT_FOUND` | A referenced artifact does not exist | A handoff cited an artifact id that was never persisted | Re-run the requesting agent so it cites a real artifact; never hand-write ids |

## Rules

| Code | Meaning | Typical cause | Safe next action |
| --- | --- | --- | --- |
| `INVALID_RULE` | Rule state invalid | Malformed `rules.jsonc` | Fix the file; see [rules](../configuration/rules.md) |
| `INVALID_RULE_VALUE` | Rule value invalid | Decision other than `allow`/`ask`/`deny` | Use a valid decision |

## Plans

| Code | Meaning | Typical cause | Safe next action |
| --- | --- | --- | --- |
| `PLAN_DRAFT_PENDING` | A draft awaits decision, blocking CODER | Invoking CODER, or completing the task, before deciding the draft | Accept or reject the draft |
| `NO_PLAN_DRAFT` | No draft exists | Deciding with nothing pending | Run PLANNER first |
| `PLAN_ALREADY_ACCEPTED` | Plan already accepted | Duplicate acceptance | Read plan state |
| `PLAN_DRAFT_REVISION_MISMATCH` | Revision id is stale | Draft changed after you read it | Re-read and review the current draft before deciding |
| `INVALID_PLAN_CONTENT` | Plan content invalid | Malformed plan payload | Re-run PLANNER |
| `PLAN_MUTATION_LOCK_TIMEOUT` | Could not acquire plan lock | Concurrent plan activity | Retry shortly |

## CODER staging

| Code | Meaning | Typical cause | Safe next action |
| --- | --- | --- | --- |
| `CODER_STAGING_REQUIRES_GIT` | Project is not a Git repository | No repo at the source path | `git init` and commit a baseline |
| `CODER_STAGING_WORKTREE_DIRTY` | Uncommitted changes present | Dirty tree at invocation | Commit or stash your own work first |
| `CODER_STAGING_UNSUPPORTED_REPOSITORY` | Repository shape unsupported | Unsupported index or layout | See [CODER isolation](../security/coder-isolation.md) |
| `CODER_STAGING_FAILED` | Staging could not complete | Git or filesystem failure during staging | Check disk and permissions; retry |

## Change sets and apply

| Code | Meaning | Typical cause | Safe next action |
| --- | --- | --- | --- |
| `CHANGE_SET_NOT_FOUND` | No such change set | Wrong or stale id | Re-read the id |
| `CHANGE_SET_CORRUPT` | Integrity check failed | Patch hash or size mismatch | Do not apply; re-run CODER |
| `CHANGE_SET_NOT_AUTHORIZED` | Session lacks authority | Wrong session | Use the owning task session |
| `CHANGE_SET_NOT_CURRENT_TARGET` | Not the latest authoritative target | Deciding a superseded change set | Read the current target and decide on it |
| `CHANGE_SET_ALREADY_DECIDED` | Already applied or rejected | Duplicate decision | Read its state |
| `CHANGE_SET_SOURCE_HEAD_CHANGED` | HEAD moved off the recorded base | Commits since capture | Re-run CODER against current HEAD |
| `CHANGE_SET_SOURCE_DIRTY` | Worktree not clean | Local edits present | Commit or stash your own work |
| `CHANGE_SET_APPLY_CHECK_FAILED` | Patch will not apply | Source drifted | Re-run CODER against current HEAD |
| `CHANGE_SET_APPLY_INTERRUPTED` | Apply was interrupted | Crash mid-apply | Read recovery state, then reconcile |
| `CHANGE_SET_APPLY_RECOVERY_REQUIRED` | Blocked pending reconciliation | Unreconciled interrupted apply | Reconcile before continuing |
| `CHANGE_SET_NOT_INTERRUPTED` | Not in interrupted state | Reconciling a healthy change set | No action needed |
| `SOURCE_MUTATION_LOCK_TIMEOUT` | Could not acquire source lock | Concurrent apply activity | Retry shortly |

> Recovery is driven by observed source state. Synaphex never runs `git reset --hard` or `git clean` for you, and you should not reach for them as a default. See [interrupted-apply recovery](../workflows/interrupted-apply-recovery.md).

## Review targets

| Code | Meaning | Typical cause | Safe next action |
| --- | --- | --- | --- |
| `REVIEW_TARGET_NOT_AVAILABLE` | No CODER work record to review | REVIEWER before CODER | Run CODER first |
| `REVIEW_TARGET_NOT_APPLIED` | Target not applied to source | Reviewing an unapplied change set | Apply it first, or review the patch |
| `REVIEW_TARGET_CHANGED` | Target changed since capture | Source moved under the review | Re-read the current target |
| `REVIEW_TARGET_REJECTED` | Target was rejected | Reviewing rejected work | Re-run CODER |
| `REVIEW_TARGET_APPLY_INTERRUPTED` | Target's apply was interrupted | Unreconciled apply | Reconcile first |

## Memory references

| Code | Meaning | Typical cause | Safe next action |
| --- | --- | --- | --- |
| `MEMORY_ALREADY_LOADED` | That source is already loaded here | Duplicate load | No action needed; it is already visible |
| `MEMORY_NOT_LOADED` | That source is not loaded here | Unloading something never loaded | Check what is loaded first |
| `MEMORY_LOAD_CYCLE` | The reference would form a cycle | Loading a scope that already references this one | Load a different source |
| `MEMORY_SOURCE_NOT_FOUND` | The referenced memory source does not exist | Wrong project or task reference | Re-read the id |
| `AMBIGUOUS_PROJECT_REFERENCE` | A project name matches more than one project | Ambiguous name used | Use the project id |
| `AMBIGUOUS_TASK_REFERENCE` | A task reference matches more than one task | Ambiguous slug used | Use the task id |

> Loading records a reference; it never writes canonical memory. Canonical
> memory changes remain EXAMINER-only.

## Related pages

- [MCP tools](mcp-tools.md)
- [Compatibility](compatibility.md)
- [Security model](../security/security-model.md)
