import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { hostname } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { MemoryManager } from "../src/core/memory-manager.js";
import { PlanManager } from "../src/core/plan-manager.js";
import { ProjectManager } from "../src/core/project-manager.js";
import { SessionManager } from "../src/core/session-manager.js";
import { TaskManager } from "../src/core/task-manager.js";
import {
  MemoryMutationLockTimeoutError,
  PlanMutationLockTimeoutError,
  TaskBindingLockTimeoutError,
} from "../src/domain/errors.js";
import {
  LockAcquisitionTimeout,
  RecoverableProcessLock,
  SignalProcessLivenessProbe,
  type Liveness,
  type LockOwnerRecord,
  type ProcessLivenessProbe,
} from "../src/infrastructure/recoverable-process-lock.js";
import { generateSessionId } from "../src/domain/session.js";
import { StateStore } from "../src/infrastructure/state-store.js";

const SCOPE = "state/test-locks/.mutex.json";
const CHILD = join(process.cwd(), ".test-dist", "test", "fixtures", "lock-holder-child.js");

async function stateRoot(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

/** A probe whose answer the test controls exactly. */
class ScriptedProbe implements ProcessLivenessProbe {
  readonly seen: number[] = [];
  constructor(private answer: Liveness) {}
  set(answer: Liveness): void {
    this.answer = answer;
  }
  probe(pid: number): Liveness {
    this.seen.push(pid);
    return this.answer;
  }
}

function lockWith(
  store: StateStore,
  options: ConstructorParameters<typeof RecoverableProcessLock>[1] = {},
): RecoverableProcessLock {
  // Small retry budget so "refuses to steal" tests fail fast instead of
  // sleeping for five seconds.
  return new RecoverableProcessLock(store, {
    retryCount: 5,
    retryDelayMs: 2,
    ...options,
  });
}

/**
 * Spawns the child holder and resolves once it reports the lock is held.
 * No sleeps: the child's stdout line is the barrier.
 */
async function spawnHolder(
  root: string,
  scope: string,
  mode: "hold" | "release" = "hold",
): Promise<{ child: ChildProcess; ownerId: string; pid: number }> {
  const child = spawn(process.execPath, [CHILD, root, scope, mode], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderr: string[] = [];
  child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk.toString("utf8")));
  const announced = await new Promise<{ ownerId: string; pid: number }>(
    (resolve, reject) => {
      let buffer = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const newline = buffer.indexOf("\n");
        if (newline >= 0) {
          resolve(JSON.parse(buffer.slice(0, newline)));
        }
      });
      child.on("exit", (code) =>
        reject(new Error(`child exited early (${code}): ${stderr.join("")}`)),
      );
    },
  );
  return { child, ...announced };
}

/** Kills a child and waits for the OS to actually reap it. */
async function killAndReap(child: ChildProcess): Promise<void> {
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGKILL");
  await exited;
}

async function readOwner(root: string, scope: string): Promise<LockOwnerRecord> {
  return JSON.parse(await readFile(join(root, scope), "utf8"));
}

// ---------------------------------------------------------------------------
// Acquisition and owner records
// ---------------------------------------------------------------------------

test("a lock becomes visible atomically together with a complete owner record", async (t) => {
  const root = await stateRoot(t);
  const store = new StateStore(root);
  const lock = lockWith(store);

  let observed: LockOwnerRecord | null = null;
  await lock.withLock(SCOPE, async () => {
    observed = await readOwner(root, SCOPE);
  });

  assert.ok(observed);
  const owner = observed as LockOwnerRecord;
  assert.equal(owner.version, 1);
  assert.match(owner.ownerId, /^lock_[0-9a-f]{32}$/);
  assert.equal(owner.pid, process.pid);
  assert.equal(owner.host, hostname());
  assert.ok(Date.parse(owner.createdAt) > 0);
  // Nothing sensitive is persisted in a mutex.
  const serialized = JSON.stringify(owner);
  for (const forbidden of ["token", "apiKey", "model", "provider", "sessionId"]) {
    assert.equal(serialized.includes(forbidden), false, `leaks ${forbidden}`);
  }
  // Released on the way out.
  assert.deepEqual(await lock.inspect(SCOPE), { state: "free" });
});

