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
} from "../src/providers/codex-cli-agent-executor.js";
import {
  CODEX_WEB_SEARCH_DISABLED_OVERRIDE,
  CODEX_WEB_SEARCH_LIVE_OVERRIDE,
  CODEX_WORKSPACE_WRITE_NETWORK_DISABLED_OVERRIDE,
  resolveCodexExecutionPolicy,
} from "../src/providers/codex-execution-policy-resolver.js";
import {
  syntheticAgentContext,
  syntheticExecutionPolicy,
} from "./fixtures/synthetic-agent-context.js";

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

const FORBIDDEN_CODEX_ARGS = [
  "--yolo",
  "--dangerously-bypass-approvals-and-sandbox",
  "--full-auto",
  "--ignore-user-config",
  "--ignore-rules",
  "--permissions-profile",
  "--skip-git-repo-check",
  "danger-full-access",
  "sandbox_workspace_write.network_access=true",
] as const;

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
      host: { provider: "openai" },
      provider: "openai",
      configuredSurface: "cli",
      effectiveSurface: "cli",
      cliForcedByCrossProvider: false,
      routingReason: "same_provider_configured_cli",
      model: "gpt-5.6-sol",
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

function configOverrides(args: readonly string[]): string[] {
  return args.flatMap((argument, index) =>
    argument === "-c" && args[index + 1] !== undefined
      ? [args[index + 1]!]
      : [],
  );
}

test("Codex adapter constructs secure non-interactive command and parses the result file", async (t) => {
  const sourcePath = await workspace(t);
  let temporaryDirectory = "";
  const coreResult = {
    agent: "coder",
    outcome: "success",
    summary: "Implementation complete.",
    workRecord: { custom_field: "done" },
  };
  const wireResult = {
    agent: "coder",
    outcome: "success",
    summary: "Implementation complete.",
    warnings: null,
    requestedCalls: null,
    requestedActions: null,
    payloadJson: JSON.stringify({ custom_field: "done" }),
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
      properties: { agent: { enum: string[] } };
    };
    assert.deepEqual(schema.properties.agent.enum, ["coder"]);
    await writeFile(resultPath, JSON.stringify(wireResult));
    return success("normal progress on stderr");
  });
  const executor = new CodexCliAgentExecutor({ processRunner: runner });

  const result = await executor.execute(
    executionInput("coder", sourcePath, {}),
  );

  assert.deepEqual(validateAgentResult("coder", result), coreResult);
  assert.equal(runner.calls.length, 1);
  const call = runner.calls[0]!;
  assert.equal(call.executable, "codex");
  assert.equal(call.args[0], "exec");
  assert.ok(call.args.includes("--ephemeral"));
  assert.equal(optionValue(call.args, "--model"), "gpt-5.6-sol");
  assert.equal(optionValue(call.args, "--cd"), sourcePath);
  assert.equal(optionValue(call.args, "--sandbox"), "workspace-write");
  assert.deepEqual(configOverrides(call.args), [
    CODEX_WORKSPACE_WRITE_NETWORK_DISABLED_OVERRIDE,
    CODEX_WEB_SEARCH_DISABLED_OVERRIDE,
  ]);
  assert.equal(optionValue(call.args, "--color"), "never");
  assert.equal(call.args.at(-1), "-");
  assert.match(call.stdin, /Logical agent: CODER/);
  assert.match(call.stdin, /CODEX WIRE TRANSPORT/);
  assert.match(call.stdin, /payloadJson/);
  assert.equal(call.args.includes(call.stdin), false);
  assert.equal(call.env, undefined);
  assert.equal(call.timeoutMs, 30 * 60 * 1_000);
  assert.equal(call.terminationGraceMs, 2_000);
  for (const forbidden of FORBIDDEN_CODEX_ARGS) {
    assert.equal(call.args.includes(forbidden), false);
  }
  await assert.rejects(access(temporaryDirectory), { code: "ENOENT" });
});

test("every supported Codex model is passed unchanged through the structured-result adapter", async (t) => {
  const sourcePath = await workspace(t);
  const models = [
    "gpt-5.6-sol",
    "gpt-6-astra",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
  ];
  const runner = new FakeProcessRunner(async (call) => {
    await writeFile(optionValue(call.args, "--output-last-message"), JSON.stringify({
      agent: "researcher",
      outcome: "success",
      summary: "ok",
      warnings: null,
      requestedCalls: null,
      requestedActions: null,
      payloadJson: JSON.stringify({ findings: "ok" }),
    }));
    return success();
  });
  const executor = new CodexCliAgentExecutor({ processRunner: runner });

  for (const model of models) {
    const input = executionInput("researcher", sourcePath, {
      reasoning_effort: "medium",
    });
    await executor.execute({
      ...input,
      route: { ...input.route, model },
    });
  }

  assert.deepEqual(
    runner.calls.map((call) => optionValue(call.args, "--model")),
    models,
  );
  for (const call of runner.calls) {
    assert.ok(call.args.includes("--output-schema"));
    assert.ok(call.args.includes("--output-last-message"));
    assert.ok(configOverrides(call.args).includes('model_reasoning_effort="medium"'));
  }
});

