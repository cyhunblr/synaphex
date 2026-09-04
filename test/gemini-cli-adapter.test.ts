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
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { AgentName } from "../src/domain/agent.js";
import type { AgentSettings } from "../src/domain/agent-config.js";
import type { AgentExecutionInput } from "../src/domain/agent-invocation.js";
import { GeminiCliExecutionError } from "../src/domain/errors.js";
import type {
  ProcessResult,
  ProcessRunInput,
  ProcessRunner,
} from "../src/infrastructure/process-runner.js";
import {
  GEMINI_FIXED_HEADLESS_INSTRUCTION,
  GeminiCliAgentExecutor,
} from "../src/providers/gemini-cli-agent-executor.js";
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
  summary: "Gemini adapter worked.",
  researchArtifact: { custom_field: { source: "official" } },
};

function success(
  candidate: unknown = validResearcher,
  overrides: Partial<ProcessResult> = {},
): ProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: JSON.stringify({ response: JSON.stringify(candidate), stats: {}, error: null }),
    stderr: "",
    timedOut: false,
    stdoutOverflowed: false,
    stderrOverflowed: false,
    ...overrides,
  };
}

async function workspace(t: TestContext): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "synaphex-gemini-source-"));
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
      model: "gemini-explicit-model",
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

test("Gemini adapter uses an isolated private driver workspace and strict headless command", async (t) => {
  const sourcePath = await workspace(t);
  const sourceEnv = join(sourcePath, ".env");
  await writeFile(sourceEnv, "SOURCE_SECRET=untouched\n");
  let settings: unknown;
  let policy = "";
  let driverMode = 0;
  let settingsMode = 0;
  let policyMode = 0;
  const runner = new FakeRunner(async (call) => {
    assert.ok(call.cwd);
    const settingsPath = join(call.cwd, ".gemini", "settings.json");
    const policyPath = optionValue(call.args, "--policy");
    settings = JSON.parse(await readFile(settingsPath, "utf8"));
    policy = await readFile(policyPath, "utf8");
    driverMode = (await stat(call.cwd)).mode & 0o777;
    settingsMode = (await stat(settingsPath)).mode & 0o777;
    policyMode = (await stat(policyPath)).mode & 0o777;
    return success();
  });

  const result = await new GeminiCliAgentExecutor({ processRunner: runner }).execute(
    executionInput("researcher", sourcePath),
  );
  assert.deepEqual(result, validResearcher);
  const call = runner.calls[0]!;
  assert.equal(call.executable, "gemini");
  assert.notEqual(call.cwd, sourcePath);
  assert.match(call.cwd ?? "", /synaphex-gemini-/);
  assert.equal(call.env, undefined);
  assert.equal(optionValue(call.args, "-p"), GEMINI_FIXED_HEADLESS_INSTRUCTION);
  assert.equal(optionValue(call.args, "--output-format"), "json");
  assert.equal(optionValue(call.args, "--model"), "gemini-explicit-model");
  assert.equal(optionValue(call.args, "--approval-mode"), "default");
  assert.equal(optionValue(call.args, "--extensions"), "none");
  assert.equal(optionValue(call.args, "--include-directories"), sourcePath);
  assert.match(optionValue(call.args, "--allowed-mcp-server-names"), /^synaphex-no-mcp-[0-9a-f-]+$/);
  for (const forbidden of ["--resume", "--list-sessions", "--yolo", "--acp"]) {
    assert.equal(call.args.includes(forbidden), false);
  }
  assert.equal(JSON.stringify(call.args).includes("Follow the explicit user instruction."), false);
  assert.match(call.stdin, /Follow the explicit user instruction\./);
  assert.match(call.stdin, /GEMINI TARGET RESULT CONTRACT/);
  assert.equal(call.stdoutCaptureMode, "full");
  assert.equal(call.stdoutLimitBytes, 8 * 1024 * 1024);
  assert.equal(call.stderrTailLimitBytes, 64 * 1024);
  assert.equal(call.timeoutMs, 30 * 60 * 1_000);
  assert.deepEqual(settings, {
    hooksConfig: { enabled: false },
    skills: { enabled: false },
    experimental: { autoMemory: false },
    general: { checkpointing: { enabled: false } },
    context: {
      fileName: (settings as { context: { fileName: string } }).context.fileName,
      loadMemoryFromIncludeDirectories: false,
    },
    security: {
      disableYoloMode: true,
      disableAlwaysAllow: true,
      enablePermanentToolApproval: false,
    },
  });
  const contextName = (settings as { context: { fileName: string } }).context.fileName;
  assert.match(contextName, /^\.synaphex-no-context-[0-9a-f-]+\.md$/);
  assert.notEqual(contextName, "GEMINI.md");
  assert.notEqual(contextName, "AGENTS.md");
  assert.match(policy, /priority = 998/);
  assert.match(policy, /mcpName = "\*"/);
  assert.equal(driverMode, 0o700);
  assert.equal(settingsMode, 0o600);
  assert.equal(policyMode, 0o600);
  await assert.rejects(access(call.cwd!), { code: "ENOENT" });
  assert.equal(await readFile(sourceEnv, "utf8"), "SOURCE_SECRET=untouched\n");
  await assert.rejects(access(join(sourcePath, ".gemini")), { code: "ENOENT" });
});

