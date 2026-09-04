import assert from "node:assert/strict";
import test from "node:test";
import type {
  ProcessResult,
  ProcessRunInput,
  ProcessRunner,
} from "../src/infrastructure/process-runner.js";
import {
  ANTIGRAVITY_REQUIRED_HELP_FLAGS,
  AntigravityCliRuntimeAvailability,
} from "../src/providers/antigravity-cli-runtime-availability.js";

class FakeRunner implements ProcessRunner {
  readonly calls: ProcessRunInput[] = [];
  constructor(private readonly outcomes: Array<ProcessResult | Error>) {}
  async run(input: ProcessRunInput): Promise<ProcessResult> {
    this.calls.push(input);
    const outcome = this.outcomes.shift();
    assert.ok(outcome, "missing fake probe outcome");
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
}

const completeHelp = [
  "-p Short alias for --print",
  "--output-format text json stream-json",
  "--json-schema schema",
  "--model model",
  "--mode accept-edits plan",
  "--sandbox sandbox",
  "--print-timeout timeout",
  "--disable-slash-commands disabled",
].join("\n");

test("Antigravity availability uses only version and help probes", async () => {
  const runner = new FakeRunner([result("1.1.26"), result(completeHelp)]);
  const availability = new AntigravityCliRuntimeAvailability({
    processRunner: runner,
    executable: "/custom/agy",
  });
  assert.deepEqual(await availability.probe(), {
    available: true,
    version: "1.1.26",
  });
  assert.deepEqual(runner.calls.map((call) => call.args), [
    ["--version"],
    ["--help"],
  ]);
  for (const call of runner.calls) {
    assert.equal(call.executable, "/custom/agy");
    assert.equal(call.stdin, "");
    assert.equal(call.env, undefined);
    assert.equal(call.args.includes("-p"), false);
  }
});

test("Antigravity availability rejects unrelated provider surfaces without probing", async () => {
  const runner = new FakeRunner([]);
  const availability = new AntigravityCliRuntimeAvailability({ processRunner: runner });
  assert.equal(await availability.isAvailable("google", "vscode"), false);
  assert.equal(await availability.isAvailable("anthropic", "cli"), false);
  assert.equal(runner.calls.length, 0);
});

test("Antigravity availability reports missing executable and invalid version", async () => {
  const missing = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  assert.deepEqual(
    await new AntigravityCliRuntimeAvailability({ processRunner: new FakeRunner([missing]) }).probe(),
    { available: false, reason: "executable_missing" },
  );
  assert.deepEqual(
    await new AntigravityCliRuntimeAvailability({ processRunner: new FakeRunner([result("agy unknown")]) }).probe(),
    { available: false, reason: "invalid_version" },
  );
});

test("Antigravity availability fails closed when a mandatory flag or mode is absent", async () => {
  for (const missing of [...ANTIGRAVITY_REQUIRED_HELP_FLAGS, "accept-edits", "plan"] as const) {
    const help = completeHelp.replace(missing, "removed");
    const probe = await new AntigravityCliRuntimeAvailability({
      processRunner: new FakeRunner([result("1.1.26"), result(help)]),
    }).probe();
    assert.equal(probe.available, false, missing);
    if (!probe.available) {
      assert.equal(probe.reason, "required_cli_capability_unavailable", missing);
      assert.equal(probe.version, "1.1.26", missing);
    }
  }
});

function result(
  stdout: string,
  overrides: Partial<ProcessResult> = {},
): ProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stdout,
    stderr: "",
    timedOut: false,
    ...overrides,
  };
}
