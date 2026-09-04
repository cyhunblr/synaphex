# ADR 0004: Recoverable process lock

Status: accepted (Phase 5D)

```text
An infrastructure mutex may be reclaimed when its owning process is proven gone.

A logical Synaphex session may NOT.

Reclaiming a mutex never rolls back domain state.
```

## Why

Synaphex had four independent lock domains, each with a byte-identical
hand-rolled retry loop and the same debt:

```text
process crashes while lock is held
→ lock artifact survives
→ subsystem blocked forever
→ manual filesystem deletion required
```

That was tolerable while locks only guarded Synaphex's own state. Phase 5C made
one of them guard **mutation of the user's source workspace**, so a crashed
process could wedge apply/reject until someone deleted a file by hand. Phase 5E
cannot safely reconcile an interrupted apply while that is true.

## Infrastructure mutex lifetime ≠ session lifetime

This is the load-bearing distinction.

| | logical Synaphex session | infrastructure mutex |
| --- | --- | --- |
| lifetime | explicit, user-controlled | duration of one short critical section |
| owner | a user's working context | one OS process |
| released by | explicit close / force-release | scope exit, or death of its process |
| TTL / heartbeat | **never** | **never** |

There is still **no** session TTL, no heartbeat, no task-ownership expiry and no
automatic logical-session release. A dead process cannot legitimately continue
holding a filesystem mutex; a user's session is not owned by a process at all.

## Lock age is never evidence

There is no "older than N seconds → steal" rule anywhere. A valid process may
hold a lock arbitrarily long. `createdAt` is recorded for diagnostics and is
never compared against a clock — an audit test asserts the primitive's code
contains no TTL, heartbeat, expiry or even `Date.now()`.

Reclamation requires *conservative proof of absence*, and nothing else.

## Owner record

Published atomically with the lock itself:

```json
{
  "version": 1,
  "ownerId": "lock_<32 hex>",
  "pid": 12345,
  "host": "machine-name",
  "createdAt": "2026-09-04T22:00:00.000Z"
}
```

`ownerId` is random per acquisition, so two acquisitions of the same path are
always distinguishable. It is deliberately **not** a `SessionId`, **not** a task
`ownershipToken` and **not** invocation lineage. `pid` and `host` are liveness
hints for infrastructure only, never domain authority. No credential, provider,
model or conversation id is ever persisted in a mutex.

## Atomic acquisition

Acquisition uses the existing `createTextAtomicExclusive`: write a complete
record to a temp file, then `link()` it into place. `link` fails with `EEXIST`
rather than clobbering, so the lock becomes visible **together with** a complete,
valid owner record. The crash state "lock path exists but metadata was never
written" is therefore unreachable by construction.

## Liveness detection

`process.kill(pid, 0)` performs existence and permission checks without
delivering a signal:

```text
ESRCH            → dead     (the only recoverable case)
success          → alive    → refuse
EPERM            → unknown  → refuse
pid <= 0 / non-integer → unknown → refuse   (these address process GROUPS)
host mismatch    → unknown  → refuse, probe not even consulted
```

PID reuse can only cause a **safe false negative**: an unrelated live process
that inherited the pid makes the probe answer `alive`, and Synaphex refuses
recovery. The reverse — reporting a live owner as dead — is not reachable.

## Generation-safe recovery

The naive approach is unsafe, and measurably so. A `read owner → unlink(path)`
sequence has a real TOCTOU hole: the owner dies, a new process acquires, and the
stale recoverer then deletes the **new** generation. This was reproduced
directly against the filesystem before choosing a design — a stale rename did in
fact capture generation B.

Recovery is instead **capture-verify-restore**:

```text
1. rename(lock → quarantine/<ownerId>.<nonce>.json)     atomic capture
2. re-read the captured record
3a. ownerId == the generation proven dead → discard; the lock is now free
3b. ownerId != that generation            → RESTORE it, and abort
```

Two properties make this safe:

- **Step 1 is atomic.** The artifact is never absent from both paths at once, so
  a concurrent reader sees either the lock or a free path — never a torn state.