test("Gemini adapter maps policy only from ExecutionPolicy for read/write/network cases", async (t) => {
  const sourcePath = await workspace(t);
  const cases = [
    ["researcher", false, ["read_file", "read_many_files", "list_directory", "glob", "grep_search"]],
    ["researcher", true, ["read_file", "read_many_files", "list_directory", "glob", "grep_search", "google_web_search"]],
    ["coder", false, ["read_file", "read_many_files", "list_directory", "glob", "grep_search", "write_file", "replace"]],
    ["coder", true, ["read_file", "read_many_files", "list_directory", "glob", "grep_search", "write_file", "replace", "google_web_search"]],
  ] as const;
  for (const [agent, networkEnabled, expectedTools] of cases) {
    let policy = "";
    const output = agent === "coder"
      ? { agent: "coder", outcome: "success", summary: "done", workRecord: { custom_field: true } }
      : validResearcher;
    const runner = new FakeRunner(async (call) => {
      policy = await readFile(optionValue(call.args, "--policy"), "utf8");
      return success(output);
    });
    const base = executionInput(agent, sourcePath);
    await new GeminiCliAgentExecutor({ processRunner: runner }).execute({
      ...base,
      executionPolicy: syntheticExecutionPolicy(agent, {
        network: {
          decision: networkEnabled ? "allow" : "deny",
          source: "global",
          approvedForInvocation: false,
        },
      }),
    });
    const allowed = [...policy.matchAll(/toolName = "([^"]+)"\ndecision = "allow"/g)].map((match) => match[1]);
    assert.deepEqual(allowed, expectedTools);
    for (const forbidden of ["run_shell_command", "web_fetch", "git push", "mcp__"]) {
      assert.equal(allowed.includes(forbidden), false);
    }
  }
});

test("Gemini adapter rejects unsupported route, settings, policy, and workspace before spawn", async (t) => {
  const sourcePath = await workspace(t);
  const runner = new FakeRunner(() => success());
  const executor = new GeminiCliAgentExecutor({ processRunner: runner });
  const base = executionInput("researcher", sourcePath);
  await assert.rejects(executor.execute({ ...base, route: { ...base.route, provider: "openai" } }), failure("unsupported_route"));
  await assert.rejects(executor.execute({ ...base, route: { ...base.route, effectiveSurface: "vscode" } }), failure("unsupported_route"));
  await assert.rejects(executor.execute(executionInput("researcher", sourcePath, { temperature: 1 })), failure("unsupported_settings"));
  await assert.rejects(executor.execute({
    ...base,
    executionPolicy: { ...base.executionPolicy, sourceModification: "workspace_write" },
  }), failure("invalid_execution_policy"));
  await assert.rejects(executor.execute(executionInput("researcher", join(sourcePath, "missing"))), failure("invalid_workspace"));
  const filePath = join(sourcePath, "file.txt");
  await writeFile(filePath, "file");
  await assert.rejects(executor.execute(executionInput("researcher", filePath)), failure("invalid_workspace"));
  assert.equal(runner.calls.length, 0);
});

test("Gemini adapter maps process failures and always cleans the driver workspace", async (t) => {
  const sourcePath = await workspace(t);
  const cases = [
    [success(undefined, { timedOut: true, exitCode: null, signal: "SIGTERM" }), "timeout"],
    [success(undefined, { stdoutOverflowed: true }), "stdout_overflow"],
    [success(undefined, { exitCode: 2, stderr: "provider failed" }), "non_zero_exit"],
    [success(undefined, { exitCode: 2, stderr: "unknown option --policy" }), "unsupported_cli_capability"],
  ] as const;
  for (const [processResult, reason] of cases) {
    let driver = "";
    const runner = new FakeRunner((call) => {
      driver = call.cwd ?? "";
      return processResult;
    });
    await assert.rejects(
      new GeminiCliAgentExecutor({ processRunner: runner, includeStderrDiagnostic: true }).execute(
        executionInput("researcher", sourcePath),
      ),
      failure(reason),
    );
    await assert.rejects(access(driver), { code: "ENOENT" });
  }

  let failedDriver = "";
  const throwing = new FakeRunner((call) => {
    failedDriver = call.cwd ?? "";
    throw new Error("spawn failed");
  });
  await assert.rejects(
    new GeminiCliAgentExecutor({ processRunner: throwing }).execute(executionInput("researcher", sourcePath)),
    failure("spawn_failed"),
  );
  await assert.rejects(access(failedDriver), { code: "ENOENT" });
});

test("Gemini adapter returns unknown candidates without weakening Core validation", async (t) => {
  const sourcePath = await workspace(t);
  const malformedCore = { provider: "candidate remains unknown" };
  assert.deepEqual(
    await new GeminiCliAgentExecutor({
      processRunner: new FakeRunner(() => success(malformedCore)),
    }).execute(executionInput("researcher", sourcePath)),
    malformedCore,
  );
});

function failure(reason: string) {
  return (error: unknown) =>
    error instanceof GeminiCliExecutionError &&
    error.code === "GEMINI_CLI_EXECUTION_FAILED" &&
    error.details?.reason === reason;
}
