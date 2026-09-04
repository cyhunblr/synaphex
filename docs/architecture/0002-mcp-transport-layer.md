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

### `closeSession(sessionId)`

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
  keeps its task claim until an explicit `synaphex_close_session`. There is
  deliberately no PID-based cleanup. `SessionManager` carries a pre-existing
  `TODO` for crash/stale-lock recovery; that remains open.

### Mutation boundary

MCP receives only `SessionCommandPort` (`openTaskSession`, `closeSession`)
— never a mutation-capable `TaskManager`, `SessionManager` or `StateStore`. The
application layer owns validation, lifecycle checks, binding semantics and
atomic ordering; MCP validates wire input, calls a command, and maps the result.

`synaphex_open_task_session` and `synaphex_close_session` are annotated
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
   `idempotentHint: false`. `synaphex_close_session` is a deterministic
   no-op when repeated, so it now carries `idempotentHint: true`. The two no
   longer share one annotation object.
2. **Honest results.** Close no longer hardcodes `released: true`. It reports
   `{released, releasedTaskId}`, where `released` is true only when a task
   claim was actually removed. An unknown or already-closed session yields
   `released: false, releasedTaskId: null`. Force release reports the same way.
3. **Naming.** `closeSession` now means *fully close the logical session*:
   release the task claim **and delete the binding record**. The Phase-2A shape
   — release the claim but permanently retain a project-only binding — is gone;
   accumulating "closed session" records served no architectural purpose, and
   task/artifact/memory history has separate ownership. No standalone session
   history subsystem was added.
   `SessionManager` gains `findBinding(sessionId)` as the unambiguous name;
   `find()` remains, marked `@deprecated`, because accepted tests use it. New
   code uses `findBinding`.

Compatibility consequence: `SessionCommandPort.closeSession` changed its
return type from `SessionBinding` to `SessionCloseResult`, and the MCP tool's
output shape changed. Both were unreleased internal APIs introduced in Phase
2A, consumed only by Synaphex itself, so no external contract broke.

### Lifecycle

```text
openTaskSession  -> binding record + task claim, projectId and taskId set
closeSession -> claim released, binding record deleted, no state retained
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
| `synaphex_close_session` | false | true | false |
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

## Phase 3B: provider executor dispatch

```text
ProviderRouter decides the route.
ProviderDispatchingAgentExecutor executes callable routes.
```

`ProviderDispatchingAgentExecutor` implements the existing `AgentExecutor`
interface and receives an already-resolved `ExecutionRoute`. The route is
authoritative: the dispatcher resolves no routing, rules or ExecutionPolicy,
chooses no model, re-reads no agent configuration, does not touch HostContext,
and performs no fallback. It selects a delegate and forwards the identical
`AgentExecutionInput`, so each adapter's sandbox, network, structured-output,
authentication and process semantics stay untouched.

```text
openai    + cli    -> CodexCliAgentExecutor
anthropic + cli    -> ClaudeCliAgentExecutor
google    + cli    -> AntigravityCliAgentExecutor
any provider + vscode -> NATIVE_HOST_EXECUTION_UNAVAILABLE (fail closed)
unknown provider      -> INVALID_PROVIDER_ROUTE (never substituted)
```

### No fallback, ever

There is no "Claude unavailable → try Codex", no "CLI missing → try another
provider", and no "Antigravity unsupported → use another Google runtime".
Failure is preferred over silently changing execution identity. A delegate
throwing does not cause any other delegate to run (tested).

Runtime availability probing stays separate from execution: the dispatcher
never probes, and there is no pre-flight executable fallback. `ProviderRouter`
alone consults availability when deciding whether to return a CLI route.

### VS Code is a host surface, not a callable runtime

```text
VS Code is a host surface, not an externally callable provider runtime.
Valid same-provider-native routes currently fail closed until a native bridge exists.
```

`same_provider_native` (host and target both the same provider on `vscode`) is
a legitimate routing outcome, but Synaphex has no bridge from the MCP
subprocess into an active VS Code extension. It therefore fails with
`NATIVE_HOST_EXECUTION_UNAVAILABLE` rather than being downgraded to the
provider CLI — reporting a CLI run as native VS Code execution would
misrepresent what executed.

That code is deliberately distinct from `INVALID_PROVIDER_ROUTE` (the router
rejected the route) and `PROVIDER_CLI_UNAVAILABLE` (a CLI runtime is missing):
here the route is valid and only execution support is absent. A future native
bridge may need provider-native skill/command integration, a host-mediated
callback/handoff, or another explicit native-host protocol. That mechanism is
not designed here.

### Composition

`stdio-main` is the composition root and the only module permitted to construct
concrete provider adapters. It builds all three accepted CLI executors over one
shared `SpawnProcessRunner` (stateless per call; every adapter passes its own
capture limits and timeouts per invocation, and `shell: false` is preserved),
wraps them in the dispatcher, and injects that single provider-independent
executor into `AgentInvocationService`.

```text
stdio-main (composition root)
    -> provider dispatcher
        -> provider adapters