test("Codex defensively refuses an uncataloged model before process execution", async (t) => {
  const sourcePath = await workspace(t);
  const runner = new FakeProcessRunner(() => {
    throw new Error("provider must not run");
  });
  const input = executionInput("researcher", sourcePath);
  await assert.rejects(
    new CodexCliAgentExecutor({ processRunner: runner }).execute({
      ...input,
      route: { ...input.route, model: "future-model" },
    }),
    (error: unknown) =>
      error instanceof CodexCliExecutionError &&
      error.details?.reason === "unsupported_model",
  );
  assert.equal(runner.calls.length, 0);
});

test("sandbox mapping is capability-based for all six current roles", () => {
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
        resolveCodexExecutionPolicy(syntheticExecutionPolicy(agent)).sandbox,
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
    resolveCodexExecutionPolicy({
      ...syntheticExecutionPolicy("reviewer"),
      sourceModification: "workspace_write",
    }).sandbox,
    "workspace-write",
  );
});

test("workspace-write enabled network grants hosted search while denying local process network", async (t) => {
  const sourcePath = await workspace(t);
  const policies = [
    {
      decision: "allow",
      source: "global",
      approvedForInvocation: false,
    },
    {
      decision: "ask",
      source: "task",
      approvedForInvocation: true,
    },
  ] as const;

  for (const network of policies) {
    const runner = new FakeProcessRunner(async (call) => {
      await writeFile(
        optionValue(call.args, "--output-last-message"),
        JSON.stringify({
          agent: "coder",
          outcome: "success",
          summary: "Network policy mapped.",
          warnings: null,
          requestedCalls: null,
          requestedActions: null,
          payloadJson: JSON.stringify({ custom_field: "done" }),
        }),
      );
      return success();
    });
    await new CodexCliAgentExecutor({ processRunner: runner }).execute({
      ...executionInput("coder", sourcePath),
      executionPolicy: syntheticExecutionPolicy("coder", { network }),
    });

    const args = runner.calls[0]!.args;
    const configIndex = args.indexOf("-c");
    assert.notEqual(configIndex, -1);
    assert.equal(
      args[configIndex + 1],
      CODEX_WORKSPACE_WRITE_NETWORK_DISABLED_OVERRIDE,
    );
    assert.equal(optionValue(args, "--sandbox"), "workspace-write");
    assert.equal(
      args.filter((argument) => argument === "-c").length,
      2,
    );
    assert.deepEqual(configOverrides(args), [
      CODEX_WORKSPACE_WRITE_NETWORK_DISABLED_OVERRIDE,
      CODEX_WEB_SEARCH_LIVE_OVERRIDE,
    ]);
    assert.equal(
      configOverrides(args).includes(
        "sandbox_workspace_write.network_access=true",
      ),
      false,
    );
    for (const forbidden of FORBIDDEN_CODEX_ARGS) {
      assert.equal(args.includes(forbidden), false);
    }
  }
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
  for (const [model, reasoningEffort] of [
    ["gpt-6-astra", "max"],
    ["gpt-5.6-sol", "none"],
    ["gpt-5.5", "minimal"],
  ] as const) {
    const input = executionInput("coder", sourcePath, {
      reasoning_effort: reasoningEffort,
    });
    await assert.rejects(
      executor.execute({ ...input, route: { ...input.route, model } }),
      failureReason("unsupported_settings"),
    );
  }
  await assert.rejects(
    executor.execute(executionInput("coder", missingPath)),
    failureReason("invalid_workspace"),
  );
  assert.equal(runner.calls.length, 0);
});

test("gpt-5.6-sol reasoning effort maps to the exact Codex config override", async (t) => {
  const sourcePath = await workspace(t);
  const runner = new FakeProcessRunner(async (call) => {
    await writeFile(
      optionValue(call.args, "--output-last-message"),
      JSON.stringify({
        agent: "coder",
        outcome: "success",
        summary: "Configured reasoning.",
        warnings: null,
        requestedCalls: null,
        requestedActions: null,
        payloadJson: JSON.stringify({ custom_field: "done" }),
      }),
    );
    return success();
  });

  await new CodexCliAgentExecutor({ processRunner: runner }).execute(
    executionInput("coder", sourcePath, { reasoning_effort: "xhigh" }),
  );

  assert.deepEqual(configOverrides(runner.calls[0]!.args), [
    CODEX_WORKSPACE_WRITE_NETWORK_DISABLED_OVERRIDE,
    CODEX_WEB_SEARCH_DISABLED_OVERRIDE,
    'model_reasoning_effort="xhigh"',
  ]);
});

