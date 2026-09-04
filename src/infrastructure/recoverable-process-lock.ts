import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import type { StateStore } from "./state-store.js";

/**
 * Opaque identity of ONE lock acquisition.
 *
 * Randomly generated per acquisition, so two acquisitions of the same lock
 * path are always distinguishable. Deliberately NOT a SessionId, NOT a task
 * `ownershipToken` and NOT invocation lineage: this identifies a short-lived
 * infrastructure mutex generation, never a domain actor.
 */
export type LockOwnerId = `lock_${string}`;

/**
 * Durable owner record, published atomically with the lock itself.
 *
 * `pid` and `host` are liveness HINTS for infrastructure recovery only. They
 * are never domain authority, and nothing here identifies a provider, model,
 * credential or conversation.
 */
export interface LockOwnerRecord {
  readonly version: 1;
  readonly ownerId: LockOwnerId;
  readonly pid: number;
  readonly host: string;
  readonly createdAt: string;
}

/**
 * A lock artifact written before owner records existed: `{token, processId,
 * createdAt}`. It carries no `ownerId`, so no generation-safe recovery is
 * possible for it and it is NEVER auto-removed.
 */
export interface LegacyLockRecord {
  readonly token: string;
  readonly processId: number;
  readonly createdAt: string;
}

export type LockInspection =
  | { readonly state: "free" }
  | { readonly state: "held"; readonly owner: LockOwnerRecord; readonly liveness: Liveness }
  | { readonly state: "legacy"; readonly record: LegacyLockRecord }
  | { readonly state: "malformed" };

/**
 * Result of probing whether a lock's owning process still exists.
 *
 * Only `dead` permits recovery. `unknown` covers permission-denied probes,
 * unusable pids and locks created on another host -- all of which fail closed.
 */
export type Liveness = "alive" | "dead" | "unknown";

/** Probes whether a local process id currently exists. */
export interface ProcessLivenessProbe {
  probe(pid: number): Liveness;
}

/**
 * Default probe using signal 0, which performs permission and existence
 * checks without delivering a signal.
 *
 * ```text
 * ESRCH  -> dead     (no such process)
 * EPERM  -> unknown  (it exists, but is not ours -- never recover)
 * ok     -> alive
 * ```
 *
 * PID reuse can only make this return `alive` for an unrelated process, which
 * REFUSES recovery. That is a safe false negative; the reverse -- reporting a
 * live owner as dead -- is impossible here.
 */
export class SignalProcessLivenessProbe implements ProcessLivenessProbe {
  probe(pid: number): Liveness {
    // `kill(0, …)` and negative pids address process GROUPS, not a process,
    // and would answer a question we did not ask.
    if (!Number.isInteger(pid) || pid <= 0) {
      return "unknown";
    }
    try {
      process.kill(pid, 0);
      return "alive";
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ESRCH") {
        return "dead";
      }
      // EPERM means the process exists but belongs to someone else.
      return "unknown";
    }
  }
}

export interface RecoverableProcessLockOptions {
  readonly retryCount?: number;
  readonly retryDelayMs?: number;
  readonly livenessProbe?: ProcessLivenessProbe;
  readonly host?: string;
  /**
   * Test seam fired inside recovery, after the dead owner was read and BEFORE
   * the capture. This is the only window in which the generation about to be
   * captured can still change, so it is where the restore path is exercised.
   */
  readonly beforeCapture?: () => Promise<void>;
  /** Test seam fired inside recovery, after capture and before verification. */
  readonly afterCapture?: () => Promise<void>;
  /** Test seam fired after a lock is acquired, before the operation runs. */
  readonly afterAcquire?: () => Promise<void>;
}

/** Raised when a lock could not be acquired within the retry budget. */
export class LockAcquisitionTimeout extends Error {
  constructor(readonly scope: string, readonly reason: LockTimeoutReason) {
    super(`Timed out acquiring lock ${scope} (${reason})`);
    this.name = "LockAcquisitionTimeout";
  }
}

/**
 * Why acquisition gave up. Domain callers map this onto their own stable
 * public error codes, so lock identity is never collapsed into a generic one.
 */
export type LockTimeoutReason =
  | "contended"
  | "legacy_lock_recovery_required"
  | "malformed_lock";

