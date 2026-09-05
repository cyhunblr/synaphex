import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoleContractRegistry } from "../../src/core/role-contract-registry.js";
import type { AgentName } from "../../src/domain/agent.js";
import type { AgentBehavior } from "../../src/domain/agent-behavior.js";
import type { AgentContext } from "../../src/domain/agent-context.js";
import type { AgentExecutionInput } from "../../src/domain/agent-invocation.js";
import type { ExecutionPolicy } from "../../src/domain/execution-policy.js";
import { AntigravityCliExecutionError } from "../../src/domain/errors.js";
import {
  SpawnProcessRunner,
  type ProcessResult,
  type ProcessRunInput,
  type ProcessRunner,
} from "../../src/infrastructure/process-runner.js";
import { AntigravityCliRuntimeAvailability } from "../../src/providers/antigravity-cli-runtime-availability.js";

export class ObservingAntigravityRunner implements ProcessRunner {
  private readonly delegate = new SpawnProcessRunner();
  agyInput: ProcessRunInput | null = null;

  async run(input: ProcessRunInput): Promise<ProcessResult> {
    if (input.executable === "agy") {
      this.agyInput = input;
    }
    return this.delegate.run(input);
  }
}

export async function assertAntigravityRuntimeAvailable(): Promise<void> {
  const result = await new AntigravityCliRuntimeAvailability().probe();
  assert.equal(
    result.available,
    true,
    `Antigravity runtime is unavailable: ${JSON.stringify(result)}`,
  );
}

export function assertAntigravityInvocation(
  runner: ObservingAntigravityRunner,
  sourcePath: string,
  mode: "plan" | "accept-edits",
): void {
  assert.ok(runner.agyInput);
  const input = runner.agyInput;
  assert.equal(input.cwd, sourcePath);
  assert.equal(optionValue(input.args, "--mode"), mode);
  assert.equal(optionValue(input.args, "--output-format"), "json");
  assert.ok(optionValue(input.args, "--json-schema").startsWith("{"));
  assert.ok(input.args.includes("--sandbox"));
  assert.ok(input.args.includes("--disable-slash-commands"));
  assert.equal(input.args.includes("--continue"), false);
  assert.equal(input.args.includes("-c"), false);
  assert.equal(input.args.includes("--conversation"), false);
  assert.equal(input.args.includes("--dangerously-skip-permissions"), false);
}

export async function temporaryGitRepository(prefix: string): Promise<{
  readonly root: string;
  readonly sourcePath: string;
  cleanup(): Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const sourcePath = join(root, "source");
  const result = await runProcess({ executable: "git", args: ["init", "--quiet", sourcePath] });
  assert.equal(result.exitCode, 0, "git init failed for Antigravity live test");
  return { root, sourcePath, cleanup: () => rm(root, { recursive: true, force: true }) };
}

export function liveInput(options: {
  readonly agent: AgentName;
  readonly sourcePath: string;
  readonly model: string;
  readonly behavior: AgentBehavior | null;
  readonly instruction: string;
}): AgentExecutionInput {
  return {
    route: {
      agent: options.agent,
      host: { provider: "google" },
      provider: "google",
      configuredSurface: "cli",
      effectiveSurface: "cli",
      cliForcedByCrossProvider: false,
      routingReason: "same_provider_configured_cli",
      model: options.model,
      settings: {},
    },
    context: liveContext(options),
    executionPolicy: livePolicy(options.agent),
  };
}

export async function gitStatus(sourcePath: string): Promise<string> {
  const result = await runProcess({
    executable: "git",
    args: ["status", "--porcelain", "--untracked-files=all"],
    cwd: sourcePath,
  });
  assert.equal(result.exitCode, 0, "git status failed for Antigravity live test");
  return result.stdout;
}

export async function assertNoSynaphexState(sourcePath: string): Promise<void> {
  await assert.rejects(access(join(sourcePath, ".synaphex")), { code: "ENOENT" });
}

export async function runGit(sourcePath: string, args: readonly string[]): Promise<void> {
  const result = await runProcess({ executable: "git", args, cwd: sourcePath });
  assert.equal(result.exitCode, 0, `git ${args[0] ?? "command"} failed`);
}

export function boundedAntigravityDiagnostic(error: unknown): string {
  if (error instanceof AntigravityCliExecutionError) {
    return JSON.stringify({
      code: error.code,
      reason: error.details?.reason,
      exitCode: error.details?.exitCode,
      signal: error.details?.signal,
      stderr: error.details?.stderrDiagnostic,
    }).slice(0, 5_000);
  }
  if (error instanceof Error) {
    const code = "code" in error ? String(error.code) : error.name;
    return JSON.stringify({ code, message: error.message }).slice(0, 5_000);
  }
  return "unknown non-Error failure";
}

function optionValue(args: readonly string[], option: string): string {
  const index = args.indexOf(option);
  assert.notEqual(index, -1, `missing ${option}`);
  const value = args[index + 1];
  assert.ok(value !== undefined, `missing value for ${option}`);
  return value;
}

function liveContext(options: {
  readonly agent: AgentName;
  readonly sourcePath: string;
  readonly behavior: AgentBehavior | null;
  readonly instruction: string;
}): AgentContext {
  const projectId = "prj_antigravity_live" as const;
  const taskId = "task_antigravity_live" as const;
  const task = options.agent === "coder"
    ? {
        id: taskId,
        projectId,
        slug: "antigravity-live-smoke",
        description: "Verify the Antigravity CLI adapter",
        status: "active" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        completedAt: null,
        archivedAt: null,
      }
    : null;
  return {
    agent: options.agent,
    project: {
      id: projectId,
      name: "Antigravity CLI Live Smoke",
      sourcePath: options.sourcePath,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    task,
    roleContract: new RoleContractRegistry().getSnapshot(options.agent),
    rules: {
      outgoingAgentCalls: [],
      actions: [{
        key: { kind: "action", action: "network" },
        decision: "deny",
        source: "global",
      }],
    },
    memory: {
      project: {
        scope: { kind: "project", projectId },
        hasContent: false,
        content: null,
      },
      task: task === null
        ? null
        : {
            scope: { kind: "task", projectId, taskId },
            hasContent: false,
            content: null,
          },
      directlyLoaded: [],
    },
    plan: null,
    artifacts: {
      questionerContext: null,
      research: [],
      coderWorkRecords: [],
      latestReviewerReport: null,
      explicitlyReferenced: [],
    },
    behavior: options.behavior,
    instruction: options.instruction,
  };
}

function livePolicy(agent: AgentName): ExecutionPolicy {
  return {
    sourceModification: agent === "coder" ? "workspace_write" : "read_only",
    providerCapabilities: {
      network: {
        decision: "deny",
        source: "global",
        approvedForInvocation: false,
      },
    },
  };
}

async function runProcess(options: {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd?: string;
}): Promise<ProcessResult> {
  return new SpawnProcessRunner().run({
    executable: options.executable,
    args: options.args,
    stdin: "",
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    timeoutMs: 10_000,
    terminationGraceMs: 1_000,
  });
}
