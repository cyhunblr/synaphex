import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { AgentName } from "../src/domain/agent.js";
import type { AgentSettings } from "../src/domain/agent-config.js";
import type { AgentExecutionInput } from "../src/domain/agent-invocation.js";
import { AntigravityCliExecutionError } from "../src/domain/errors.js";
import type {
  ProcessResult,
  ProcessRunInput,
  ProcessRunner,
} from "../src/infrastructure/process-runner.js";
import {
  ANTIGRAVITY_FIXED_PRINT_INSTRUCTION,
  AntigravityCliAgentExecutor,
} from "../src/providers/antigravity-cli-agent-executor.js";
import { StandardAgentResultJsonSchemaBuilder } from "../src/providers/standard-agent-result-json-schema-builder.js";
import {
  syntheticAgentContext,
  syntheticExecutionPolicy,
} from "./fixtures/synthetic-agent-context.js";

class FakeRunner implements ProcessRunner {
  readonly calls: ProcessRunInput[] = [];
  constructor(
    private readonly handler: (
      input: ProcessRunInput,
    ) => ProcessResult | Promise<ProcessResult>,
  ) {}
  async run(input: ProcessRunInput): Promise<ProcessResult> {
    this.calls.push(input);
    return this.handler(input);
  }
}

const validResearcher = {
  agent: "researcher",
  outcome: "success",
  summary: "Antigravity adapter worked.",
  researchArtifact: { custom_field: "done" },
};

function success(
  structuredOutput: unknown = validResearcher,
  overrides: Partial<ProcessResult> = {},
): ProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: JSON.stringify({
      conversation_id: "provider-metadata-only",
      status: "SUCCESS",
      response: JSON.stringify(structuredOutput),
      structured_output: structuredOutput,
      usage: { total_tokens: 1 },
    }),
    stderr: "",
    timedOut: false,
    stdoutOverflowed: false,
    stderrOverflowed: false,
    ...overrides,
  };
}

async function workspace(t: TestContext): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "synaphex-antigravity-source-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

function executionInput(
  agent: AgentName,
  sourcePath: string,
  settings?: AgentSettings,
): AgentExecutionInput {
  return {
    route: {
      agent,
      host: { provider: "openai", surface: "vscode" },
      provider: "google",
      configuredSurface: "cli",
      effectiveSurface: "cli",
      cliForcedByCrossProvider: true,
      routingReason: "cross_provider_cli",
      model: "explicit-antigravity-model",
      ...(settings === undefined ? {} : { settings }),
    },
    context: syntheticAgentContext(agent, sourcePath),
    executionPolicy: syntheticExecutionPolicy(agent),
  };
}

function optionValue(args: readonly string[], option: string): string {
  const index = args.indexOf(option);
  assert.notEqual(index, -1, `missing ${option}`);
  const value = args[index + 1];
  assert.ok(value !== undefined, `missing value for ${option}`);
  return value;
}

test("Antigravity builds the exact fresh sandboxed read-only command and decodes native output", async (t) => {
  const sourcePath = await workspace(t);
  const providerConfig = join(sourcePath, ".gemini", "antigravity-cli", "settings.json");
  await mkdir(join(sourcePath, ".gemini", "antigravity-cli"), { recursive: true });
  await writeFile(providerConfig, "{\"preserve\":true}\n");
  const runner = new FakeRunner(() => success());
  const input = executionInput("researcher", sourcePath);
  const result = await new AntigravityCliAgentExecutor({ processRunner: runner }).execute(input);

  assert.deepEqual(result, validResearcher);
  const call = runner.calls[0]!;
  assert.equal(call.executable, "agy");
  assert.equal(call.cwd, sourcePath);
  assert.equal(call.env, undefined);
  assert.equal(optionValue(call.args, "-p"), ANTIGRAVITY_FIXED_PRINT_INSTRUCTION);
  assert.equal(optionValue(call.args, "--output-format"), "json");
  assert.deepEqual(
    JSON.parse(optionValue(call.args, "--json-schema")),
    new StandardAgentResultJsonSchemaBuilder().build(input.context),
  );
  assert.equal(optionValue(call.args, "--model"), "explicit-antigravity-model");
  assert.equal(optionValue(call.args, "--mode"), "plan");
  assert.ok(call.args.includes("--sandbox"));
  assert.ok(call.args.includes("--disable-slash-commands"));
  assert.equal(optionValue(call.args, "--print-timeout"), "1800000ms");
  for (const forbidden of [
    "--continue",
    "-c",
    "--conversation",
    "--dangerously-skip-permissions",
    "--prompt-interactive",
  ]) {
    assert.equal(call.args.includes(forbidden), false);
  }
  assert.equal(JSON.stringify(call.args).includes("Follow the explicit user instruction."), false);
  assert.match(call.stdin, /Follow the explicit user instruction\./);
  assert.match(call.stdin, /source repository is strictly read-only/i);
  assert.match(call.stdin, /request git_push through requestedActions/);
  assert.match(call.stdin, /request ci through requestedActions/);
  assert.equal(call.stdoutCaptureMode, "full");
  assert.equal(call.stdoutLimitBytes, 8 * 1024 * 1024);
  assert.equal(call.stderrTailLimitBytes, 64 * 1024);
  assert.equal(call.timeoutMs, 30 * 60 * 1_000);
  assert.equal(await readFile(providerConfig, "utf8"), "{\"preserve\":true}\n");
});