test("read-only enabled network uses only hosted web search", async (t) => {
  const sourcePath = await workspace(t);
  const input = executionInput("researcher", sourcePath);
  assert.deepEqual(Object.keys(input.executionPolicy.providerCapabilities), [
    "network",
  ]);
  assert.equal("git_push" in input.executionPolicy.providerCapabilities, false);
  assert.equal("ci" in input.executionPolicy.providerCapabilities, false);

  for (const network of [
    {
      decision: "allow",
      source: "global",
      approvedForInvocation: false,
    },
    {
      decision: "ask",
      source: "task",
      approvedForInvocation: true,
    },
  ] as const) {
    const runner = new FakeProcessRunner(async (call) => {
      await writeFile(
        optionValue(call.args, "--output-last-message"),
        JSON.stringify({
          agent: "researcher",
          outcome: "success",
          summary: "Hosted search mapped.",
          warnings: null,
          requestedCalls: null,
          requestedActions: null,
          payloadJson: JSON.stringify({ custom_field: "current fact" }),
        }),
      );
      return success();
    });
    await new CodexCliAgentExecutor({ processRunner: runner }).execute({
      ...input,
      executionPolicy: syntheticExecutionPolicy("researcher", { network }),
    });

    const args = runner.calls[0]!.args;
    assert.equal(optionValue(args, "--sandbox"), "read-only");
    assert.deepEqual(configOverrides(args), [CODEX_WEB_SEARCH_LIVE_OVERRIDE]);
    assert.equal(
      args.some((argument) =>
        argument.startsWith("sandbox_workspace_write.network_access="),
      ),
      false,
    );
  }
});

test("read-only disabled network explicitly removes hosted web search", async (t) => {
  const sourcePath = await workspace(t);
  for (const network of [
    {
      decision: "deny",
      source: "global",
      approvedForInvocation: false,
    },
    {
      decision: "ask",
      source: "task",
      approvedForInvocation: false,
    },
  ] as const) {
    const runner = new FakeProcessRunner(async (call) => {
      await writeFile(
        optionValue(call.args, "--output-last-message"),
        JSON.stringify({
          agent: "researcher",
          outcome: "success",
          summary: "Network remains disabled.",
          warnings: null,
          requestedCalls: null,
          requestedActions: null,
          payloadJson: JSON.stringify({ custom_field: "local" }),
        }),
      );
      return success();
    });
    await new CodexCliAgentExecutor({ processRunner: runner }).execute({
      ...executionInput("researcher", sourcePath),
      executionPolicy: syntheticExecutionPolicy("researcher", { network }),
    });
    assert.deepEqual(configOverrides(runner.calls[0]!.args), [
      CODEX_WEB_SEARCH_DISABLED_OVERRIDE,
    ]);
  }
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
      error.details.diagnosticCategory === "process_execution" &&
      !("stderr" in error.details),
  );
  await assert.rejects(access(nonZeroDirectory), { code: "ENOENT" });

  const schemaRunner = new FakeProcessRunner(() => ({
    exitCode: 1,
    signal: null,
    stdout: "",
    stderr:
      "ERROR: Invalid schema for response_format 'agent': missing required. Bearer secret-value OPENAI_API_KEY=secret-value",
    timedOut: false,
  }));
  await assert.rejects(
    new CodexCliAgentExecutor({
      processRunner: schemaRunner,
      includeStderrDiagnostic: true,
    }).execute(executionInput("coder", sourcePath)),
    (error: unknown) =>
      failureReason("non_zero_exit")(error) &&
      error.details?.diagnosticCategory ===
        "output_schema_incompatibility" &&
      typeof error.details.stderrDiagnostic === "string" &&
      error.details.stderrDiagnostic.includes("[REDACTED]") &&
      !error.details.stderrDiagnostic.includes("secret-value"),
  );

  const modelRunner = new FakeProcessRunner(() => ({
    exitCode: 1,
    signal: null,
    stdout: "",
    stderr: "The 'model-x' model is not supported with this account.",
    timedOut: false,
  }));
  await assert.rejects(
    new CodexCliAgentExecutor({ processRunner: modelRunner }).execute(
      executionInput("coder", sourcePath),
    ),
    (error: unknown) =>
      failureReason("non_zero_exit")(error) &&
      error.details?.diagnosticCategory === "model_unavailable" &&
      !("stderrDiagnostic" in (error.details ?? {})),
  );

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
