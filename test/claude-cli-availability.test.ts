import assert from "node:assert/strict";
import test from "node:test";
import type {
  ProcessResult,
  ProcessRunInput,
  ProcessRunner,
} from "../src/infrastructure/process-runner.js";
import {
  CLAUDE_ISOLATION_CAPABILITY_PROBE_ARGS,
  CLAUDE_MINIMUM_CLI_VERSION,
  ClaudeCliRuntimeAvailability,
} from "../src/providers/claude-cli-runtime-availability.js";

class FakeRunner implements ProcessRunner {
  readonly calls: ProcessRunInput[] = [];

  constructor(private readonly outcomes: Array<ProcessResult | Error>) {}

  async run(input: ProcessRunInput): Promise<ProcessResult> {
    this.calls.push(input);
    const outcome = this.outcomes.shift();
    assert.ok(outcome, "missing fake probe outcome");
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome;
  }
}

test("Claude availability enforces the exact minimum semantic version", async () => {
  const cases = [
    ["2.1.112 (Claude Code)", false, "version_too_old", 1],
    ["2.1.247 (Claude Code)", false, "version_too_old", 1],
    ["2.1.248-beta.1 (Claude Code)", false, "version_too_old", 1],
    ["2.1.248 (Claude Code)", true, undefined, 2],
    ["2.2.0 (Claude Code)", true, undefined, 2],
    ["3.0.0+build.7 (Claude Code)", true, undefined, 2],
  ] as const;

  assert.equal(CLAUDE_MINIMUM_CLI_VERSION, "2.1.248");
  for (const [versionText, available, reason, expectedCalls] of cases) {
    const runner = new FakeRunner([version(versionText), version(versionText)]);
    const probe = await new ClaudeCliRuntimeAvailability({
      processRunner: runner,
    }).probe();
    assert.equal(probe.available, available, versionText);
    if (!probe.available) {
      assert.equal(probe.reason, reason, versionText);
    }
    assert.equal(runner.calls.length, expectedCalls, versionText);
  }
});

test("Claude availability performs only version and non-model isolation parser probes", async () => {
  const runner = new FakeRunner([
    version("2.1.248 (Claude Code)"),
    version("2.1.248 (Claude Code)"),
  ]);
  const availability = new ClaudeCliRuntimeAvailability({
    processRunner: runner,
    executable: "/custom/claude",
  });

  assert.deepEqual(await availability.probe(), {
    available: true,
    version: "2.1.248",
  });
  assert.deepEqual(runner.calls.map((call) => call.args), [
    ["--version"],
    [...CLAUDE_ISOLATION_CAPABILITY_PROBE_ARGS],
  ]);
  for (const call of runner.calls) {
    assert.equal(call.executable, "/custom/claude");
    assert.equal(call.stdin, "");
    assert.equal(call.args.includes("-p"), false);
    assert.equal(call.args.includes("--help"), false);
    assert.equal(JSON.stringify(call).toLowerCase().includes("auth"), false);
  }
});

test("Claude availability does not use incomplete help text as a compatibility gate", async () => {
  const runner = new FakeRunner([
    version("2.1.249 (Claude Code)"),
    version("2.1.249 (Claude Code)"),
  ]);
  const availability = new ClaudeCliRuntimeAvailability({
    processRunner: runner,
  });

  assert.equal(await availability.isAvailable("anthropic", "cli"), true);
  assert.equal(runner.calls.some((call) => call.args.includes("--help")), false);
});

test("Claude availability rejects unrelated provider surfaces without probing", async () => {
  const runner = new FakeRunner([]);
  const availability = new ClaudeCliRuntimeAvailability({
    processRunner: runner,
  });
  assert.equal(await availability.isAvailable("anthropic", "vscode"), false);
  assert.equal(await availability.isAvailable("openai", "cli"), false);
  assert.equal(runner.calls.length, 0);
});

test("Claude availability distinguishes missing executable and failed version probes", async () => {
  const missing = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  assert.deepEqual(
    await new ClaudeCliRuntimeAvailability({
      processRunner: new FakeRunner([missing]),
    }).probe(),
    { available: false, reason: "executable_missing" },
  );

  for (const outcome of [
    version("", { exitCode: 1 }),
    version("", { timedOut: true }),
    new Error("unexpected spawn failure"),
  ]) {
    assert.deepEqual(
      await new ClaudeCliRuntimeAvailability({
        processRunner: new FakeRunner([outcome]),
      }).probe(),
      { available: false, reason: "version_probe_failed" },
    );
  }
});

test("Claude availability rejects malformed versions", async () => {
  for (const versionText of ["Claude Code unknown", "2.1", "vNext"]) {
    assert.deepEqual(
      await new ClaudeCliRuntimeAvailability({
        processRunner: new FakeRunner([version(versionText)]),
      }).probe(),
      { available: false, reason: "invalid_version" },
    );
  }
});

test("Claude availability fails closed when compatible CLI rejects isolation flags", async () => {
  const runner = new FakeRunner([
    version("2.1.248 (Claude Code)"),
    version("", { exitCode: 1, stderr: "unknown option --restricted" }),
  ]);
  assert.deepEqual(
    await new ClaudeCliRuntimeAvailability({ processRunner: runner }).probe(),
    {
      available: false,
      reason: "required_cli_capability_unavailable",
      version: "2.1.248",
    },
  );
  assert.deepEqual(runner.calls[1]?.args, [
    "--safe-mode",
    "--restricted",
    "--version",
  ]);
});

function version(
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