const DEFAULT_RETRY_COUNT = 500;
const DEFAULT_RETRY_DELAY_MS = 10;
const QUARANTINE_DIRECTORY = "state/.lock-quarantine";

/**
 * A filesystem mutex that can be safely reclaimed after its owning process
 * dies -- and only then.
 *
 * ## What this is not
 *
 * This is NOT session leasing. There is no TTL, no heartbeat, no expiry and no
 * automatic release of any logical Synaphex session or task ownership. A lock
 * is reclaimed ONLY when the owning process is conservatively proven absent.
 * Lock age is never evidence.
 *
 * ## Recovering a dead owner without stealing a live one
 *
 * Recovery is generation-safe. A naive `read owner -> unlink(path)` has a real
 * TOCTOU hole: the owner can die, a new process acquire, and the stale
 * recoverer then delete the NEW generation. Instead recovery is
 * capture-verify-restore:
 *
 * ```text
 * 1. rename(lock -> quarantine/<ownerId>.<nonce>.json)   atomic capture
 * 2. re-read the captured record
 * 3. ownerId matches the dead generation  -> discard it, lock is now free
 *    ownerId does NOT match               -> RESTORE it and abort
 * ```
 *
 * Step 1 is atomic, so the file is never absent from both places. Step 3's
 * restore uses an exclusive link rather than a rename: if some other process
 * already claimed the momentarily-free path, the restore fails with EEXIST and
 * that newer owner survives untouched. Every branch either leaves exactly the
 * generation that was there, or leaves the path free for a fresh acquisition.
 */
export class RecoverableProcessLock {
  private readonly retryCount: number;
  private readonly retryDelayMs: number;
  private readonly livenessProbe: ProcessLivenessProbe;
  private readonly host: string;

  constructor(
    private readonly stateStore: StateStore,
    private readonly options: RecoverableProcessLockOptions = {},
  ) {
    this.retryCount = options.retryCount ?? DEFAULT_RETRY_COUNT;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.livenessProbe = options.livenessProbe ?? new SignalProcessLivenessProbe();
    this.host = options.host ?? hostname();
  }

  /**
   * Runs `operation` while holding `scope`, releasing it afterwards.
   *
   * The release is owner-checked: a late-running holder can never delete a
   * newer generation of the same lock.
   */
  async withLock<T>(scope: string, operation: () => Promise<T>): Promise<T> {
    const owner = await this.acquire(scope);
    try {
      if (this.options.afterAcquire !== undefined) {
        await this.options.afterAcquire();
      }
      return await operation();
    } finally {
      await this.release(scope, owner);
    }
  }

  /** Reads the current state of a lock without modifying anything. */
  async inspect(scope: string): Promise<LockInspection> {
    const value = await this.stateStore.readJson<unknown>(scope);
    if (value === null) {
      return { state: "free" };
    }
    if (isOwnerRecord(value)) {
      return {
        state: "held",
        owner: value,
        liveness: this.livenessOf(value),
      };
    }
    if (isLegacyRecord(value)) {
      return { state: "legacy", record: value };
    }
    return { state: "malformed" };
  }

  /**
   * Reclaims `scope` if, and only if, its owning process is proven absent.
   *
   * Returns the recovered owner record, or `null` when nothing was recovered
   * for ANY reason -- still alive, liveness unknown, another host, a legacy or
   * malformed artifact, or a concurrent recovery that got there first.
   *
   * Recovers ONLY the mutex. No task ownership is released, no session closed,
   * no plan or memory touched, no source file reset and no apply intent
   * resolved. Domain state is deliberately left exactly as the dead process
   * left it, for an explicit domain-level reconciliation to inspect later.
   */
  async recoverIfOwnerDead(scope: string): Promise<LockOwnerRecord | null> {
    const inspection = await this.inspect(scope);
    if (inspection.state !== "held" || inspection.liveness !== "dead") {
      return null;
    }
    return this.recoverGeneration(scope, inspection.owner);
  }

