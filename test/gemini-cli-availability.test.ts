import assert from "node:assert/strict";
import test from "node:test";
import type {
  ProcessResult,
  ProcessRunInput,
  ProcessRunner,
} from "../src/infrastructure/process-runner.js";
import {
  GEMINI_CALLABLE_CAPABILITY_PROBE_ARGS,
  GeminiCliRuntimeAvailability,
} from "../src/providers/gemini-cli-runtime-availability.js";

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

test("Gemini availability performs only version-ending non-model probes", async () => {
  const runner = new FakeRunner([version("0.55.1"), version("0.55.1")]);
  const availability = new GeminiCliRuntimeAvailability({
    processRunner: runner,
    executable: "/custom/gemini",
  });
  assert.deepEqual(await availability.probe(), {
    available: true,
    version: "0.55.1",
  });
  assert.deepEqual(runner.calls.map((call) => call.args), [
    ["--version"],
    [...GEMINI_CALLABLE_CAPABILITY_PROBE_ARGS],
  ]);
  assert.equal(GEMINI_CALLABLE_CAPABILITY_PROBE_ARGS.at(-1), "--version");
  for (const call of runner.calls) {
    assert.equal(call.executable, "/custom/gemini");
    assert.equal(call.stdin, "");
    assert.equal(call.env, undefined);
    assert.equal(JSON.stringify(call).toLowerCase().includes("auth"), false);
  }
});

test("Gemini capability probe covers every mandatory callable flag", () => {
  const args = GEMINI_CALLABLE_CAPABILITY_PROBE_ARGS;
  for (const option of [
    "-p",
    "--output-format",
    "--model",
    "--approval-mode",
    "--extensions",
    "--policy",
    "--allowed-mcp-server-names",
    "--include-directories",
    "--version",
  ]) {
    assert.ok(args.includes(option as never), option);
  }
  assert.equal(args.includes("--resume" as never), false);
  assert.equal(args.includes("--yolo" as never), false);
  assert.equal(args.includes("--acp" as never), false);
});

test("Gemini availability rejects unrelated routes without probing", async () => {
  const runner = new FakeRunner([]);
  const availability = new GeminiCliRuntimeAvailability({ processRunner: runner });
  assert.equal(await availability.isAvailable("google", "vscode"), false);
  assert.equal(await availability.isAvailable("openai", "cli"), false);
  assert.equal(runner.calls.length, 0);
});

test("Gemini availability distinguishes missing, failed, malformed, and incompatible probes", async () => {
  const missing = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  assert.deepEqual(
    await new GeminiCliRuntimeAvailability({ processRunner: new FakeRunner([missing]) }).probe(),
    { available: false, reason: "executable_missing" },
  );
  assert.deepEqual(
    await new GeminiCliRuntimeAvailability({ processRunner: new FakeRunner([version("", { exitCode: 1 })]) }).probe(),
    { available: false, reason: "version_probe_failed" },
  );
  assert.deepEqual(
    await new GeminiCliRuntimeAvailability({ processRunner: new FakeRunner([version("Gemini unknown")]) }).probe(),
    { available: false, reason: "invalid_version" },
  );
  assert.deepEqual(
    await new GeminiCliRuntimeAvailability({
      processRunner: new FakeRunner([
        version("v0.55.1 (Gemini CLI)"),
        version("", { exitCode: 1, stderr: "Unknown argument: policy" }),
      ]),
    }).probe(),
    {
      available: false,
      reason: "required_cli_capability_unavailable",
      version: "0.55.1",
    },
  );
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
