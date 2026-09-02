import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { validateAgentResult } from "../src/core/agent-result-validator.js";
import type { AgentName } from "../src/domain/agent.js";
import type { AgentExecutionInput } from "../src/domain/agent-invocation.js";
import { CodexCliExecutionError } from "../src/domain/errors.js";
import type { AgentSettings } from "../src/domain/agent-config.js";
import type {
  ProcessResult,
  ProcessRunInput,
  ProcessRunner,
} from "../src/infrastructure/process-runner.js";
import {
  CodexCliAgentExecutor,
  resolveCodexSandbox,
} from "../src/providers/codex-cli-agent-executor.js";
import { RoleContractRegistry } from "../src/core/role-contract-registry.js";
import { syntheticAgentContext } from "./fixtures/synthetic-agent-context.js";

class FakeProcessRunner implements ProcessRunner {
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

const success = (stderr = ""): ProcessResult => ({
  exitCode: 0,
  signal: null,
  stdout: "progress is not the result",
  stderr,
  timedOut: false,
});

async function workspace(t: TestContext): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "synaphex-codex-workspace-"));
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
      provider: "openai",
      configuredSurface: "cli",
      effectiveSurface: "cli",
      cliForcedByCrossProvider: false,
      routingReason: "same_provider_configured_cli",
      model: "explicit-codex-model",
      ...(settings === undefined ? {} : { settings }),
    },
    context: syntheticAgentContext(agent, sourcePath),
  };
}

function optionValue(args: readonly string[], option: string): string {
  const index = args.indexOf(option);
  assert.notEqual(index, -1, `missing ${option}`);
  const value = args[index + 1];
  assert.ok(value !== undefined, `missing value for ${option}`);
  return value;
}

test("Codex adapter constructs secure non-interactive command and parses the result file", async (t) => {
  const sourcePath = await workspace(t);
  let temporaryDirectory = "";
  const providerResult = {
    agent: "coder",
    outcome: "success",
    summary: "Implementation complete.",
    workRecord: { custom_field: "done" },
  };
  const runner = new FakeProcessRunner(async (call) => {
    const schemaPath = optionValue(call.args, "--output-schema");
    const resultPath = optionValue(call.args, "--output-last-message");
    temporaryDirectory = dirname(schemaPath);
    assert.equal(dirname(resultPath), temporaryDirectory);
    assert.notEqual(temporaryDirectory.startsWith(sourcePath), true);
    assert.equal((await stat(temporaryDirectory)).mode & 0o777, 0o700);
    assert.equal((await stat(schemaPath)).mode & 0o777, 0o600);
    const schema = JSON.parse(await readFile(schemaPath, "utf8")) as {
      properties: { agent: { const: string } };
    };
    assert.equal(schema.properties.agent.const, "coder");
    await writeFile(resultPath, JSON.stringify(providerResult));
    return success("normal progress on stderr");
  });
  const executor = new CodexCliAgentExecutor({ processRunner: runner });

  const result = await executor.execute(
    executionInput("coder", sourcePath, {}),
  );

  assert.deepEqual(validateAgentResult("coder", result), providerResult);
  assert.equal(runner.calls.length, 1);
  const call = runner.calls[0]!;
  assert.equal(call.executable, "codex");
  assert.equal(call.args[0], "exec");
  assert.ok(call.args.includes("--ephemeral"));
  assert.equal(optionValue(call.args, "--model"), "explicit-codex-model");
  assert.equal(optionValue(call.args, "--cd"), sourcePath);
  assert.equal(optionValue(call.args, "--sandbox"), "workspace-write");
  assert.equal(optionValue(call.args, "--color"), "never");
  assert.equal(call.args.at(-1), "-");
  assert.match(call.stdin, /Logical agent: CODER/);
  assert.equal(call.args.includes(call.stdin), false);
  assert.equal(call.env, undefined);
  assert.equal(call.timeoutMs, 30 * 60 * 1_000);
  assert.equal(call.terminationGraceMs, 2_000);
  for (const forbidden of [
    "--yolo",
    "--dangerously-bypass-approvals-and-sandbox",
    "--full-auto",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "danger-full-access",
  ]) {
    assert.equal(call.args.includes(forbidden), false);
  }
  await assert.rejects(access(temporaryDirectory), { code: "ENOENT" });
});

test("sandbox mapping is capability-based for all six current roles", () => {
  const contracts = new RoleContractRegistry();
  const agents: readonly AgentName[] = [
    "questioner",
    "researcher",
    "examiner",
    "planner",
    "coder",
    "reviewer",
  ];

  assert.deepEqual(
    Object.fromEntries(
      agents.map((agent) => [
        agent,
        resolveCodexSandbox(contracts.getSnapshot(agent)),
      ]),
    ),
    {
      questioner: "read-only",
      researcher: "read-only",
      examiner: "read-only",
      planner: "read-only",
      coder: "workspace-write",
      reviewer: "read-only",
    },
  );
  assert.equal(
    resolveCodexSandbox({
      ...contracts.getSnapshot("reviewer"),
      mayModifySourceCode: true,
    }),
    "workspace-write",
  );
});