test("each acquisition mints a distinct ownerId", async (t) => {
  const store = new StateStore(await stateRoot(t));
  const lock = lockWith(store);
  const ids = new Set<string>();
  for (let i = 0; i < 5; i += 1) {
    await lock.withLock(SCOPE, async () => {
      const held = await lock.inspect(SCOPE);
      assert.equal(held.state, "held");
      ids.add(held.state === "held" ? held.owner.ownerId : "");
    });
  }
  assert.equal(ids.size, 5, "ownerId must be unique per acquisition");
});

test("the lock serialises concurrent operations in one process", async (t) => {
  const store = new StateStore(await stateRoot(t));
  const lock = new RecoverableProcessLock(store, { retryDelayMs: 1 });
  let inside = 0;
  let maxConcurrent = 0;
  await Promise.all(
    Array.from({ length: 6 }, () =>
      lock.withLock(SCOPE, async () => {
        inside += 1;
        maxConcurrent = Math.max(maxConcurrent, inside);
        await new Promise((resolve) => setImmediate(resolve));
        inside -= 1;
      }),
    ),
  );
  assert.equal(maxConcurrent, 1);
});

// ---------------------------------------------------------------------------
// Liveness semantics
// ---------------------------------------------------------------------------

test("the signal probe distinguishes dead, alive and unknown", () => {
  const probe = new SignalProcessLivenessProbe();
  assert.equal(probe.probe(process.pid), "alive");
  // A pid far above the configured maximum cannot exist.
  assert.equal(probe.probe(0x7ffffff0), "dead");
  // pid 0 and negatives address process GROUPS -- never treated as a process.
  assert.equal(probe.probe(0), "unknown");
  assert.equal(probe.probe(-1), "unknown");
  assert.equal(probe.probe(1.5), "unknown");
});

test("only a definitely-dead owner is recoverable", async (t) => {
  const root = await stateRoot(t);
  const store = new StateStore(root);
  const probe = new ScriptedProbe("alive");
  const lock = lockWith(store, { livenessProbe: probe });
  // Seed a lock owned by a notional other process.
  await store.createJsonAtomicExclusive(SCOPE, {
    version: 1,
    ownerId: "lock_" + "a".repeat(32),
    pid: 424242,
    host: hostname(),
    createdAt: new Date().toISOString(),
  });

  probe.set("alive");
  assert.equal(await lock.recoverIfOwnerDead(SCOPE), null, "alive must not recover");
  probe.set("unknown");
  assert.equal(await lock.recoverIfOwnerDead(SCOPE), null, "unknown must not recover");
  // Still exactly where it was.
  assert.equal((await lock.inspect(SCOPE)).state, "held");

  probe.set("dead");
  const recovered = await lock.recoverIfOwnerDead(SCOPE);
  assert.ok(recovered);
  assert.equal(recovered.pid, 424242);
  assert.deepEqual(await lock.inspect(SCOPE), { state: "free" });
});

test("a lock minted on another host is never recovered by pid", async (t) => {
  const root = await stateRoot(t);
  const store = new StateStore(root);
  // The probe would say "dead", but the host does not match, so the pid is
  // meaningless here and liveness must degrade to unknown.
  const probe = new ScriptedProbe("dead");
  const lock = lockWith(store, { livenessProbe: probe });
  await store.createJsonAtomicExclusive(SCOPE, {
    version: 1,
    ownerId: "lock_" + "b".repeat(32),
    pid: 777,
    host: "some-other-machine",
    createdAt: new Date().toISOString(),
  });

  const inspection = await lock.inspect(SCOPE);
  assert.equal(inspection.state, "held");
  assert.equal(inspection.state === "held" && inspection.liveness, "unknown");
  assert.equal(await lock.recoverIfOwnerDead(SCOPE), null);
  // The probe was never even consulted for a foreign host.
  assert.equal(probe.seen.length, 0);
  await assert.rejects(
    () => lock.withLock(SCOPE, async () => undefined),
    LockAcquisitionTimeout,
  );
  assert.equal((await lock.inspect(SCOPE)).state, "held");
});

