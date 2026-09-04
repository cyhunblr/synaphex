# ADR 0002: MCP is a transport/interface layer, not an orchestrator

Status: accepted (Phase 1)

Synaphex is user-orchestrated: the user is the orchestrator, and there is no
central orchestrator agent. Exposing Synaphex over MCP does not change that.

```text
provider host
    |
    | MCP stdio
    v
Synaphex MCP adapter   <- thin transport/interface
    |
    v
existing Synaphex application/Core services   <- all business logic
```

The MCP server holds no business logic. Tool handlers validate input, call one
existing Core read service, and shape the result. Rule precedence
(`task > project > global`, then default deny) stays in `RuleResolver`; MCP
reports the `source` Core resolved and never recomputes it.

## Phase 1 is intentionally read-only

Phase 1 exposes deterministic read-only domain lookups only. It has no network,
no shell, no provider execution, no arbitrary filesystem API, no host actions
and no state mutation — and that holds even when launched from a powerful
provider host.

The guarantee is structural rather than documentary. Handlers depend only on the
read-only ports in `src/mcp/synaphex-read-ports.ts`, which declare read
operations exclusively, so no mutation, approval, host-action or
agent-invocation API is present in the composition to be called. Tests assert
this by inspecting both the injected dependency surface and the module imports.

MCP exposes Synaphex domain concepts, never generic filesystem access: there is
no `read_file`, `list_directory` or provider-config tool.

## Deliberate Phase-1 omissions

- **Agent invocation.** `invoke_*` tools are a later phase. They need separate
  design around direct-user semantics, caller identity, session/task binding,
  lifecycle, helper calls, approvals, requested actions and continuation, and
  must not be flattened into one premature tool.
- **Runtime status.** `RuntimeAvailability.probe()` spawns the provider CLI
  (`--version`, `--help`). Phase 1 forbids shell execution, so no runtime-status
  tool is registered. When it is added, it must preserve the distinction that
  *runtime available != execution policy supported* — `agy` probes as available
  while every Antigravity ExecutionPolicy remains unsupported (see ADR 0001).
- **Provider coupling.** No handler imports a provider executor; MCP operates
  over provider-independent services and never configures or calls provider MCP
  servers.

## Packaging

The stdio executable is an internal integration target for future
installer/provider configuration, published as the `synaphex-mcp-stdio` bin. It
is deliberately **not** a public `synaphex mcp` subcommand; the accepted
terminal-facing commands remain `synaphex install` and `synaphex uninstall`.
Installer registration is not implemented yet.

## Protocol discipline

```text
stdin  <- MCP protocol input
stdout -> MCP protocol output ONLY
stderr -> diagnostics
```

Diagnostics never go to stdout, because a single stray byte corrupts the
protocol stream. Errors reaching the client carry a stable code and a safe
message; stack traces, raw errors and provider/credential state stay out of the
transport and are written to stderr instead.

## Phase 2A: canonical session identity and task session binding

A Synaphex session is an explicit logical Synaphex resource. It is never
derived from an MCP connection or protocol session id, a provider conversation
or thread id (Claude/Codex/Antigravity), a process id, or `clientInfo`:

```text
MCP transport connection      != Synaphex Session
provider conversation/thread  != Synaphex Session
process PID                   != Synaphex Session
MCP protocol session metadata != Synaphex Session
```

`SessionId` is provider-neutral, formatted as `ses_<uuid without dashes>` to
match the existing `prj_`/`task_` convention, and encodes no provider, host,
process or conversation identity. `generateSessionId` mints one;
`parseSessionId` is the single canonical validator, which MCP calls directly
rather than defining a second grammar. `SessionId` stays a plain string so
pre-existing sessions and host-supplied identifiers keep working.

### Discovered model