test("unsupported routes, settings, and workspaces fail before process execution", async (t) => {
  const sourcePath = await workspace(t);
  const runner = new FakeProcessRunner(() => success());
  const executor = new CodexCliAgentExecutor({ processRunner: runner });
  const wrongProvider = executionInput("coder", sourcePath);
  const missingPath = join(sourcePath, "missing");

  await assert.rejects(
    executor.execute({
      ...wrongProvider,
      route: { ...wrongProvider.route, provider: "anthropic" },
    }),
    failureReason("unsupported_route"),
  );
  await assert.rejects(
    executor.execute(executionInput("coder", sourcePath, { temperature: 1 })),
    failureReason("unsupported_settings"),
  );
  await assert.rejects(
    executor.execute(executionInput("coder", missingPath)),
    failureReason("invalid_workspace"),
  );
  assert.equal(runner.calls.length, 0);
});

test("non-zero exit and spawn failure produce typed failures and clean temporary files", async (t) => {
  const sourcePath = await workspace(t);
  let nonZeroDirectory = "";
  const nonZeroRunner = new FakeProcessRunner((call) => {
    nonZeroDirectory = dirname(optionValue(call.args, "--output-schema"));
    return {
      exitCode: 17,
      signal: null,
      stdout: "",
      stderr: "bounded diagnostic only",
      timedOut: false,
    };
  });
  await assert.rejects(
    new CodexCliAgentExecutor({ processRunner: nonZeroRunner }).execute(
      executionInput("coder", sourcePath),
    ),
    (error: unknown) =>
      failureReason("non_zero_exit")(error) &&
      error.details?.exitCode === 17 &&
      !("stderr" in error.details),
  );
  await assert.rejects(access(nonZeroDirectory), { code: "ENOENT" });

  let spawnDirectory = "";
  const spawnRunner = new FakeProcessRunner((call) => {
    spawnDirectory = dirname(optionValue(call.args, "--output-schema"));
    throw Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" });
  });
  await assert.rejects(
    new CodexCliAgentExecutor({
      processRunner: spawnRunner,
      executable: "/missing/codex",
    }).execute(executionInput("coder", sourcePath)),
    failureReason("spawn_failed"),
  );
  assert.equal(spawnRunner.calls[0]?.executable, "/missing/codex");
  await assert.rejects(access(spawnDirectory), { code: "ENOENT" });
});

test("missing, empty, and malformed result files are typed provider-output failures", async (t) => {
  const sourcePath = await workspace(t);
  const scenarios: ReadonlyArray<{
    reason: "missing_result" | "empty_result" | "malformed_result";
    content: string | null;
  }> = [
    { reason: "missing_result", content: null },
    { reason: "empty_result", content: "  \n" },
    { reason: "malformed_result", content: "{not-json" },
  ];

  for (const scenario of scenarios) {
    let temporaryDirectory = "";
    const runner = new FakeProcessRunner(async (call) => {
      const resultPath = optionValue(call.args, "--output-last-message");
      temporaryDirectory = dirname(resultPath);
      if (scenario.content !== null) {
        await writeFile(resultPath, scenario.content);
      }
      return success();
    });
    await assert.rejects(
      new CodexCliAgentExecutor({ processRunner: runner }).execute(
        executionInput("coder", sourcePath),
      ),
      failureReason(scenario.reason),
    );
    await assert.rejects(access(temporaryDirectory), { code: "ENOENT" });
  }
});

test("timeout is a typed failure and cleanup still runs", async (t) => {
  const sourcePath = await workspace(t);
  let temporaryDirectory = "";
  const runner = new FakeProcessRunner((call) => {
    temporaryDirectory = dirname(optionValue(call.args, "--output-schema"));
    return {
      exitCode: null,
      signal: "SIGKILL",
      stdout: "",
      stderr: "",
      timedOut: true,
    };
  });
  await assert.rejects(
    new CodexCliAgentExecutor({
      processRunner: runner,
      timeoutMs: 1234,
      terminationGraceMs: 56,
    }).execute(executionInput("coder", sourcePath)),
    failureReason("timeout"),
  );
  assert.equal(runner.calls[0]?.timeoutMs, 1234);
  assert.equal(runner.calls[0]?.terminationGraceMs, 56);
  await assert.rejects(access(temporaryDirectory), { code: "ENOENT" });
});

function failureReason(reason: string) {
  return (error: unknown): error is CodexCliExecutionError =>
    error instanceof CodexCliExecutionError &&
    error.code === "CODEX_CLI_EXECUTION_FAILED" &&
    error.details?.reason === reason;
}