```

MCP tool handlers hold only the narrow invocation port; a test asserts no MCP
module outside the composition root references any concrete provider executor
or the `providers/` directory at all.

### Antigravity through the dispatcher

Dispatch to the Antigravity adapter succeeds, and the adapter then applies its
own accepted security resolver — which still fails closed for every
ExecutionPolicy combination, before any model spawn. This is not special-cased
in the dispatcher. A test wires the real adapter with a process runner that
throws if `agy` is ever spawned, and confirms the refusal arrives as
`unsupported_execution_policy` with no spawn.

### Project-only invocation usability

`{kind: "project", sessionId}` takes a SessionId rather than a ProjectId
because Core's invocation entrypoint resolves scope from the authoritative
session binding; a ProjectId would reintroduce the mismatched-identity problem
Phase 3A removed. The wire shape is unchanged.

However:

```text
project-only agent invocation is implemented
but is not yet self-service through MCP
```

`synaphex_open_task_session` is the only session-creating tool and it always
binds a task, so a project-only session must currently be created outside MCP.
No tool was added for this in this slice.

## Phase 3C: trusted continuations and explicit approval

```text
USER IS THE ORCHESTRATOR
```

A helper is never auto-executed and an action is never auto-approved. Each
continuation step is an explicit, one-time, invocation-scoped tool call.

### Native-host error identity (opening correction)

`AgentInvocationService` wrapped every executor error as
`AGENT_EXECUTION_FAILED`, which hid the Phase-3B native-host condition. It now
rethrows `NativeHostExecutionUnavailableError` before that wrapping, because no
provider ever ran — this is an infrastructure capability gap, not a provider
failure. The three identities stay distinct end-to-end:

```text
INVALID_PROVIDER_ROUTE            route itself invalid
NATIVE_HOST_EXECUTION_UNAVAILABLE route valid, no native VS Code bridge
AGENT_EXECUTION_FAILED            a callable provider actually failed
```

### Trusted continuation store

The MCP client receives only an opaque `cont_<32 hex>` handle plus a bounded
request index. It never resends `requestedCall`, `requestedAction`,
`classification`, `callerAgent`, `targetAgent`, `reason`, `purpose`, `lineage`,
`route`, `executionPolicy` or host identity as authority — those live
server-side, having come from a previous trusted invocation result, so a client
cannot alter them. The wire schemas contain no such field at all (asserted by
test).

The handle is cryptographically random and derived from nothing: not SessionId,
lineage, provider, agent, PID, MCP connection or conversation id. It is **not**
a SessionId and never passes through `parseSessionId`.

```text
Synaphex Session survives MCP restart.
Invocation continuation does not.
```

The store is ephemeral, in-memory and process-local, matching the already
ephemeral helper-approval and provider-capability-approval semantics. Nothing is
persisted to Synaphex state, and there is no lease, heartbeat, TTL expiry,
background sweeper or durable registry. On restart, handles are lost with
`CONTINUATION_NOT_FOUND` and the user may repeat the original invocation; the
Synaphex session itself is unaffected (both proven by a two-process test).

Capacity is bounded (default 64) with ONE record per originating invocation —
not per request. Nothing is allocated when no request is actionable. Exhaustion
raises `CONTINUATION_CAPACITY_EXHAUSTED` rather than silently evicting a
still-pending user continuation. Records are bound to the immutable
`HostRuntime` they were created under and are invisible from any other host.

### State machine

```text
ORIGIN_PENDING
  |- execute allowed helper         -> HELPER_COMPLETED
  |- approve + execute asked helper -> HELPER_COMPLETED
  |- approve network action         -> CONSUMED (new handle if actionable)

