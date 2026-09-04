# ADR 0003: CODER staging workspace and durable change sets

Status: accepted (Phase 5A foundation; not yet wired to CODER invocation)

```text
CODER does not write directly to the registered source workspace.

Initial staging support requires a clean Git worktree.

Provider edits occur in an isolated temporary repository with no remotes.

Provider edits become an immutable task-scoped change set.

Applying a change set is a separate explicit future user operation.
```

## Why

Phase-2C ownership fencing protects Synaphex state, but it cannot roll back
filesystem writes a provider already performed. That is the sole reason CODER
has stayed out of MCP. The execution model that fixes it:

```text
real source repo
  -> immutable baseline snapshot (HEAD commit)
     -> isolated staging repo (no remotes)
        -> provider edits ONLY here
           -> deterministic change set
              -> persistent task state

REAL SOURCE REMAINS UNCHANGED
```

This slice builds the staging and change-set foundation only. There is no
apply, merge, cherry-pick, commit or copy-back operation, and CODER is still
absent from `MCP_INVOCABLE_AGENTS`.

## Staging strategy

A local-path clone with `--no-local --no-hardlinks --no-checkout`, then a
detached `checkout --force` of the exact baseline commit, then removal of every
remote. `--no-local --no-hardlinks` matters: a default local clone hardlinks
objects into the user's `.git`, and Synaphex requires a fully separate object
store. Verified: no `.git/objects/info/alternates` is created.

Local paths only — never a remote URL — so staging performs no fetch, pull,
clone-from-server or submodule update. No network, no host action, no provider
capability.

## Git isolation

Verified empirically against the installed Git (2.25.1):

- `spawn("git", …)` with `shell: false`; never `bash -c` or `sh -c`. An audit
  test asserts `git` is the only executable spawned.
- **`HOME` is redirected** to a fresh empty directory. `GIT_CONFIG_GLOBAL` is
  deliberately *not* relied upon: it landed in Git 2.32 and is silently ignored
  on 2.25.x, where a planted global alias still applied. Overriding `HOME`
  suppresses `~/.gitconfig` on every supported version.
- `GIT_CONFIG_NOSYSTEM=1` suppresses system config.
- `-c core.hooksPath=/dev/null` — no repository or user hook runs as a side
  effect. A test plants `post-checkout`, `pre-commit` and `post-index-change`
  hooks and asserts none executes.
- `core.fsmonitor=`, `diff.external=`, `credential.helper=`, `core.pager=cat`,
  `core.useReplaceRefs=false`, `submodule.recurse=false`,
  `GIT_TERMINAL_PROMPT=0`.