A session has no standalone record: `state/sessions/<hash>.jsonc` stores a
*binding*, so `SessionManager.find` is binding lookup, and an unbound session
is indistinguishable from an unknown one (both `null`). Writable ownership is a
separate claim at `state/task-bindings/<taskId>.json`, guarded by an exclusive
lock, which is what enforces one writable session per task.

### `openTaskSession(projectId, taskId)`

Validates the project, validates the task within it, refuses `completed` and
`archived` tasks (matching `TaskOperations.resumeTask`), mints a fresh canonical
SessionId, binds the project, then claims the task through
`SessionManager.bindTask` — which retains ownership of the lock and the
invariant. A task already claimed by a live session raises Core's
`TaskAlreadyBoundError`; the claim is never stolen and no other session is
auto-unbound.

### `closeTaskSession(sessionId)`

Releases the task claim via `SessionManager.unbindTask`. This is **not** task
completion: task status, plans, memory and artifacts are untouched and no agent
runs. Per existing semantics the **project binding is retained**, so a
post-close `synaphex_get_session` reports `projectId` set and `taskId: null`.
Closing an unknown or already-closed session is a deterministic no-op.

### Lifetime is domain-owned, not process-owned

A logical session binding survives the death of the MCP subprocess or provider
host: bindings live in Synaphex state, so a restarted process still observes
the claim. This is deliberate — coupling domain lifecycle to process lifecycle
would let a transport detail redefine domain identity.

Consequences accepted in this slice:

- MCP disconnect is **not** an authoritative automatic unbind, and graceful
  shutdown does not implicitly close a session (both are tested).
- There is no `synaphex_get_current_session`; session identity is always passed
  explicitly, so a host restart or reconnect changes nothing.
- Stale-session recovery is **not** solved here. A session whose process died
  keeps its task claim until an explicit `synaphex_close_task_session`. There is
  deliberately no PID-based cleanup. `SessionManager` carries a pre-existing
  `TODO` for crash/stale-lock recovery; that remains open.

### Mutation boundary

MCP receives only `SessionCommandPort` (`openTaskSession`, `closeTaskSession`)
— never a mutation-capable `TaskManager`, `SessionManager` or `StateStore`. The
application layer owns validation, lifecycle checks, binding semantics and
atomic ordering; MCP validates wire input, calls a command, and maps the result.

`synaphex_open_task_session` and `synaphex_close_task_session` are annotated
`readOnlyHint: false` and `idempotentHint: false` (each open mints a new
SessionId), with `destructiveHint: false` because releasing a binding is
reversible and destroys no data, and `openWorldHint: false`.

### Protocol revision

Not changed in this slice. A manually constructed `Client`/`McpServer` on
`@modelcontextprotocol/server@2.0.0` negotiates **`2025-11-25`**, not the
modern `2026-07-28` era; using the v2 packages does not by itself opt in. The
stdio smoke test reports the negotiated revision and asserts only that the
modern era was not adopted. Real Claude/Codex host compatibility should be
tested before changing it. Note the public `Client.protocolVersion` getter is
`undefined` for a manually constructed client on this build; the value is
observable only via the protected `_negotiatedProtocolVersion`.

## Phase 2B: closure semantics and explicit recovery

Phase 2A left two inaccuracies and one naming ambiguity, all corrected here.

### Corrections

1. **Close idempotency.** `synaphex_open_task_session` is genuinely
   non-idempotent (each call mints a new SessionId) and keeps
   `idempotentHint: false`. `synaphex_close_task_session` is a deterministic
   no-op when repeated, so it now carries `idempotentHint: true`. The two no
   longer share one annotation object.
2. **Honest results.** Close no longer hardcodes `released: true`. It reports
   `{released, releasedTaskId}`, where `released` is true only when a task
   claim was actually removed. An unknown or already-closed session yields
   `released: false, releasedTaskId: null`. Force release reports the same way.
