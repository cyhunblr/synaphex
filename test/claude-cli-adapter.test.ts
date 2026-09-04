import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { AgentName } from "../src/domain/agent.js";
import type { AgentSettings } from "../src/domain/agent-config.js";
import type { AgentExecutionInput } from "../src/domain/agent-invocation.js";
import { ClaudeCliExecutionError } from "../src/domain/errors.js";
import type {
  ProcessResult,
  ProcessRunInput,
  ProcessRunner,
} from "../src/infrastructure/process-runner.js";
import {
  CLAUDE_FIXED_PRINT_INSTRUCTION,
  ClaudeCliAgentExecutor,
} from "../src/providers/claude-cli-agent-executor.js";
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
  summary: "Claude adapter worked.",
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
      type: "result",
      subtype: "success",
      is_error: false,
      structured_output: structuredOutput,
    }),
    stderr: "",
    timedOut: false,
    stdoutOverflowed: false,
    stderrOverflowed: false,
    ...overrides,
  };
}

async function workspace(t: TestContext): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "synaphex-claude-workspace-"));
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
      provider: "anthropic",
      configuredSurface: "cli",
      effectiveSurface: "cli",
      cliForcedByCrossProvider: true,
      routingReason: "cross_provider_cli",
      model: "claude-explicit-model",
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

function toolList(args: readonly string[], option: string): string[] {
  return optionValue(args, option).split(",").filter(Boolean);
}

test("Claude adapter constructs a fresh restricted direct command and decodes structured output", async (t) => {
  const sourcePath = await workspace(t);
  const runner = new FakeRunner(() => success());
  const result = await new ClaudeCliAgentExecutor({
    processRunner: runner,
    executable: "/custom/claude",
  }).execute(executionInput("researcher", sourcePath));

  assert.deepEqual(result, validResearcher);
  assert.equal(runner.calls.length, 1);
  const call = runner.calls[0]!;
  assert.equal(call.executable, "/custom/claude");
  assert.equal(call.cwd, sourcePath);
  assert.equal(call.env, undefined);
  assert.deepEqual(call.args.slice(0, 4), [
    "-p",
    CLAUDE_FIXED_PRINT_INSTRUCTION,
    "--safe-mode",
    "--restricted",
  ]);
  assert.equal(optionValue(call.args, "--output-format"), "json");
  assert.equal(optionValue(call.args, "--model"), "claude-explicit-model");
  assert.equal(optionValue(call.args, "--permission-mode"), "dontAsk");
  for (const flag of [
    "--safe-mode",
    "--restricted",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--json-schema",
    "--tools",
    "--allowedTools",
    "--disallowedTools",
  ]) {
    assert.ok(call.args.includes(flag), flag);
  }
  assert.equal(call.args.includes("--bare"), false);
  assert.equal(
    JSON.stringify(call.args).includes("ANTHROPIC_API_KEY"),
    false,
  );
  assert.equal(JSON.stringify(call.args).includes("apiKeyHelper"), false);
  for (const forbidden of [
    "--dangerously-skip-permissions",
    "--allow-dangerously-skip-permissions",
    "bypassPermissions",
    "--resume",
    "--continue",
    "--session-id",
    "--fork-session",
    "--remote-control-session-name-prefix",
    "--worktree",
    "--mcp-config",
    "--agent",
    "--agents",
  ]) {
    assert.equal(call.args.includes(forbidden), false, forbidden);
  }
  assert.deepEqual(toolList(call.args, "--tools"), ["Read", "Glob", "Grep"]);
  assert.deepEqual(
    toolList(call.args, "--allowedTools"),
    toolList(call.args, "--tools"),
  );
  assert.ok(toolList(call.args, "--disallowedTools").includes("mcp__*"));
  assert.equal(call.args.includes("--settings"), false);
  const schema = JSON.parse(optionValue(call.args, "--json-schema")) as {
    properties: { agent: { const: string } };
  };
  assert.equal(schema.properties.agent.const, "researcher");
  assert.match(call.stdin, /Logical agent: RESEARCHER/);
  assert.match(call.stdin, /PROJECT_CANONICAL_MEMORY/);
  assert.match(call.stdin, /CLAUDE PROVIDER EXECUTION CONTROLS/);
  assert.equal(call.args.some((arg) => arg.includes("PROJECT_CANONICAL_MEMORY")), false);
  assert.equal(call.stdoutCaptureMode, "full");
  assert.equal(call.stdoutLimitBytes, 8 * 1024 * 1024);
  assert.equal(call.stderrTailLimitBytes, 64 * 1024);
  assert.equal(call.timeoutMs, 30 * 60 * 1_000);
  assert.equal(call.terminationGraceMs, 2_000);
});