// ---------------------------------------------------------------------------
// Real crashed processes
// ---------------------------------------------------------------------------

test("a lock held by a SIGKILLed process is recovered without manual deletion", async (t) => {
  const root = await stateRoot(t);
  const store = new StateStore(root);
  const holder = await spawnHolder(root, SCOPE);
  t.after(() => {
    holder.child.kill("SIGKILL");
  });

  // The lock really is held by the OTHER process.
  const held = await store.readJson<LockOwnerRecord>(SCOPE);
  assert.ok(held);
  assert.equal(held.pid, holder.pid);
  assert.notEqual(held.pid, process.pid);
  assert.equal(held.ownerId, holder.ownerId);

  await killAndReap(holder.child);

  // A fresh manager, as if Synaphex had restarted.
  const fresh = lockWith(new StateStore(root));
  let ranInside = false;
  await fresh.withLock(SCOPE, async () => {
    ranInside = true;
    const now = await fresh.inspect(SCOPE);
    assert.equal(now.state, "held");
    // A NEW generation, not the dead one.
    assert.notEqual(now.state === "held" ? now.owner.ownerId : "", holder.ownerId);
    assert.equal(now.state === "held" ? now.owner.pid : 0, process.pid);
  });
  assert.equal(ranInside, true);
  assert.deepEqual(await fresh.inspect(SCOPE), { state: "free" });
});

test("a live holder is never displaced, and the lock frees on its normal exit", async (t) => {
  const root = await stateRoot(t);
  const holder = await spawnHolder(root, SCOPE);
  t.after(() => {
    holder.child.kill("SIGKILL");
  });

  const contender = lockWith(new StateStore(root));
  // The owner is genuinely alive, so this must time out rather than steal.
  await assert.rejects(
    () => contender.withLock(SCOPE, async () => undefined),
    (error: unknown) => {
      assert.ok(error instanceof LockAcquisitionTimeout);
      assert.equal(error.reason, "contended");
      return true;
    },
  );
  // Untouched: still the child's exact generation.
  const stillHeld = await contender.inspect(SCOPE);
  assert.equal(stillHeld.state, "held");
  assert.equal(stillHeld.state === "held" ? stillHeld.owner.ownerId : "", holder.ownerId);

  await killAndReap(holder.child);
  // Now the same contender succeeds, with no manual cleanup in between.
  await contender.withLock(SCOPE, async () => undefined);
});

test("a holder that exits normally releases its lock", async (t) => {
  const root = await stateRoot(t);
  const holder = await spawnHolder(root, SCOPE, "release");
  await new Promise<void>((resolve) => holder.child.once("exit", () => resolve()));
  const lock = lockWith(new StateStore(root));
  assert.deepEqual(await lock.inspect(SCOPE), { state: "free" });
});

// ---------------------------------------------------------------------------
// Generation safety: the critical guarantees
// ---------------------------------------------------------------------------

test("a stale recoverer restores a generation it did not expect", async (t) => {
  const root = await stateRoot(t);
  const store = new StateStore(root);
  const probe = new ScriptedProbe("dead");
  // The seam fires after the dead owner was read and BEFORE the capture, so
  // the recoverer goes on to capture a generation it never proved dead.
  let swapped = false;
  const lock = lockWith(store, {
    livenessProbe: probe,
    beforeCapture: async () => {
      if (swapped) {
        return;
      }
      swapped = true;
      // A's process died, its lock was reclaimed, and B took the path -- all
      // between the recoverer's read and its capture.
      await store.removeFile(SCOPE);
      await store.createJsonAtomicExclusive(SCOPE, {
        version: 1,
        ownerId: "lock_" + "b".repeat(32),
        pid: process.pid,
        host: hostname(),
        createdAt: new Date().toISOString(),
      });
    },
  });
  await store.createJsonAtomicExclusive(SCOPE, {
    version: 1,
    ownerId: "lock_" + "a".repeat(32),
    pid: 424242,
    host: hostname(),
    createdAt: new Date().toISOString(),
  });

  // The recoverer proved A dead, but B is what it captured.
  const recovered = await lock.recoverIfOwnerDead(SCOPE);
  assert.equal(recovered, null, "must not report recovering a generation it did not own");
  // B survives, untouched.
  const after = await lock.inspect(SCOPE);
  assert.equal(after.state, "held");
  assert.equal(after.state === "held" ? after.owner.ownerId : "", "lock_" + "b".repeat(32));
});

