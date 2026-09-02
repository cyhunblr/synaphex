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
  stdout: "codex-cli 0.146.0",
  stderr: "",
  timedOut: false,
};

test("Codex availability checks only the safe version command", async () => {
  const runner = new FakeRunner(availableResult);
  const availability = new CodexCliRuntimeAvailability({
    processRunner: runner,
  });

  assert.equal(await availability.isAvailable("openai", "cli"), true);
  assert.equal(await availability.isAvailable("openai", "vscode"), false);
  assert.equal(await availability.isAvailable("anthropic", "cli"), false);
  assert.equal(runner.calls.length, 1);
  assert.equal(runner.calls[0]?.executable, "codex");
  assert.deepEqual(runner.calls[0]?.args, ["--version"]);
  assert.equal(runner.calls[0]?.stdin, "");
  assert.equal(runner.calls[0]?.args.includes("exec"), false);
  assert.equal(JSON.stringify(runner.calls[0]).includes("auth"), false);
});

test("non-zero, timeout, and missing executable are unavailable", async () => {
  const cases: Array<ProcessResult | Error> = [
    { ...availableResult, exitCode: 1 },
    { ...availableResult, timedOut: true },
    Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
  ];
  for (const outcome of cases) {
    const availability = new CodexCliRuntimeAvailability({
      processRunner: new FakeRunner(outcome),
      executable: "/custom/codex",
    });
    assert.equal(await availability.isAvailable("openai", "cli"), false);
  }
});
