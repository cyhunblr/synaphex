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
  buildAntigravityArgs,
} from "../src/providers/antigravity-cli-agent-executor.js";
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
      host: { provider: "openai" },
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

// Antigravity 1.1.26 has no invocation-scoped policy mechanism, so the executor
// must never spawn a process for any ExecutionPolicy. The exact command vector
// is still pinned via the pure builder so a future accepted policy cannot
// silently regress the flags. See docs/architecture/0001-google-cli-runtime.md.

test("Antigravity never spawns a process for any supported role and policy", async (t) => {
  const sourcePath = await workspace(t);
  const providerConfig = join(sourcePath, ".gemini", "antigravity-cli", "settings.json");
  await mkdir(join(sourcePath, ".gemini", "antigravity-cli"), { recursive: true });
  await writeFile(providerConfig, "{\"preserve\":true}\n");
  for (const agent of ["researcher", "coder"] satisfies AgentName[]) {
    const runner = new FakeRunner(() => success());
    await assert.rejects(
      new AntigravityCliAgentExecutor({ processRunner: runner }).execute(
        executionInput(agent, sourcePath),
      ),
      (error: unknown) =>
        failure("unsupported_execution_policy")(error) &&
        typeof (error as AntigravityCliExecutionError).details?.policyReason ===
          "string" &&
        /not_enforceable_without_invocation_scoped_policy$/.test(
          (error as AntigravityCliExecutionError).details
            ?.policyReason as string,
        ),
      `${agent} must fail closed`,
    );
    assert.equal(runner.calls.length, 0, `${agent} must not spawn agy`);
  }
  // Failing closed must never touch provider-owned settings.
  assert.equal(await readFile(providerConfig, "utf8"), "{\"preserve\":true}\n");
});

test("Antigravity command vector stays sandboxed, fresh, and free of bypass flags", () => {
  for (const mode of ["plan", "accept-edits"] as const) {
    const args = buildAntigravityArgs({
      model: "explicit-antigravity-model",
      mode,
      schema: "{\"type\":\"object\"}",
      timeoutMs: 30 * 60 * 1_000,
    });
    assert.equal(optionValue(args, "-p"), ANTIGRAVITY_FIXED_PRINT_INSTRUCTION);
    assert.equal(optionValue(args, "--output-format"), "json");
    assert.equal(optionValue(args, "--json-schema"), "{\"type\":\"object\"}");
    assert.equal(optionValue(args, "--model"), "explicit-antigravity-model");
    assert.equal(optionValue(args, "--mode"), mode);
    assert.ok(args.includes("--sandbox"));
    assert.ok(args.includes("--disable-slash-commands"));
    assert.equal(optionValue(args, "--print-timeout"), "1800000ms");
    for (const forbidden of [
      "--continue",
      "-c",
      "--conversation",
      "--dangerously-skip-permissions",
      "--prompt-interactive",
      "--add-dir",
      "--agent",
      "--project",
      "--new-project",
    ]) {
      assert.equal(args.includes(forbidden), false, `${forbidden} must never be emitted`);
    }
  }
});

test("Antigravity rejects routes, settings, role-policy mismatch, and workspaces before spawn", async (t) => {
  const sourcePath = await workspace(t);
  const runner = new FakeRunner(() => success());
  const executor = new AntigravityCliAgentExecutor({ processRunner: runner });
  const base = executionInput("researcher", sourcePath);
  await assert.rejects(executor.execute({ ...base, route: { ...base.route, provider: "openai" } }), failure("unsupported_route"));
  await assert.rejects(executor.execute({ ...base, route: { ...base.route, effectiveSurface: "vscode" } }), failure("unsupported_route"));
  await assert.rejects(executor.execute(executionInput("researcher", sourcePath, { effort: "high" })), failure("unsupported_settings"));
  await assert.rejects(
    executor.execute({
      ...base,
      executionPolicy: { ...base.executionPolicy, sourceModification: "workspace_write" },
    }),
    (error: unknown) =>
      failure("unsupported_execution_policy")(error) &&
      (error as AntigravityCliExecutionError).details?.policyReason ===
        "source_modification_role_mismatch",
  );
  // Policy resolution deliberately runs before workspace validation, so an
  // unsupported policy fails closed without touching the filesystem at all.
  const filePath = join(sourcePath, "file.txt");
  await writeFile(filePath, "file");
  for (const badWorkspace of [join(sourcePath, "missing"), filePath]) {
    await assert.rejects(
      executor.execute(executionInput("researcher", badWorkspace)),
      failure("unsupported_execution_policy"),
    );
  }
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

function failure(reason: string) {
  return (error: unknown) =>
    error instanceof AntigravityCliExecutionError &&
    error.code === "ANTIGRAVITY_CLI_EXECUTION_FAILED" &&
    error.details?.reason === reason;
}