HELPER_COMPLETED
  |- resume caller                  -> CONSUMED (new handle if actionable)
```

Illegal transitions fail deterministically: resume before helper execution,
executing the same helper twice, approving the same action twice, and resuming
twice are all refused.

### The four tools

- `synaphex_execute_helper` — executes a helper whose SERVER-SIDE
  classification is `allowed`. This is orchestration, not approval: an
  `approval_required` edge is refused.
- `synaphex_approve_and_execute_helper` — explicitly approves ONE
  `approval_required` helper and executes it. One-time and invocation-scoped;
  no rule moves from `ask` to `allow`, and there is no `rememberApproval`,
  `alwaysAllow` or `changeRule` option.
- `synaphex_resume_caller` — explicitly resumes the caller after a helper
  completed. A fresh execution with a continuation handoff; no provider thread
  reuse and no resurrection of old authority.
- `synaphex_approve_network_action` — explicitly approves ONE
  `approval_required` provider-capability `network` action and resumes the
  caller with a one-time grant. No rule or provider-setting mutation.

Denied, forbidden and unavailable requests can never be progressed, whatever
index is supplied; server-side classification always wins.

A helper result does **not** auto-resume the caller, and nested requests
returned by a helper are classified only — never recursively executed. Core
remains authoritative for the maximum invocation depth.

### Host actions remain unsupported

`git_push` and `ci` are Synaphex host actions with a separate architecture, and
there is still no real `HostActionExecutor`. No `synaphex_approve_git_push`,
`synaphex_approve_ci` or `synaphex_execute_host_action` was added — an approval
tool would be meaningless without an executor. Their classifications are still
returned for reading.

### The `network = allowed` gap

`resumeCallerWithActionApproval` hard-rejects any status other than
`approval_required` (`InvalidActionContinuationError`). Core therefore has **no**
continuation path for an already-`allowed` network action, and that API was
deliberately not misused to manufacture an approval where none was required.
Such an action stays classified and readable. **Reported gap:** if an agent must
be re-run with an already-permitted capability, Core needs a no-approval
continuation entrypoint.

### Failure and consumption ordering

Validation failures (unknown handle, wrong host, illegal state, bad index,
wrong classification, forbidden helper target) occur BEFORE any provider
execution and leave the record pending. A helper spawn failure also leaves it
pending and retryable, because no trusted transition occurred. A successful
helper execution marks that request consumed so it cannot run twice. A
successful caller resume or network approval consumes the record, and only then
is a NEW handle issued for the resulting generation — the consumed id is never
reused as authority. This is safe ordering, not distributed transactionality.

### Source-read-only helper boundary

Beyond the normal helper permission classification, any helper executed through
MCP must resolve to `sourceModification = read_only`. A continuation handle
must never become a route to a workspace-write helper: if an exposed agent
requests CODER and the edge somehow classifies allowed, MCP still refuses with
`UNSUPPORTED_AGENT_INVOCATION` before dispatch. `MCP_INVOCABLE_AGENTS` is
unchanged — no CODER source mutation through a helper loophole.

### Ownership fencing

No fencing logic was added to MCP. Every helper execution, caller resume and
network-approved resume goes through existing AgentInvocationService paths and
therefore captures and revalidates a fresh ownership fence. A force release
between steps still yields `TASK_SESSION_OWNERSHIP_LOST`, with no auto-reclaim.

### Trust assumption

`synaphex_approve_and_execute_helper` and `synaphex_approve_network_action` are
explicit user-approval surfaces **only** under the accepted Phase-3A local-stdio
model, where a top-level tool call is a direct local user action. Before any
remote MCP transport, caller authentication and approval provenance must be
redesigned and reviewed.

This store is not provider-process tracking, a cancellation registry, an async
job manager or an MCP tasks implementation; all provider execution remains
synchronous within the tool request.

## Phase 3D: provider-capability continuation symmetry

```text
Provider-capability continuation has two authority sources:

rule allow
→ explicit continue, no approval

rule ask
→ explicit approval + continue
```

Both are user-triggered, both are fresh executions, and neither persists
anything. Host actions remain separate.

### The gap this closes

Phase 3C could progress `network` only when it was classified
`approval_required`. An already-`allowed` network action was classified and
returned with no continuation path, because `resumeCallerWithActionApproval`
hard-rejects any other status — correctly, since there is no approval event to
grant. That API was not misused to manufacture one.

### Core API

`AgentInvocationService` now exposes two public entrypoints over one shared
private primitive, `resumeCallerWithProviderCapability`:

- `resumeCallerWithActionApproval` — authority `explicit_approval`; requires
  the trusted classification to be `approval_required` and carries a one-time
  invocation-scoped approval token.
- `resumeCallerWithAllowedAction` — authority `rule_allow`; requires `allowed`
  and carries **no** approval token. `AllowedActionContinuationRequest` has no
  `approvalGranted` field, so an approval cannot even be expressed.

The distinction is preserved in public semantics rather than erased. It is
observable in the resumed `ExecutionPolicy`:

```text
rule_allow        -> network.decision = "allow", approvedForInvocation = false
explicit_approval -> network.decision = "ask",   approvedForInvocation = true
```

Both satisfy `isProviderCapabilityUsable`, but for different reasons. Tests
assert the actual policy the provider received, not merely that it was called.

Each path rejects the other's classification, and both reject host actions:
`git_push`/`ci` are `host_action`, not `provider_capability`, so
`InvalidActionExecutionKindError` fires before any execution.

### MCP tool

`synaphex_continue_allowed_network` takes exactly
`{continuationId, requestIndex}` — no `action`, `classification`, `reason`,
`kind`, `provider`, `host`, `approval` or `allow` field exists in the schema
(asserted across every tool). The server retrieves the trusted classified
action from the Phase-3C continuation record.

Annotations: `readOnlyHint: false`, `idempotentHint: false`,
`openWorldHint: true`, and `destructiveHint: **false**`. Unlike the two
approval tools, this grants nothing that was previously denied or asked — the
capability was already permitted by rule. Per the MCP definition
`destructiveHint` means destructive/irreversible updates, so calling an
external provider alone does not warrant it.

`synaphex_approve_network_action` is unchanged and remains the only path for
`approval_required`. The two surfaces are deliberately separate rather than
merged into an ambiguous `synaphex_execute_network`.

### Continuation integration

`network + allowed` is now actionable, so it can cause a handle to be issued.
Nothing else changed: a handle is still never issued solely for `git_push`,
`ci`, `denied`, `forbidden` or `unavailable`. Store lifetime, capacity (64),
process-locality and absence of TTL/persistence are unchanged, and the record
shape needed no extension.

```text
ORIGIN_PENDING -> continue allowed network -> CONSUMED (new handle if actionable)
```

Ordering matches Phase 3C exactly: validation failures and provider failures
leave the record pending and retryable, because no trusted transition occurred;
the record is consumed only after the resumed invocation succeeds, and only
then is a new handle issued. The consumed id is never reused.

### No auto-resume

An allowed capability never auto-continues. A Core-level test asserts the
provider call count is 1 after the initial invocation, still 1 before
continuation, and 2 only after the explicit call.

## Phase 4A: project/task bootstrap and project sessions

```text
A Synaphex logical session may be:
- project-only
- task-bound
```

```text
session lifetime is explicit and independent of MCP/provider lifetime
```

Project and task bootstrap is now self-service through local stdio MCP:

```text
synaphex_register_project
→ synaphex_create_task
→ synaphex_open_task_session
→ synaphex_invoke_agent
```

and, for project-scoped roles:

```text
synaphex_register_project
→ synaphex_open_project_session
→ synaphex_invoke_agent (scope.kind = "project")
```

### Discovered Core semantics

- `ProjectManager.create(name, sourcePath)` expands `~`, resolves the real
  path, requires it to exist and be a directory, and stores the **canonical**
  path. It never creates, clones or git-initializes the source tree; only
  Synaphex state under the Synaphex root is written.
- **Duplicate source paths are refused, not deduplicated.** An
  already-registered canonical path raises
  `ProjectPathAlreadyRegisteredError`. That existing semantic is preserved:
  registration is therefore **not** idempotent, and its annotation says so.
- `TaskManager.create(projectId, description)` creates an `active` task with a
  canonical `task_*` id and derived slug, and binds **no session** and acquires
  **no task claim**. The session coupling lives only in
  `TaskOperations.createTask` (the terminal surface), which MCP deliberately
  does not use — so no duplicate claim can arise from bootstrap.

### Project-only vs task-bound sessions

```text
project session          task session
  projectId                projectId
  taskId = null            taskId
  no TaskBindingClaim      TaskBindingClaim
  no ownershipToken        ownershipToken