test("a losing restore never clobbers an owner that claimed the freed path", async (t) => {
  const root = await stateRoot(t);
  const store = new StateStore(root);
  const deadOwner = `lock_${"a".repeat(32)}`;
  const liveOwner = `lock_${"c".repeat(32)}`;

  // The recoverer proves A dead, but between its read and its capture the
  // path is replaced TWICE: first by B, and then -- while the recoverer holds
  // B in quarantine -- by C. Its restore of B must therefore lose.
  let staged = false;
  const lock = lockWith(store, {
    livenessProbe: new ScriptedProbe("dead"),
    beforeCapture: async () => {
      if (staged) {
        return;
      }
      staged = true;
      await store.removeFile(SCOPE);
      await store.createJsonAtomicExclusive(SCOPE, {
        version: 1,
        ownerId: `lock_${"b".repeat(32)}`,
        pid: process.pid,
        host: hostname(),
        createdAt: new Date().toISOString(),
      });
    },
    afterCapture: async () => {
      // C wins the momentarily-free path while B sits in quarantine.
      await store.createJsonAtomicExclusive(SCOPE, {
        version: 1,
        ownerId: liveOwner,
        pid: process.pid,
        host: hostname(),
        createdAt: new Date().toISOString(),
      });
    },
  });
  await store.createJsonAtomicExclusive(SCOPE, {
    version: 1,
    ownerId: deadOwner,
    pid: 424242,
    host: hostname(),
    createdAt: new Date().toISOString(),
  });

  assert.equal(await lock.recoverIfOwnerDead(SCOPE), null);

  // C -- the live owner -- must still hold the lock. A restore performed with
  // `rename` would silently overwrite it with the quarantined B.
  const after = await lock.inspect(SCOPE);
  assert.equal(after.state, "held");
  assert.equal(
    after.state === "held" ? after.owner.ownerId : "",
    liveOwner,
    "the restore must lose rather than clobber a newer owner",
  );
  // And the abandoned quarantine copy is not left lying around.
  const residue = await readdir(join(root, "state", ".lock-quarantine")).catch(
    () => [] as string[],
  );
  assert.deepEqual(residue, []);
});

test("a late release from a recovered holder cannot delete its successor", async (t) => {
  const root = await stateRoot(t);
  const store = new StateStore(root);
  const probe = new ScriptedProbe("dead");
  const lock = lockWith(store, { livenessProbe: probe });

  // Holder A acquires and stalls inside its operation.
  let releaseA: () => void = () => {};
  const aInside = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  let announceA: (ownerId: string) => void = () => {};
  const aEntered = new Promise<string>((resolve) => {
    announceA = resolve;
  });
  const holderA = lock.withLock(SCOPE, async () => {
    const held = await lock.inspect(SCOPE);
    announceA(held.state === "held" ? held.owner.ownerId : "");
    await aInside;
  });
  // Barrier, not a sleep: A tells us when it is inside.
  const ownerA = await aEntered;
  assert.match(ownerA, /^lock_/);

  // A's generation is recovered out from under it (as if A's process died and
  // the record were reclaimed), and B takes the lock.
  await lock.recoverIfOwnerDead(SCOPE);
  const ownerB = "lock_" + "c".repeat(32);
  assert.equal(
    await store.createJsonAtomicExclusive(SCOPE, {
      version: 1,
      ownerId: ownerB,
      pid: process.pid,
      host: hostname(),
      createdAt: new Date().toISOString(),
    }),
    true,
  );

  // NOW A's finally block runs, late.
  releaseA();
  await holderA;

  // B is still the owner: the ownerId check refused A's stale cleanup.
  const after = await lock.inspect(SCOPE);
  assert.equal(after.state, "held");
  assert.equal(after.state === "held" ? after.owner.ownerId : "", ownerB);
});