- **Step 3b restores with an exclusive link, not a rename.** If another process
  claimed the momentarily-free path in the meantime, the restore fails with
  `EEXIST`, that newer owner survives untouched, and the stale recoverer simply
  loses the race. (`rename` would have overwritten it; this was verified.)

Every branch therefore leaves either exactly the generation that was there, or a
free path for a fresh acquisition. Never a stolen live lock.

Inode numbers were evaluated as a generation marker and **rejected**: the
filesystem reuses them immediately, so a recreated lock can land on the same
inode as the one just removed.

## Old-holder cleanup protection

Release is owner-checked, never a blind `unlink`. A holder re-reads the lock and
removes it only if it still carries its exact `ownerId`. So a holder that stalled,
had its generation recovered, and runs its `finally` block late cannot delete its
successor's lock. This is covered by a dedicated regression test.

## Acquisition may recover a proven-dead owner

Normal acquisition inspects a blocking lock and, only when its owner is proven
dead, recovers that exact generation and retries. Anything else — alive, unknown,
foreign host, legacy, malformed — falls through to ordinary retry and then a
timeout. Nothing is ever silently stolen.

## Legacy artifacts

Pre-5D locks were `{token, processId, createdAt}` with **no** `ownerId`. Without a
generation identity there is no safe way to recover one, so they are:

```text
recognised as "legacy"
→ never auto-deleted
→ never classified as dead, even if the pid is gone
→ acquisition fails with reason legacy_lock_recovery_required
```

Malformed artifacts behave the same way (`malformed_lock`). Both fail closed, and
tests assert the file is left byte-identical. Since no code path writes the legacy
shape any more, these can only originate in pre-existing development state.

## Quarantine

Recovery markers live under `state/.lock-quarantine/`, outside authoritative
state, and are never interpreted as active locks. A successful recovery deletes
its marker immediately; a lost restore race deletes it too. A test asserts no
residue accumulates after repeated recoveries.

**GC debt:** a crash *inside* the recovery window (between capture and discard)
can strand one small marker file. These are bounded in size and inert, but
nothing sweeps them yet.

## Recovery is infrastructure-only

This is the property Phase 5E depends on. Reclaiming a mutex does **not**:

```text
release task ownership        close a session
modify plans                  modify memory
reset source files            resolve an apply intent
change task lifecycle
```

Concretely, after a process dies holding the source-mutation lock mid-apply:

```text
source-mutation lock  → automatically recoverable
apply intent          → STILL EXISTS
change-set state      → STILL applying_interrupted
apply / reject        → STILL fail closed
```

The mutex stops being permanently wedged; the domain decision remains untouched
for explicit reconciliation. Two tests assert exactly this, including that the
source worktree, HEAD and session binding are unchanged by lock recovery.

## Domain error identity is preserved

The shared primitive raises a generic `LockAcquisitionTimeout` carrying a reason.
Each domain boundary maps it back onto its own stable public code, so lock
contention is never collapsed into `INTERNAL_ERROR`:

```text
TASK_BINDING_LOCK_TIMEOUT
MEMORY_MUTATION_LOCK_TIMEOUT
PLAN_MUTATION_LOCK_TIMEOUT
SOURCE_MUTATION_LOCK_TIMEOUT
```

## No MCP surface change

No `synaphex_force_unlock`, `synaphex_delete_lock` or `synaphex_recover_lock`.
Safe recovery is infrastructure behaviour; where ownership cannot be proven dead,
Synaphex fails closed rather than letting a model delete mutex files. The tool
count stays **25**.

## Platform limitations

- Liveness is `process.kill(pid, 0)`, which is POSIX-shaped. The semantics hold
  on Linux and macOS; a Windows port would need its own probe implementation
  behind the same `ProcessLivenessProbe` interface.
- `link()`-based atomic publication requires hard-link support. On a filesystem
  without it (some network mounts), acquisition would fail rather than silently
  degrade.
- Cross-host pid recovery is refused outright via the `host` field, so a shared
  or synced `~/.synaphex` cannot produce a false-positive reclamation.