3. **Naming.** `closeTaskSession` now means *fully close the logical session*:
   release the task claim **and delete the binding record**. The Phase-2A shape
   — release the claim but permanently retain a project-only binding — is gone;
   accumulating "closed session" records served no architectural purpose, and
   task/artifact/memory history has separate ownership. No standalone session
   history subsystem was added.
   `SessionManager` gains `findBinding(sessionId)` as the unambiguous name;
   `find()` remains, marked `@deprecated`, because accepted tests use it. New
   code uses `findBinding`.

Compatibility consequence: `SessionCommandPort.closeTaskSession` changed its
return type from `SessionBinding` to `SessionCloseResult`, and the MCP tool's
output shape changed. Both were unreleased internal APIs introduced in Phase
2A, consumed only by Synaphex itself, so no external contract broke.

### Lifecycle

```text
openTaskSession  -> binding record + task claim, projectId and taskId set
closeTaskSession -> claim released, binding record deleted, no state retained
```

Consequently `synaphex_get_session` on a closed SessionId reports
`bound: false, projectId: null, taskId: null`.

### Recovery is explicit, never automatic

```text
Synaphex session lifetime is explicit.
Transport lifetime does not control domain lifetime.
Recovery is explicit user-driven force release.
No automatic lease/heartbeat exists.
```

There is **no** lease expiry, heartbeat, PID check, MCP-disconnect cleanup,
provider-conversation cleanup or automatic stale-session expiration — a logical
session is not a process lease. A host may restart, disconnect, idle or
reconnect without releasing anything. A test asserts none of these mechanisms
exist in the MCP or session-command sources.

Two tools serve recovery:

- `synaphex_get_task_session_owner` — read-only; reports `claimed` plus the
  owning `sessionId`. The owner id is disclosed deliberately: on a local,
  user-orchestrated stdio system recovery needs a discoverable owner. The
  `TASK_ALREADY_BOUND` conflict error still withholds it.
- `synaphex_force_release_task_session` — takes only `projectId` and `taskId`,
  because the recovery case is precisely that the caller lost the SessionId.
  There is no `force: true` boolean; calling the tool *is* the explicit action.

A normal `openTaskSession` against an occupied task still fails with
`TASK_ALREADY_BOUND` and never escalates to a force release (tested with
repeated failed opens).

### Annotations

| Tool | readOnly | idempotent | destructive |
|---|---|---|---|
| `synaphex_get_*` | true | true | false |
| `synaphex_open_task_session` | false | false | false |
| `synaphex_close_task_session` | false | true | false |
| `synaphex_force_release_task_session` | false | true | **true** |

Force release is marked destructive because it terminates *another* logical
session's ownership and deletes that session's binding record — the
conservative choice, so hosts can gate it behind confirmation. Note the MCP
spec treats all annotations as untrusted hints.

### Concurrency

Both `closeSession` and `forceReleaseTaskClaim` run inside the pre-existing
task-binding ownership lock; no second lock was introduced. Verified:

- concurrent opens → exactly one winner;
- force release racing an open → claim and binding always agree, never
  "claim owned by A, binding owned by B" (12 rounds);
- concurrent force releases → exactly one real release, the rest no-ops;
- normal close racing force release → both succeed, exactly one releases, end
  state fully clean (12 rounds).

### Failure ordering and residual crash window

Synaphex state is two files — the session binding and the task claim — and the
filesystem offers no multi-file transaction. That is not papered over.

Both operations remove the **claim first, then the binding record**. If the
process dies between the two writes, the claim is already gone and the leftover
binding is inert: it names a task nothing claims, so no phantom ownership can
arise, and the task is immediately reclaimable. The reverse order would leave a
claim whose owning binding vanished.

That reverse state can still arise from an external event (manual state
deletion, partial restore). It is handled rather than assumed away:
`findTaskOwnerWhileLocked` cross-validates every claim against its owner's
binding and **self-heals** by deleting an orphaned claim, reporting no owner. A
test simulates exactly this and confirms the task is reclaimable with no force
release needed.