test("concurrent contenders recover one dead generation and stay serialised", async (t) => {
  const root = await stateRoot(t);
  const store = new StateStore(root);
  const deadOwner = "lock_" + "d".repeat(32);
  await store.createJsonAtomicExclusive(SCOPE, {
    version: 1,
    ownerId: deadOwner,
    pid: 424242,
    host: hostname(),
    createdAt: new Date().toISOString(),
  });

  // Every contender believes the seeded pid is dead, and its own is alive.
  const probe: ProcessLivenessProbe = {
    probe: (pid) => (pid === 424242 ? "dead" : "alive"),
  };

  let inside = 0;
  let maxConcurrent = 0;
  const order: string[] = [];
  const contenders = Array.from({ length: 8 }, (_, index) => {
    const lock = new RecoverableProcessLock(store, {
      retryCount: 2000,
      retryDelayMs: 1,
      livenessProbe: probe,
    });
    return lock.withLock(SCOPE, async () => {
      inside += 1;
      maxConcurrent = Math.max(maxConcurrent, inside);
      const held = await lock.inspect(SCOPE);
      // Whoever is inside must own the CURRENT generation, never the dead one.
      assert.equal(held.state, "held");
      assert.notEqual(held.state === "held" ? held.owner.ownerId : "", deadOwner);
      order.push(`c${index}`);
      await new Promise((resolve) => setImmediate(resolve));
      inside -= 1;
    });
  });
  await Promise.all(contenders);

  // The dead generation was recovered, everyone ran, and never in parallel.
  assert.equal(maxConcurrent, 1, "recovery must not admit two holders at once");
  assert.equal(order.length, 8);
  assert.equal(new Set(order).size, 8);
  assert.deepEqual(await new RecoverableProcessLock(store).inspect(SCOPE), {
    state: "free",
  });
});

test("quarantine leaves no residue after successful recoveries", async (t) => {
  const root = await stateRoot(t);
  const store = new StateStore(root);
  const lock = lockWith(store, { livenessProbe: new ScriptedProbe("dead") });
  for (let i = 0; i < 3; i += 1) {
    await store.createJsonAtomicExclusive(SCOPE, {
      version: 1,
      ownerId: `lock_${String(i).repeat(32)}`,
      pid: 424242,
      host: hostname(),
      createdAt: new Date().toISOString(),
    });
    assert.ok(await lock.recoverIfOwnerDead(SCOPE));
  }
  // Recovery markers are transient, never accumulating state.
  const quarantine = join(root, "state", ".lock-quarantine");
  const residue = await readdir(quarantine).catch(() => [] as string[]);
  assert.deepEqual(residue, [], `quarantine residue: ${residue.join(", ")}`);
});

// ---------------------------------------------------------------------------
// Legacy artifacts
// ---------------------------------------------------------------------------