- A minimal env (only `PATH`, plus the controls above), so no user Git variable
  (`GIT_DIR`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_EXTERNAL_DIFF`,
  `GIT_SSH_COMMAND`, …) can leak in.

This applies only to Synaphex's own Git subprocesses; provider authentication
environments are untouched.

## Clean-worktree definition

`git status --porcelain=v1 --untracked-files=all -z` must return **zero**
entries — no staged modification, no unstaged modification, no untracked file.

Synaphex never stashes, resets, cleans, commits or otherwise touches the user's
work to make staging possible. It fails closed with
`CODER_STAGING_WORKTREE_DIRTY`, and tests assert the source stays
byte-identical (including that a staged change remains staged).

Clean-only gives the deterministic relation a future apply needs:

```text
source state at preparation == source HEAD commit == staging baseline
```

Dirty-worktree snapshots are deliberately out of scope.

## Unsupported repository cases

Checked in this order, so the most specific reason wins:

1. **Not a Git worktree / bare** → `CODER_STAGING_REQUIRES_GIT`. Synaphex never
   runs `git init` for the user.
2. **Unborn or commit-less HEAD** → `detached_or_unborn_head`: no deterministic
   baseline exists.
3. **Submodule gitlink** (index mode `160000`) → `submodule_gitlink`. Never
   initialised or fetched: materialization can require external repositories and
   network, and adds a second source-authority boundary.
4. **Unsafe tracked symlink** (index mode `120000`) → `unsafe_symlink`.
   Absolute, `~`-relative, and targets normalizing outside the repository root
   are rejected. Internal relative symlinks are supported and verified to
   resolve inside staging.
5. **Dirty worktree** → `CODER_STAGING_WORKTREE_DIRTY`.

Note the gitlink check runs *before* the dirty check, because an unchecked-out
submodule also shows as dirty and would otherwise mask the real reason.

## No remotes in staging

Every remote is removed after cloning and the result is re-verified empty. A
clone that retained `origin` pointing at the user's real repository would be
unacceptable, so this is asserted rather than assumed — the provider has no
`git push` destination. The real source path is also absent from the staging
`.git/config`.

## Baseline identity

The full canonical object id of the source HEAD (`rev-parse HEAD^{commit}`,
40–64 hex). Branch names are never authority because branches move. Staging is
checked out detached at that exact commit and re-verified.

## Change-set identity and storage

`changeset_<ISO timestamp>_<16 hex>` — unique per capture, independent of
content, and not a SessionId, ownership token, provider lineage or base-commit
hash. Two captures of a byte-identical patch get different ids (tested).

```text
tasks/open/task_…/changes/changeset_…/
  metadata.json
  changes.patch
```

Metadata: `version`, `changeSetId`, `projectId`, `taskId`, `baseCommit`,
`createdAt`, `patchHash`, `patchBytes`, `changedFiles`. Deliberately absent:
staging temp path, ownership token, provider credentials, provider stderr, and
the real source path. `sessionId` is *not* stored — apply authority will come
from current task-session ownership plus the exact change-set id, not from a
persisted identifier.

Publication is immutable: both files are created exclusively, so an existing
change set can never be overwritten in place. Nothing is written into the
user's source workspace. Reads validate the patch hash and byte length, so a
tampered or truncated patch is reported `CHANGE_SET_CORRUPT` rather than
returned.

Ordering: patch bytes first, then metadata. A crash between them leaves
metadata absent, and a change set without readable metadata is treated as
corrupt rather than usable — a partially published change set can never be
mistaken for authoritative task output.

## Patch and manifest

`git add -A` against the **staging** index only, then
`git diff --cached --binary --no-ext-diff <baseCommit>`. This represents
modified, added, deleted and binary files, with no commit made. The user's real
index is never staged to.

The manifest is derived from Git state (`--name-status -z` plus `--numstat -z`
for binary detection), never from provider-reported text. Paths are
repository-relative and validated against absolute paths and `..` traversal.
Renames are represented as delete + add to stay within the three documented
categories.

## Empty change set

An empty capture returns a candidate with an empty patch and empty manifest,
and `publish` returns `null` — **no durable change-set state is created**, and
no fake non-empty patch is ever persisted.

## Temporary workspace lifecycle

A private OS temp directory (never `<source>/.synaphex*`), with the workspace
directory created mode `0o700`. The isolated Git HOME is a separate temp
directory created before any Git command runs. Both are removed by `dispose`,
which callers own through `finally`; a rejected source leaves no orphan temp
directory (tested). When publishing, cleanup happens only after the patch bytes
are persisted.

## Deferred: current direct CODER behavior

Direct (non-MCP) CODER invocation still executes against
`context.project.sourcePath` — the real workspace — exactly as accepted. This
slice does **not** change that contract while the infrastructure is unused.
That remains debt to close in Phase 5B.

## Future AgentContext seam

CODER must execute against `stagingPath` while Core still knows the registered
project's real `sourcePath`. The persisted project `sourcePath` must **not** be
replaced. The cleanest seam is an execution-path override carried on the
invocation, distinct from the logical project path:

```text
project.sourcePath        -> logical, persisted, unchanged
executionWorkspacePath    -> per-invocation, staging, provider-facing
```

`AgentExecutionInput` (or `AgentContext.project`) would carry the override, and
each provider executor would use it as its workspace instead of
`context.project.sourcePath`. The provider is never told the real source path
merely for convenience. Not implemented here.

## Phase 5B: staged CODER invocation (accepted)

```text
AgentInvocationService CODER is always staged.

Direct and MCP CODER share one semantic.

The registered source workspace remains unchanged after CODER execution.

A successful staged CODER result produces an immutable proposed change set.

REVIEWER cannot review staged source changes until they are explicitly applied.
```

This **intentionally changes** the previous direct-CODER behavior. There is no
longer an "MCP CODER = staged, direct CODER = writes real source" split: Core
semantics do not depend on transport, so every `AgentInvocationService` CODER
path stages, whether the caller arrived via MCP, a CLI host, a VS Code host or
any future transport. Provider adapters may still be unit- and live-tested
directly against a real directory; that tests the adapter, not Synaphex CODER.

### Execution-context projection

`CoderStagingCoordinator` builds an ephemeral provider-facing clone of the
`AgentContext` in which **only** `project.sourcePath` is replaced by the
staging path:

```text
project.sourcePath (persisted)  -> registered real source, never rewritten
context.project.sourcePath      -> staging clone, for CODER execution only
```

No provider adapter changed. All three continue treating
`input.context.project.sourcePath` as their cwd and know nothing about staging.
Every other agent still receives the real source, because they remain
source-read-only. The prompt serializer never emitted `sourcePath`, so the
projection is sufficient: a test asserts the real absolute path is absent from
the structured provider-facing context (project, task, route, ExecutionPolicy).

CODER keeps `sourceModification = workspace_write` — that is not weakened into
a lie. The security change is that workspace_write now applies to the staging
clone.

### Pipeline

```text
preflight (binding, lifecycle, PLAN_DRAFT_PENDING, config, routing, policy)
  -> capture ownership fence
     -> prepare isolated staging workspace
        -> revalidate ownership          (clone can take time)
           -> execute provider against the projected context
              -> validate AgentResult, classify calls/actions
                 -> revalidate ownership
                    -> capture changes from staging Git state
                       -> post-provider repository safety audit
                          -> publish change set under ownership authority
                             -> ResultProcessor writes the work record
  finally -> dispose staging + isolated HOME
```

Staging runs only after the pipeline has established the invocation is legal,
so an unconfigured agent, bad route or pending plan draft never pays for a
clone. A dirty/non-Git/unsupported source fails with the precise
`CODER_STAGING_*` error, never `AGENT_EXECUTION_FAILED`, because no provider
ran. Conversely a provider failure keeps `AGENT_EXECUTION_FAILED` with its
cause intact, and post-provider unsafe output yields the staging safety error —
the provider ran, but its result was rejected.

### Post-provider repository safety audit

Phase 5A validated the source snapshot *before* execution; that is not enough,
because CODER can create unsafe structures while working. The final staged
index and remote list are therefore revalidated before any publish, rejecting:

- a **gitlink** (`160000`) — e.g. a provider-created nested Git repository;
- an **unsafe symlink** (`120000`) whose staged blob is absolute, `~`-relative
  or escapes the staging root;
- any **re-added remote**, failing closed rather than stripping it and
  continuing, since no absence of side effect could be proven.

Provider Git manipulation cannot redefine authority: the baseline stays
`PreparedCoderWorkspace.baseCommit`, and the patch spans
`baseCommit -> final staged state` (`git add -A` then
`git diff --cached --binary <baseCommit>`). A test has the fake CODER commit
its work and move HEAD, then asserts the change set is still relative to the
original source HEAD and covers both committed and uncommitted edits.

### Publish-time ownership authority

`SessionManager.withTaskOwnershipAuthority(fence, op)` holds the **existing**
task-binding lock across validation and the durable write, so a force release
or rebind cannot interleave between them. No independent lock was introduced,
and the lock covers only that short commit boundary — never provider execution.

The ownership token is used internally and never persisted: it appears in no
change-set metadata, CODER work record, MCP output or provider input.

### Ordering and the orphan window

```text
capture in temp staging
  -> ownership-authorized immutable change-set publish
     -> ResultProcessor writes the CODER work record referencing changeSetId
```

**Residual crash window:** a crash after publish but before the work record
leaves an orphaned change set. Such a change set is defined as
**NON-AUTHORITATIVE FOR FUTURE APPLY**: mere directory existence under
`changes/` never becomes apply authority, and Phase 5C's apply must require a
valid CODER work-record reference. This ordering is preferred over the reverse,
which could leave a work record citing a change set that was never fully
published. Orphan garbage collection is documented debt.

### CODER work record

`changeSet` is a **sibling of `payload`**, not a field inside it, so
configurable Coder `outputFields` semantics are unchanged and provider output
cannot forge `changeSetId`, `baseCommit`, `patchHash` or `changedFiles` —
Synaphex derives all of them from Git state. A staged invocation that changed
nothing writes a record with `changeSet: null`; no fake patch and no empty
change-set directory are created.

**Legacy compatibility:** a pre-staging record has **no** `changeSet` field at
all. It stays readable, is never reinterpreted as a staged change set, and
keeps its accepted REVIEWER behavior (tested).

### REVIEWER gate

REVIEWER reads the real source, which staged CODER intentionally leaves
unchanged. Reviewing an unapplied change set would examine a tree without the
implementation, and a PASS could complete a task on that false basis. So when
the latest CODER record carries a non-null `changeSet`, REVIEWER is refused
with `REVIEW_TARGET_NOT_APPLIED` before the provider runs. Phase 5C will refine
this with exact change-set review/apply semantics.

### MCP surface

`coder` is now in the `synaphex_invoke_agent` agent enum, and the tool count
stays **21** — no new tool. The result carries a change-set **summary**
(`id`, `baseCommit`, `patchHash`, `patchBytes`, `changedFiles`) or `null`;
never the patch itself, the staging path, the isolated Git HOME or an ownership
token. No change-set read or apply tool exists yet.

The direct and helper surfaces are now **separate sets**:

```text
MCP_DIRECT_INVOCABLE_AGENTS      = all six, including coder
MCP_CONTINUATION_HELPER_AGENTS   = the five source-read-only agents
```

A user may explicitly invoke staged CODER, but an agent must not smuggle CODER
execution through a helper continuation — that gets its own review later. The
Phase-3A defence-in-depth assertion became role-specific rather than being
removed: CODER must resolve `workspace_write`, every other MCP agent must
resolve `read_only`, and either surprise fails closed.