**Residual window:** a crash after claim removal but before binding deletion
leaves one inert binding record that nothing collects. It grants no ownership
and blocks nothing, but it is not garbage-collected in this slice.

### Authorization

Still local stdio only. Force release has **no** authorization check: any
caller reaching the server can release any task claim. This is acceptable
because the transport is local and user-controlled. **Before any remote
transport, this operation requires an authorization review** — it is the most
privileged tool in the surface.

## Phase 2C: task ownership fencing for AgentInvocationService

```text
Task claim instance carries an opaque fencing token.
Task-bound agent invocation captures that token before execution.
ResultProcessor revalidates exact ownership immediately before mutation.
Revoked/replaced ownership invalidates stale results.
```

A task-bound invocation can run for minutes, during which the user may
explicitly close or force-release the task session and reopen the task under a
new session. Without fencing, the older invocation could still finish and pass
its AgentResult to `ResultProcessor`. The authoritative rule:

> An invocation may mutate Synaphex task-scoped state only while the exact
> task-ownership claim under which it started is still current.

This is fencing, not a lease. No heartbeat, TTL, lease expiry, PID ownership,
MCP-connection ownership, provider-conversation ownership or automatic stale
cleanup was added; session lifetime remains explicit and user-controlled.

### Why SessionId is not sufficient

SessionId alone would permit ABA: release a claim, rebind the same SessionId,
and a stale fence would still "match". Each successful `bindTask` therefore
persists an opaque `ownershipToken` (32 hex chars from `randomUUID`) on the
`TaskBindingClaim`, identifying the *claim instance* rather than the task,
session or binding record. It is provider-neutral and derived from nothing —
not PID, provider, conversation or session identity — so releasing and
reclaiming always yields a different token.

### Persisted-claim compatibility

`ownershipToken` is optional on read, so claims written before fencing existed
remain readable and continue to resolve ownership normally. A legacy claim is
upgraded in place — a fresh token written under the **existing** ownership lock
— the first time `captureTaskOwnership` runs for it. No deterministic fallback
token is synthesised, because a predictable token would reintroduce ABA. A
token that is present but malformed invalidates the claim rather than passing:
`findTaskOwnerWhileLocked` then self-heals by removing it.

### Fence capture and revalidation

`SessionManager.captureTaskOwnership(sessionId)` returns a
`TaskOwnershipFence { projectId, taskId, sessionId, ownershipToken }` or `null`.
`isTaskOwnershipCurrent(fence)` reports whether that exact claim instance is
still current — false if the task is unclaimed, the session closed, the task was
force-released, another session owns it, the same SessionId owns a *new* claim
with a different token, or claim and binding no longer cross-validate. Both run
under the pre-existing task-binding lock; no competing lock was introduced.

The pipeline in `invokePrepared` — the single funnel for user, helper and
continuation invocations — is:

```text
binding/lifecycle preflight
→ config → context → policy → routing
→ CAPTURE ownership fence        (task-bound invocations only)
→ executor
→ validate AgentResult
→ classify helper calls / actions
→ REVALIDATE ownership fence     (last authoritative check)
→ ResultProcessor
```

Because every path funnels through `invokePrepared`, a helper captures its
**own** current fence rather than inheriting the caller's, and a continuation
(`resumeCaller`, action-approval resume) re-runs preflight and captures fresh
authority. Old invocation lineage metadata never resurrects revoked authority.

Project-only invocations have no task authority to fence and are untouched;
task sessions are not made mandatory for this feature.

### Behavior when ownership is lost

A typed `TaskSessionOwnershipLostError` (`TASK_SESSION_OWNERSHIP_LOST`,
`details.phase` = `preflight` | `commit`) is thrown, matching the service's
dominant convention of throwing typed errors. Nothing commits: no artifacts, no
memory, no plan draft, no task completion, no Questioner context, no Reviewer
lifecycle effects. It is deliberately distinct from `TASK_ALREADY_BOUND` (which
means a task cannot be claimed) and is never collapsed into
`AGENT_EXECUTION_FAILED` or `INTERNAL_ERROR` — the provider did complete; the
caller's authority was revoked before commit. The replacement owner's SessionId
is not disclosed.