test("a legacy lock without an owner record is never auto-deleted", async (t) => {
  const root = await stateRoot(t);
  const store = new StateStore(root);
  // Exactly the pre-5D shape written by all four domains.
  const legacy = {
    token: "0f2f4e2c-1d5a-4f1e-9a1f-1c2b3d4e5f60",
    processId: 424242,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  await store.createJsonAtomicExclusive(SCOPE, legacy);
  // Even a probe that would call the pid dead must not license deletion:
  // without an ownerId there is no generation to recover safely.
  const lock = lockWith(store, { livenessProbe: new ScriptedProbe("dead") });

  const inspection = await lock.inspect(SCOPE);
  assert.equal(inspection.state, "legacy");
  assert.equal(await lock.recoverIfOwnerDead(SCOPE), null);
  await assert.rejects(
    () => lock.withLock(SCOPE, async () => undefined),
    (error: unknown) => {
      assert.ok(error instanceof LockAcquisitionTimeout);
      assert.equal(error.reason, "legacy_lock_recovery_required");
      return true;
    },
  );
  // Byte-identical: nothing touched it.
  assert.deepEqual(JSON.parse(await readFile(join(root, SCOPE), "utf8")), legacy);
});

test("a malformed lock artifact fails closed rather than being cleared", async (t) => {
  const root = await stateRoot(t);
  const store = new StateStore(root);
  await store.createJsonAtomicExclusive(SCOPE, { nonsense: true });
  const lock = lockWith(store, { livenessProbe: new ScriptedProbe("dead") });

  assert.deepEqual(await lock.inspect(SCOPE), { state: "malformed" });
  assert.equal(await lock.recoverIfOwnerDead(SCOPE), null);
  await assert.rejects(
    () => lock.withLock(SCOPE, async () => undefined),
    (error: unknown) => {
      assert.ok(error instanceof LockAcquisitionTimeout);
      assert.equal(error.reason, "malformed_lock");
      return true;
    },
  );
  assert.equal(await store.exists(SCOPE), true);
});

// ---------------------------------------------------------------------------
// Domain migrations keep their own public error identity
// ---------------------------------------------------------------------------

async function domainFixture(t: TestContext) {
  const root = await stateRoot(t);
  const home = join(root, "home");
  const source = join(root, "source");
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(source, { recursive: true }),
  ]);
  const store = new StateStore(join(root, "state-root"));
  const projects = new ProjectManager(store, { homeDirectory: home });
  const tasks = new TaskManager(store, projects);
  const project = await projects.create("Lock Project", source);
  const task = await tasks.create(project.id, "A task");
  return { root, store, projects, tasks, project, task };
}

/** A lock that can never be acquired, to force each domain's timeout path. */
function alwaysContended(store: StateStore): RecoverableProcessLock {
  return new RecoverableProcessLock(store, {
    retryCount: 1,
    retryDelayMs: 1,
    // Its own pid is alive, so nothing is ever recoverable.
    livenessProbe: { probe: () => "alive" },
  });
}

test("each migrated domain preserves its distinct public lock-timeout code", async (t) => {
  const f = await domainFixture(t);
  const contended = alwaysContended(f.store);

  // Seed every domain's lock path as held by a live foreign owner.
  for (const scope of [
    "state/task-bindings/.ownership-lock.json",
    "state/memory-graph/.mutation-lock.json",
    "state/plans/.mutation-lock.json",
  ]) {
    await f.store.createJsonAtomicExclusive(scope, {
      version: 1,
      ownerId: `lock_${"e".repeat(32)}`,
      pid: 424242,
      host: hostname(),
      createdAt: new Date().toISOString(),
    });
  }

  // `bindTask` is the task-binding lock's user; `bindProject` deliberately
  // does not take it, so bind the project first with an unblocked manager.
  const sessionId = generateSessionId();
  await new SessionManager(f.store).bindProject(sessionId, f.project.id);
  const sessions = new SessionManager(f.store, contended);
  await assert.rejects(
    () => sessions.bindTask(sessionId, f.task.id),
    TaskBindingLockTimeoutError,
  );

  const plans = new PlanManager(f.store, f.tasks, contended);
  await assert.rejects(
    () => plans.saveDraft(f.task.id, "# draft\n"),
    PlanMutationLockTimeoutError,
  );

  const memory = new MemoryManager(f.store, f.projects, f.tasks, contended);
  await assert.rejects(
    () =>
      memory.load(
        { kind: "task", projectId: f.project.id, taskId: f.task.id },
        {
          kind: "project",
          projectId: f.project.id,
          projectName: f.project.name,
        },
      ),
    MemoryMutationLockTimeoutError,
  );
});