test("Antigravity workspace-write uses accept-edits while preserving sandbox", async (t) => {
  const sourcePath = await workspace(t);
  const output = {
    agent: "coder",
    outcome: "success",
    summary: "edited",
    workRecord: { custom_field: true },
  };
  const runner = new FakeRunner(() => success(output));
  await new AntigravityCliAgentExecutor({ processRunner: runner }).execute(
    executionInput("coder", sourcePath),
  );
  const call = runner.calls[0]!;
  assert.equal(optionValue(call.args, "--mode"), "accept-edits");
  assert.ok(call.args.includes("--sandbox"));
  assert.equal(call.args.includes("--dangerously-skip-permissions"), false);
  assert.match(call.stdin, /do not run arbitrary shell\/build\/test commands/i);
});

test("Antigravity rejects routes, settings, role-policy mismatch, and workspaces before spawn", async (t) => {
  const sourcePath = await workspace(t);
  const runner = new FakeRunner(() => success());
  const executor = new AntigravityCliAgentExecutor({ processRunner: runner });
  const base = executionInput("researcher", sourcePath);
  await assert.rejects(executor.execute({ ...base, route: { ...base.route, provider: "openai" } }), failure("unsupported_route"));
  await assert.rejects(executor.execute({ ...base, route: { ...base.route, effectiveSurface: "vscode" } }), failure("unsupported_route"));
  await assert.rejects(executor.execute(executionInput("researcher", sourcePath, { effort: "high" })), failure("unsupported_settings"));
  await assert.rejects(executor.execute({
    ...base,
    executionPolicy: { ...base.executionPolicy, sourceModification: "workspace_write" },
  }), failure("unsupported_execution_policy"));
  await assert.rejects(executor.execute(executionInput("researcher", join(sourcePath, "missing"))), failure("invalid_workspace"));
  const filePath = join(sourcePath, "file.txt");
  await writeFile(filePath, "file");
  await assert.rejects(executor.execute(executionInput("researcher", filePath)), failure("invalid_workspace"));
  assert.equal(runner.calls.length, 0);
});

test("Antigravity network-enabled policies fail before spawn", async (t) => {
  const sourcePath = await workspace(t);
  for (const network of [
    { decision: "allow", source: "global", approvedForInvocation: false },
    { decision: "ask", source: "task", approvedForInvocation: true },
  ] as const) {
    const runner = new FakeRunner(() => success());
    const input = executionInput("researcher", sourcePath);
    await assert.rejects(
      new AntigravityCliAgentExecutor({ processRunner: runner }).execute({
        ...input,
        executionPolicy: syntheticExecutionPolicy("researcher", { network }),
      }),
      (error: unknown) =>
        failure("unsupported_execution_policy")(error) &&
        (error as AntigravityCliExecutionError).details?.policyReason ===
          "network_capability_not_safely_enforceable",
    );
    assert.equal(runner.calls.length, 0);
  }
});

test("Antigravity maps bounded process failures and returns unknown candidates", async (t) => {
  const sourcePath = await workspace(t);
  const cases = [
    [success(undefined, { timedOut: true, exitCode: null, signal: "SIGTERM" }), "timeout"],
    [success(undefined, { stdoutOverflowed: true }), "stdout_overflow"],
    [success(undefined, { exitCode: 2, stderr: "provider failed" }), "non_zero_exit"],
    [success(undefined, { exitCode: 2, stderr: "flag provided but not defined: --sandbox" }), "unsupported_cli_capability"],
  ] as const;
  for (const [processResult, reason] of cases) {
    await assert.rejects(
      new AntigravityCliAgentExecutor({
        processRunner: new FakeRunner(() => processResult),
        includeStderrDiagnostic: true,
      }).execute(executionInput("researcher", sourcePath)),
      failure(reason),
    );
  }
  await assert.rejects(
    new AntigravityCliAgentExecutor({
      processRunner: new FakeRunner(() => { throw new Error("spawn"); }),
    }).execute(executionInput("researcher", sourcePath)),
    failure("spawn_failed"),
  );
  const malformedCore = { still: "unknown" };
  assert.deepEqual(
    await new AntigravityCliAgentExecutor({
      processRunner: new FakeRunner(() => success(malformedCore)),
    }).execute(executionInput("researcher", sourcePath)),
    malformedCore,
  );
});

function failure(reason: string) {
  return (error: unknown) =>
    error instanceof AntigravityCliExecutionError &&
    error.code === "ANTIGRAVITY_CLI_EXECUTION_FAILED" &&
    error.details?.reason === reason;
}