### Force release during an invocation

Phase 2B semantics are unchanged: force release is not blocked merely because
an invocation is running, and no invocation registry or lease was added. The
claim disappears, the running invocation's fence becomes invalid, and its
result cannot commit. That is the Core-state correctness mechanism.

### Token secrecy

`ownershipToken` is internal authority state, never a user-facing credential.
It is not exposed through `synaphex_get_session`,
`synaphex_get_task_session_owner`, the open-session result, MCP errors,
artifacts, `AgentContext` or provider prompts. Tests assert no MCP module even
references it, and that it never appears in provider input. SessionId remains
the user-facing logical identity.

### CODER limitation — authoritative

Fencing protects **Synaphex state**. It does **not** roll back filesystem
changes a CODER may already have made in the real source workspace before
ownership was revoked:

```text
stale task-bound invocation → fenced → cannot commit Core/task state
CODER filesystem effects    → NOT transactionally fenced by this mechanism
```

This slice therefore does **not** establish safe MCP exposure for CODER. Future
MCP invocation work must treat CODER separately until one of these exists:
invocation cancellation with enforceable termination, an isolated transactional
workspace/staging area, or another deterministic source-mutation ownership
boundary. Force-release semantics must not be weakened to compensate.

### Crash window

Claim writes remain single-file, so the token adds no new multi-file window.
The legacy-claim upgrade rewrites one file under the ownership lock; a crash
mid-upgrade leaves the prior claim content intact and the upgrade simply
re-runs. The Phase-2B residual window (an inert binding record after a crash
between claim removal and binding deletion) is unchanged. The invariant holds:
no phantom ownership ever silently blocks or redirects authority.

## Phase 3A: host context and source-read-only agent invocation

```text
MCP HostContext is immutable process configuration.
It is distinct from Synaphex SessionId.
Top-level local stdio invocation represents a direct user invocation.
Agent helper requests remain subject to Synaphex agent->agent rules.
```

### HostContext

Host identity reuses Core's existing `HostRuntime` (`{provider, surface}`)
rather than introducing a parallel type. It describes *where the user is
interacting with Synaphex*, not the target agent's configuration, and carries
no model, sessionId, conversationId or PID.

```text
Synaphex Session != MCP connection != provider host identity
```

It is parsed once at startup from internal arguments
(`--host-provider`, `--host-surface`), validated against the supported
combinations, and immutable for the server's lifetime. It is never inferred
from MCP `clientInfo`, process name, PID, conversation/thread id, model output,
tool input or SessionId — otherwise a model or tool argument could spoof
ProviderRouter's routing context. `clientInfo` is diagnostic only, never
routing authority.

Supported host combinations are `openai/{cli,vscode}`,
`anthropic/{cli,vscode}` and `google/cli`. `google/vscode` is absent:
Antigravity IDE is not a Synaphex host integration (ADR 0001), and Google VS
Code support is not invented here. Host identity and target executability are
separate questions — `google/cli` is a valid *host* even though every
Antigravity ExecutionPolicy is unsupported as a *target*.

These are internal integration arguments for future installer-generated MCP
configuration. There is still no public `synaphex mcp` command; the accepted
terminal-facing commands remain `synaphex install` and `synaphex uninstall`.
Installer registration is not implemented.

### Invocation-origin trust assumption

A top-level MCP invocation enters the existing **direct-user** entrypoint
(`invokeUserAgent`). Accepted semantics therefore apply: the top-level target
bypasses the configurable agent→agent edge rule while still obeying lifecycle,
config, routing, ExecutionPolicy, provider-capability policy and Phase-2C
ownership fencing. Helper requests the agent returns are still classified
through normal agent→agent rules.