test("a dead owner unblocks each migrated domain without manual deletion", async (t) => {
  const f = await domainFixture(t);
  // Only the seeded foreign pid is dead; our own is alive.
  const recovering = () =>
    new RecoverableProcessLock(f.store, {
      retryCount: 50,
      retryDelayMs: 1,
      livenessProbe: { probe: (pid) => (pid === 424242 ? "dead" : "alive") },
    });
  const seed = async (scope: string) => {
    await f.store.createJsonAtomicExclusive(scope, {
      version: 1,
      ownerId: `lock_${"f".repeat(32)}`,
      pid: 424242,
      host: hostname(),
      createdAt: new Date().toISOString(),
    });
  };

  const sessionId = generateSessionId();
  await new SessionManager(f.store).bindProject(sessionId, f.project.id);
  await seed("state/task-bindings/.ownership-lock.json");
  const bound = await new SessionManager(f.store, recovering()).bindTask(
    sessionId,
    f.task.id,
  );
  assert.equal(bound.taskId, f.task.id);

  await seed("state/plans/.mutation-lock.json");
  const draft = await new PlanManager(f.store, f.tasks, recovering()).saveDraft(
    f.task.id,
    "# draft\n",
  );
  assert.match(draft.revisionId, /^planrev_/);

  await seed("state/memory-graph/.mutation-lock.json");
  const reference = await new MemoryManager(
    f.store,
    f.projects,
    f.tasks,
    recovering(),
  ).load(
    { kind: "task", projectId: f.project.id, taskId: f.task.id },
    { kind: "project", projectId: f.project.id, projectName: f.project.name },
  );
  assert.equal(reference.source.kind, "project");
});

// ---------------------------------------------------------------------------
// Structural audits
// ---------------------------------------------------------------------------

test("every lock domain routes through the one shared primitive", async () => {
  const { readFile: read } = await import("node:fs/promises");
  const domains = [
    "src/core/session-manager.ts",
    "src/core/memory-manager.ts",
    "src/core/plan-manager.ts",
    "src/core/change-set-apply-manager.ts",
  ];
  for (const path of domains) {
    const raw = await read(join(process.cwd(), path), "utf8");
    const code = raw
      .replaceAll(/\/\*[\s\S]*?\*\//g, "")
      .replaceAll(/\/\/.*$/gm, "");
    assert.ok(
      code.includes("this.lock.withLock("),
      `${path} must acquire through RecoverableProcessLock`,
    );
    // No domain keeps a private retry loop or its own lock constants any more.
    for (const forbidden of ["LOCK_RETRY_COUNT", "LOCK_RETRY_DELAY_MS"]) {
      assert.equal(
        code.includes(forbidden),
        false,
        `${path} still owns a hand-rolled lock loop (${forbidden})`,
      );
    }
  }
});

test("the lock primitive is TTL-free and expiry-free by construction", async () => {
  const { readFile: read } = await import("node:fs/promises");
  const raw = await read(
    join(process.cwd(), "src/infrastructure/recoverable-process-lock.ts"),
    "utf8",
  );
  const code = raw
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/\/\/.*$/gm, "");
  // Lock AGE is never evidence: no TTL, heartbeat or expiry may appear in the
  // executable code. `createdAt` is recorded for diagnostics only and is never
  // compared against a clock.
  for (const forbidden of [
    "ttl",
    "TTL",
    "heartbeat",
    "expiry",
    "expires",
    "staleAfter",
    "maxAgeMs",
    "Date.now()",
  ]) {
    assert.equal(
      code.includes(forbidden),
      false,
      `lock primitive must not reference ${forbidden}`,
    );
  }
  // The owner record is recorded but its timestamp is never read back.
  assert.equal(code.includes("Date.parse"), false);
});

test("the MCP surface gains no lock tool in this slice", async () => {
  const { SYNAPHEX_MCP_TOOLS } = await import("../src/index.js");
  assert.equal(SYNAPHEX_MCP_TOOLS.length, 25);
  for (const absent of [
    "synaphex_force_unlock",
    "synaphex_delete_lock",
    "synaphex_recover_lock",
    "synaphex_inspect_lock",
  ]) {
    assert.equal(
      (SYNAPHEX_MCP_TOOLS as readonly string[]).includes(absent),
      false,
      `${absent} must not exist`,
    );
  }
});