test("Claude adapter maps all four native tool surfaces exactly", async (t) => {
  const sourcePath = await workspace(t);
  const cases = [
    {
      agent: "researcher" as const,
      network: { decision: "deny", source: "global", approvedForInvocation: false } as const,
      tools: ["Read", "Glob", "Grep"],
    },
    {
      agent: "researcher" as const,
      network: { decision: "allow", source: "global", approvedForInvocation: false } as const,
      tools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
    },
    {
      agent: "coder" as const,
      network: { decision: "ask", source: "task", approvedForInvocation: false } as const,
      tools: ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
    },
    {
      agent: "coder" as const,
      network: { decision: "ask", source: "task", approvedForInvocation: true } as const,
      tools: ["Read", "Glob", "Grep", "Edit", "Write", "Bash", "WebSearch", "WebFetch"],
    },
  ];

  for (const scenario of cases) {
    const output = scenario.agent === "coder"
      ? {
          agent: "coder",
          outcome: "success",
          summary: "Tool surface mapped.",
          workRecord: { custom_field: "done" },
        }
      : validResearcher;
    const runner = new FakeRunner(() => success(output));
    const input = executionInput(scenario.agent, sourcePath);
    await new ClaudeCliAgentExecutor({ processRunner: runner }).execute({
      ...input,
      executionPolicy: syntheticExecutionPolicy(scenario.agent, {
        network: scenario.network,
      }),
    });
    const call = runner.calls[0]!;
    const args = call.args;
    assert.equal(call.env, undefined);
    assert.ok(args.includes("--safe-mode"));
    assert.ok(args.includes("--restricted"));
    assert.equal(args.includes("--bare"), false);
    assert.equal(JSON.stringify(args).includes("ANTHROPIC_API_KEY"), false);
    assert.equal(JSON.stringify(args).includes("apiKeyHelper"), false);
    assert.deepEqual(toolList(args, "--tools"), scenario.tools);
    assert.deepEqual(toolList(args, "--allowedTools"), scenario.tools);
    assert.equal(toolList(args, "--tools").includes("Agent"), false);
    assert.equal(toolList(args, "--tools").includes("Skill"), false);
    assert.equal(toolList(args, "--tools").includes("AskUserQuestion"), false);
    assert.equal(toolList(args, "--tools").some((tool) => tool.startsWith("mcp__")), false);
    if (scenario.agent === "coder") {
      const settings = JSON.parse(optionValue(args, "--settings"));
      assert.deepEqual(settings, {
        sandbox: {
          enabled: true,
          failIfUnavailable: true,
          allowUnsandboxedCommands: false,
          network: { allowedDomains: [], strictAllowlist: true },
        },
      });
      assert.equal(Object.hasOwn(settings, "apiKeyHelper"), false);
      assert.ok(toolList(args, "--disallowedTools").includes("Bash(git push)"));
      assert.ok(toolList(args, "--disallowedTools").includes("Bash(git push *)"));
    }
  }
});