The wire schema has no `directUser`, `caller`, `callerAgent`, `hostProvider` or
`hostSurface` field, so an MCP client or model cannot impersonate another
Synaphex caller or supply host identity; the server chooses the entrypoint.

**This is acceptable only because MCP is currently local stdio with a
user-controlled integration. Before any remote MCP transport,
invocation-origin and authentication must be reviewed again.**

### Exposed agents

`synaphex_invoke_agent` is one generic tool, not five. Its agent enum is
exactly `questioner`, `researcher`, `examiner`, `planner`, `reviewer`, so
**CODER is rejected by schema validation** before any application code, the
invocation service or a provider runs. There is no hidden `allowCoder`,
`unsafe` or `force` flag.

```text
CODER is intentionally not exposed through MCP Phase 3A.
```

Reason:

```text
Phase 2C fencing protects Synaphex state but cannot roll back
filesystem changes already performed by CODER.
```

"Source-read-only" means these five must not modify the user's *source
workspace* — not that they make no Synaphex mutation. Questioner context,
research artifacts, canonical memory, plan drafts, review artifacts and
Reviewer task completion are all still possible, and are protected by Phase-2C
fencing. As defence in depth, the application port fails closed if any exposed
role ever resolves to `workspace_write`.

### Scope

Scope is a discriminated union carrying only a `sessionId`; the authoritative
Core binding resolves project and task, so a contradictory
`projectId + taskId + sessionId` triple cannot be expressed. Role/scope
eligibility stays in Core: `taskBinding: "optional"` (researcher, examiner)
permits project scope, and `"required"` roles raise `NoTaskBoundError`. MCP
only checks the wire shape, plus one guard that a `project`-scope request is
not made against a task-bound session.

Session ids use Core's `parseSessionId`; there is no MCP-local grammar.

### Result, helpers and actions

The result maps the existing `AgentInvocationResult` to a safe shape: agent,
outcome, summary, scope, route (including host), source-modification decision,
lineage, warnings/persisted-artifact/state-effect references, and classified
`requestedCalls` / `requestedActions`. Deliberately omitted: the ownership
token, provider credentials, raw provider stderr, auth metadata, stack traces,
process diagnostics and temp paths.

Classifications are **reported, never executed** — the user remains the
orchestrator. MCP does not auto-run an allowed helper, auto-approve network, or
execute `git_push`/`ci`. No helper-execution, action-approval, cancellation or
invocation-status tool exists yet.

An agent outcome of `needs_user` / `blocked` / `error` is a **successful** tool
call carrying that outcome; only a Synaphex invocation failure maps through
MCP-safe error handling. `TASK_SESSION_OWNERSHIP_LOST` keeps its stable code
(never `INTERNAL_ERROR`) and does not disclose the replacement owner.
`AGENT_EXECUTION_FAILED` is reported with a generic message so provider stderr,
command arguments and environment never reach the client.

### Native VS Code routes

VS Code extensions remain interactive host surfaces, not callable targets. A
CLI host targeting a vscode surface fails with `INVALID_PROVIDER_ROUTE`. A
same-provider vscode→vscode route resolves as `same_provider_native`, but **no
executor dispatches it**: all three CLI executors reject
`effectiveSurface !== "cli"`, so it fails deterministically rather than
spawning a CLI while claiming the vscode surface. That gap is pre-existing and
unchanged here.

### Synchronous execution

Invocation is an ordinary synchronous MCP request in this slice — no MCP tasks,
background registry, polling, detached execution, cancellation or status
endpoint. A long provider call therefore occupies a tool request, which is
accepted for Phase 3A.

### Provider composition gap

Synaphex has no composite provider-dispatching `AgentExecutor`. Rather than
building one inside MCP (which would couple MCP to provider adapters), the
stdio entrypoint accepts an injected executor and runtime availability. Absent
one, invocation fails closed instead of guessing a provider. Wiring real
provider dispatch belongs with the installer work.
