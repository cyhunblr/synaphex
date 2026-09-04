/**
 * Child process that acquires a real lock and then waits to be killed.
 *
 * Used by the Phase-5D crash tests so recovery is proven against a genuinely
 * dead OS process rather than hand-written stale JSON. It deliberately does
 * NOT release the lock: the parent SIGKILLs it, reproducing a crash exactly.
 *
 * Protocol on stdout, one JSON line: `{"ownerId":"lock_…","pid":1234}`.
 */
import { RecoverableProcessLock } from "../../src/infrastructure/recoverable-process-lock.js";
import { StateStore } from "../../src/infrastructure/state-store.js";

const [stateRoot, scope, mode] = process.argv.slice(2);
if (stateRoot === undefined || scope === undefined) {
  throw new Error("usage: lock-holder-child <stateRoot> <scope> [mode]");
}

const store = new StateStore(stateRoot);
const lock = new RecoverableProcessLock(store);

await lock.withLock(scope, async () => {
  const held = await lock.inspect(scope);
  if (held.state !== "held") {
    throw new Error(`expected a held lock, saw ${held.state}`);
  }
  process.stdout.write(
    `${JSON.stringify({ ownerId: held.owner.ownerId, pid: process.pid })}\n`,
  );
  if (mode === "release") {
    // Exit normally, releasing the lock through the owner-checked path.
    return;
  }
  // Hold until killed. An unresolved promise alone lets Node exit with an
  // "unsettled top-level await" warning, which would release the lock and
  // defeat the crash simulation -- a timer keeps the event loop referenced.
  await new Promise(() => {
    setInterval(() => {}, 1000);
  });
});
