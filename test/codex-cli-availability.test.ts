import assert from "node:assert/strict";
import test from "node:test";
import type {
  ProcessResult,
  ProcessRunInput,
  ProcessRunner,
} from "../src/infrastructure/process-runner.js";
import { CodexCliRuntimeAvailability } from "../src/providers/codex-cli-runtime-availability.js";

class FakeRunner implements ProcessRunner {
  readonly calls: ProcessRunInput[] = [];

  constructor(
    private readonly outcome: ProcessResult | Error,
  ) {}

  async run(input: ProcessRunInput): Promise<ProcessResult> {
    this.calls.push(input);
    if (this.outcome instanceof Error) {
      throw this.outcome;
    }
    return this.outcome;
  }
}

const availableResult: ProcessResult = {
  exitCode: 0,
  signal: null,
  stdout: "codex-cli 0.153.0",
  stderr: "",
  timedOut: false,
};

test("Codex availability checks only the safe version command", async () => {
  const runner = new FakeRunner(availableResult);
  const availability = new CodexCliRuntimeAvailability({
    processRunner: runner,
  });

  assert.deepEqual(await availability.probe(), {
    available: true,
    version: "0.153.0",
  });
  assert.equal(await availability.isAvailable("openai", "cli"), true);
  assert.equal(await availability.isAvailable("openai", "vscode"), false);
  assert.equal(await availability.isAvailable("anthropic", "cli"), false);
  assert.equal(runner.calls.length, 2);
  assert.equal(runner.calls[0]?.executable, "codex");
  for (const call of runner.calls) {
    assert.deepEqual(call.args, ["--version"]);
    assert.equal(call.stdin, "");
    assert.equal(call.args.includes("exec"), false);
    assert.equal(JSON.stringify(call).includes("auth"), false);
  }
});

test("a successful malformed Codex version remains available without a version", async () => {
  for (const stdout of [
    "codex-cli unknown",
    "codex-cli 0.153",
    "unrelated 0.153.0",
  ]) {
    const availability = new CodexCliRuntimeAvailability({
      processRunner: new FakeRunner({ ...availableResult, stdout }),
    });
    assert.deepEqual(await availability.probe(), { available: true }, stdout);
  }
});

test("non-zero, timeout, and missing executable are unavailable", async () => {
  const cases: Array<ProcessResult | Error> = [
    { ...availableResult, exitCode: 1 },
    { ...availableResult, timedOut: true },
    Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
  ];
  for (const [index, outcome] of cases.entries()) {
    const availability = new CodexCliRuntimeAvailability({
      processRunner: new FakeRunner(outcome),
      executable: "/custom/codex",
    });
    assert.deepEqual(await availability.probe(), {
      available: false,
      reason: index === 2 ? "executable_missing" : "version_probe_failed",
    });
  }
});