  /**
   * Captures a specific generation and discards it only after confirming the
   * capture really is that generation.
   */
  private async recoverGeneration(
    scope: string,
    expected: LockOwnerRecord,
  ): Promise<LockOwnerRecord | null> {
    if (this.options.beforeCapture !== undefined) {
      await this.options.beforeCapture();
    }
    const quarantinePath = `${QUARANTINE_DIRECTORY}/${expected.ownerId}.${randomBytes(8).toString("hex")}.json`;
    // Atomic: the artifact is never absent from both paths at once.
    const captured = await this.stateStore.captureFile(scope, quarantinePath);
    if (!captured) {
      // Someone else recovered or released it first. Not ours to reclaim.
      return null;
    }
    if (this.options.afterCapture !== undefined) {
      await this.options.afterCapture();
    }
    const value = await this.stateStore.readJson<unknown>(quarantinePath);
    if (isOwnerRecord(value) && value.ownerId === expected.ownerId) {
      // Confirmed: this really was the dead generation.
      await this.stateStore.removeFile(quarantinePath);
      return value;
    }
    // We captured something other than the generation we proved dead. Put it
    // back -- exclusively, so a newer owner that claimed the freed path in the
    // meantime survives and we simply lose the race.
    const restored = await this.stateStore.linkExclusive(quarantinePath, scope);
    if (!restored) {
      await this.stateStore.removeFile(quarantinePath);
    }
    return null;
  }

  /**
   * Acquires `scope`, recovering a provably dead owner if one is blocking it.
   *
   * Never steals: a live owner, an unknown-liveness owner, a foreign-host
   * owner and a legacy artifact all fall through to ordinary retry and finally
   * a timeout carrying the reason.
   */
  private async acquire(scope: string): Promise<LockOwnerRecord> {
    let lastReason: LockTimeoutReason = "contended";
    for (let attempt = 0; attempt < this.retryCount; attempt += 1) {
      const owner: LockOwnerRecord = {
        version: 1,
        ownerId: generateLockOwnerId(),
        pid: process.pid,
        host: this.host,
        createdAt: new Date().toISOString(),
      };
      // Atomic publication: the lock becomes visible together with a complete,
      // valid owner record, so a crash can never leave a lock with no owner.
      const acquired = await this.stateStore.createJsonAtomicExclusive(
        scope,
        owner,
      );
      if (acquired) {
        return owner;
      }
      const inspection = await this.inspect(scope);
      if (inspection.state === "held" && inspection.liveness === "dead") {
        await this.recoverGeneration(scope, inspection.owner);
        // Retry immediately: the path may now be free, or another contender
        // may already have taken it. Either way we do not sleep on a lock
        // whose owner is gone.
        continue;
      }
      if (inspection.state === "legacy") {
        lastReason = "legacy_lock_recovery_required";
      } else if (inspection.state === "malformed") {
        lastReason = "malformed_lock";
      } else {
        lastReason = "contended";
      }
      await delay(this.retryDelayMs);
    }
    throw new LockAcquisitionTimeout(scope, lastReason);
  }

  /**
   * Releases a lock only if it is still the exact generation we acquired.
   *
   * Without this check, a holder whose lock was recovered while it was stalled
   * would delete its successor's lock on the way out.
   */
  private async release(scope: string, owner: LockOwnerRecord): Promise<void> {
    const value = await this.stateStore.readJson<unknown>(scope);
    if (isOwnerRecord(value) && value.ownerId === owner.ownerId) {
      await this.stateStore.removeFile(scope);
    }
  }

  private livenessOf(owner: LockOwnerRecord): Liveness {
    // A pid only means something on the machine that minted it. Shared or
    // synced state directories must never lead to cross-host pid recovery.
    if (owner.host !== this.host) {
      return "unknown";
    }
    return this.livenessProbe.probe(owner.pid);
  }
}

export function generateLockOwnerId(): LockOwnerId {
  return `lock_${randomBytes(16).toString("hex")}`;
}

function isOwnerRecord(value: unknown): value is LockOwnerRecord {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<LockOwnerRecord>;
  return (
    candidate.version === 1 &&
    typeof candidate.ownerId === "string" &&
    candidate.ownerId.startsWith("lock_") &&
    typeof candidate.pid === "number" &&
    typeof candidate.host === "string" &&
    typeof candidate.createdAt === "string"
  );
}

function isLegacyRecord(value: unknown): value is LegacyLockRecord {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<LegacyLockRecord>;
  return (
    typeof candidate.token === "string" &&
    typeof candidate.processId === "number" &&
    !("ownerId" in candidate)
  );
}
