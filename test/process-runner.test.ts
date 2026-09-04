import assert from "node:assert/strict";
import test from "node:test";
import { SpawnProcessRunner } from "../src/infrastructure/process-runner.js";

test("SpawnProcessRunner passes literal arguments without a shell", async () => {
  const literal = "literal;$(must-not-execute)";
  const result = await new SpawnProcessRunner().run({
    executable: "/bin/echo",
    args: [literal],
    stdin: "",
    timeoutMs: 5_000,
    terminationGraceMs: 100,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, `${literal}\n`);
  assert.equal(result.timedOut, false);
});

test("SpawnProcessRunner terminates a timed-out child", async () => {
  const startedAt = Date.now();
  const result = await new SpawnProcessRunner().run({
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    stdin: "",
    timeoutMs: 50,
    terminationGraceMs: 50,
  });

  assert.equal(result.timedOut, true);
  assert.ok(result.signal === "SIGTERM" || result.signal === "SIGKILL");
  assert.ok(Date.now() - startedAt < 2_000);
});

test("SpawnProcessRunner supports bounded full stdout with explicit overflow", async () => {
  const result = await new SpawnProcessRunner().run({
    executable: "/bin/echo",
    args: ["abcdefghijklmnopqrstuvwxyz"],
    stdin: "",
    timeoutMs: 5_000,
    terminationGraceMs: 100,
    stdoutCaptureMode: "full",
    stdoutLimitBytes: 8,
    stderrTailLimitBytes: 4,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "abcdefgh");
  assert.equal(result.stdoutOverflowed, true);
  assert.equal(result.stderr, "");
  assert.equal(result.stderrOverflowed, false);
});