```

`openProjectSession` uses `SessionManager.bindProject` only. No fencing token
is invented for project-only sessions: project-scoped invocation remains
unfenced exactly as Phase 2C accepted. A test asserts
`captureTaskOwnership` returns `null` for such a session and that no claim file
exists.

### `close_session` closes either form

The Phase-2B semantics (release any task claim **and** delete the binding
record) were always a general session close, so the misleading
`close_task_session` name is **replaced**, not aliased — the interface is
internal and unreleased. `SessionCommands.closeSession` matches. For a
project-only session the result honestly reports `released: false` because
nothing was claimed; for a task-bound session it reports the released task.
Close stays idempotent. An audit test walks `src/`, `test/` and `docs/` to
confirm the stale name is gone everywhere.

`synaphex_force_release_task_session` remains task-specific, which is correct:
it recovers a **task ownership claim** when the SessionId was lost, and a
project-only session has no claim to recover. No generic session enumeration or
recovery was added.

### Boundaries preserved

Bootstrap grants no generic filesystem access: there is no `read_file`,
`list_directory`, `glob` or provider-config tool, and a `sourcePath` naming a
file is refused without echoing its contents. Creating a project, task or
session invokes no agent — a test asserts only bootstrap ports are touched.
Role contracts are unbroadened: `PLANNER` with project scope still fails with
Core's `NO_TASK_BOUND`. No plan is created or accepted by task creation, and no
host-action tool exists.

## Phase 4B: versioned plan review and deterministic decisions

```text
Plan draft decisions are revision-bound.
A user accepts/rejects exactly the draft instance they reviewed.
Natural-language approval has no authority.
```

```text
draftRevisionId prevents stale-review and same-content ABA decisions.
```

### Why a revision id, not a content hash

A content hash alone permits ABA: draft A with content X is reviewed, replaced,
and later draft B appears with the same content X — the hash matches and a
stale decision would apply to a draft the user never saw. Every draft WRITE
INSTANCE therefore mints an opaque `planrev_<32 hex>` identity, independent of
content. Two byte-identical drafts have different revisions, and a Planner
invocation always proposes a new instance even when the text is unchanged.

`draftRevisionId` is an optimistic-concurrency/identity token safe to return to
a client. It is not a SessionId, not the Phase-2C ownership token, and not an
authentication credential.

### Persistence

Plans stay human-readable Markdown (`draft.md`, `current.md`, `archive/`). The
only addition is `draft.meta.json`:

```json
{ "version": 1, "revisionId": "planrev_…", "contentHash": "…", "createdAt": "…" }
```

`contentHash` exists purely to detect mismatched metadata; it is never the
revision identity. On read, metadata is usable only when its hash matches the
actual draft bytes — otherwise it is discarded and a fresh revision is minted.
That is what stops a crash between the content write and the metadata write
from letting new bytes inherit an old identity.

### Legacy and lazy hydration

A pre-existing `draft.md` with no metadata stays readable. It is upgraded
lazily, under the plan mutation lock, the first time it is read through the
revision-aware API: a fresh revision is minted and persisted. No revision is
ever synthesized deterministically from content, and no project is migrated
eagerly. Until hydrated, `getDraft` reports a placeholder revision that can
never match a decision, so an un-hydrated draft is readable but not decidable.

### One plan mutation lock

`PlanManager` now owns a single serialization boundary at
`state/plans/.mutation-lock.json`, following the existing task-binding and
memory lock conventions. Every path touching draft, draft metadata, current or
archive goes through it: Planner persistence via ResultProcessor, accept,
reject, metadata hydration, and archive/promotion. There is no MCP-only lock
and no separate accept-vs-write lock (asserted by test). Stale-lock recovery is
**not** implemented — the same deferred debt as the other two locks.

### Decision authority

Decisions are keyed by the session's **current task ownership**, never by
taskId alone. `PlanDecisionCommands` resolves the task from the SessionId
(a project-only session is refused with `NO_TASK_BOUND`), validates task
lifecycle, then reuses the Phase-2C fencing primitives — capture, then
revalidate — before delegating. A force-released or replaced session cannot
decide on the new owner's behalf; it fails with `NO_TASK_BOUND` (its binding
record is deleted by force release) or `TASK_SESSION_OWNERSHIP_LOST` when only
the claim was taken.

Accept: verify exact revision → archive any existing current → rename draft to
current → remove draft metadata. Reject: verify exact revision → delete
metadata → delete draft; the current plan and task lifecycle are untouched, and
rejected drafts are deleted rather than archived.

A revision mismatch mutates nothing and deliberately does **not** return the
current draft content — the user must call `synaphex_get_plan_state` again.

### Crash ordering and residual windows

No filesystem transaction exists, so ordering is chosen to fail safely:

- **Draft write:** content, then metadata. A crash between them leaves metadata
  whose hash cannot match, so the draft re-hydrates to a fresh revision.
- **Accept:** archive current (exclusive create), then `rename` draft → current
  (atomic promotion), then remove draft metadata. A crash after the rename
  leaves orphaned draft metadata whose hash matches nothing, which is ignored.
  **Residual window:** a crash after archiving but before the rename leaves a
  duplicate archive copy of a plan that is still current.
- **Reject:** metadata, then content. A crash between them leaves a draft with
  no usable metadata, which re-hydrates to a *fresh* revision — so the rejected
  revision can never be decided again.

No partial state grants ambiguous authority.

### MCP tools and annotations

| Tool | readOnly | idempotent | destructive |
|---|---|---|---|
| `synaphex_get_plan_state` | **true** | true | false |
| `synaphex_accept_plan_draft` | false | false | **true** |
| `synaphex_reject_plan_draft` | false | false | **true** |

All three are `openWorldHint: false` — deterministic local state, no model,
network, shell or provider execution.

`get_plan_state` keeps `readOnlyHint: true` honestly: no plan **content** and
no plan **authority** ever change there. Legacy hydration does write revision
metadata, but that assigns identity to a draft which already exists, and the
plan the user reviews is byte-identical before and after. Both decisions are
destructive because acceptance archives and replaces the current plan and
rejection deletes the proposed draft.

Plan state is **not** continuation state: revision identity is persisted with
the plan, so a user may read a draft, restart the MCP process, and still decide
about it. No archive mutation tool was added.

### CODER still blocked

Accepting a plan clears `PLAN_DRAFT_PENDING` in Core, but CODER remains absent
from `MCP_INVOCABLE_AGENTS`. Plan acceptance does not solve transactional
source mutation, and a protocol test confirms CODER is still refused after an
acceptance.