test("Claude adapter rejects unsupported routes, settings, policies, and workspaces before spawn", async (t) => {
  const sourcePath = await workspace(t);
  const runner = new FakeRunner(() => success());
  const executor = new ClaudeCliAgentExecutor({ processRunner: runner });
  const base = executionInput("researcher", sourcePath);

  await assert.rejects(
    executor.execute({ ...base, route: { ...base.route, provider: "openai" } }),
    failure("unsupported_route"),
  );
  await assert.rejects(
    executor.execute({ ...base, route: { ...base.route, effectiveSurface: "vscode" } }),
    failure("unsupported_route"),
  );
  await assert.rejects(
    executor.execute(executionInput("researcher", sourcePath, { temperature: 1 })),
    failure("unsupported_settings"),
  );
  await assert.rejects(
    executor.execute({
      ...base,
      executionPolicy: { ...base.executionPolicy, sourceModification: "workspace_write" },
    }),
    failure("invalid_execution_policy"),
  );
  await assert.rejects(
    executor.execute(executionInput("researcher", join(sourcePath, "missing"))),
    failure("invalid_workspace"),
  );
  const filePath = join(sourcePath, "file.txt");
  await writeFile(filePath, "not a directory");
  await assert.rejects(
    executor.execute(executionInput("researcher", filePath)),
    failure("invalid_workspace"),
  );
  assert.equal(runner.calls.length, 0);
});

test("Claude adapter maps process failures and preserves successful stderr", async (t) => {
  const sourcePath = await workspace(t);
  const cases = [
    [success(undefined, { timedOut: true, exitCode: null, signal: "SIGTERM" }), "timeout"],
    [success(undefined, { stdoutOverflowed: true }), "stdout_overflow"],
    [success(undefined, { exitCode: 2, stderr: "provider failed" }), "non_zero_exit"],
    [success(undefined, { exitCode: 2, stderr: "unknown option '--restricted'" }), "unsupported_cli_capability"],
  ] as const;
  for (const [result, reason] of cases) {
    const runner = new FakeRunner(() => result);
    await assert.rejects(
      new ClaudeCliAgentExecutor({
        processRunner: runner,
        includeStderrDiagnostic: true,
      }).execute(executionInput("researcher", sourcePath)),
      failure(reason),
    );
  }

  const runner = new FakeRunner(() => success(validResearcher, { stderr: "benign diagnostic" }));
  assert.deepEqual(
    await new ClaudeCliAgentExecutor({ processRunner: runner }).execute(
      executionInput("researcher", sourcePath),
    ),
    validResearcher,
  );
});

test("Claude adapter maps spawn and envelope failures without Core validation", async (t) => {
  const sourcePath = await workspace(t);
  const throwingRunner: ProcessRunner = {
    run: async () => {
      throw new Error("ENOENT");
    },
  };
  await assert.rejects(
    new ClaudeCliAgentExecutor({ processRunner: throwingRunner }).execute(
      executionInput("researcher", sourcePath),
    ),
    failure("spawn_failed"),
  );

  for (const [stdout, reason] of [
    ["not-json", "malformed_output"],
    [JSON.stringify({ result: "text only" }), "missing_structured_output"],
    [JSON.stringify({ is_error: true, structured_output: {} }), "structured_output_error"],
  ] as const) {
    await assert.rejects(
      new ClaudeCliAgentExecutor({
        processRunner: new FakeRunner(() => success(undefined, { stdout })),
      }).execute(executionInput("researcher", sourcePath)),
      failure(reason),
    );
  }

  const malformedCore = { provider: "returns unknown without validating" };
  assert.deepEqual(
    await new ClaudeCliAgentExecutor({
      processRunner: new FakeRunner(() => success(malformedCore)),
    }).execute(executionInput("researcher", sourcePath)),
    malformedCore,
  );
});

function failure(reason: string) {
  return (error: unknown) =>
    error instanceof ClaudeCliExecutionError &&
    error.code === "CLAUDE_CLI_EXECUTION_FAILED" &&
    error.details?.reason === reason;
}
