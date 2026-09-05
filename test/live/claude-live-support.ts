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
import { ClaudeCliExecutionError } from "../../src/domain/errors.js";
import { ClaudeCliRuntimeAvailability } from "../../src/providers/claude-cli-runtime-availability.js";
import {
  SpawnProcessRunner,
  type ProcessResult,
  type ProcessRunInput,
  type ProcessRunner,
} from "../../src/infrastructure/process-runner.js";

export class ObservingClaudeRunner implements ProcessRunner {
  private readonly delegate = new SpawnProcessRunner();
  claudeInput: ProcessRunInput | null = null;

  async run(input: ProcessRunInput): Promise<ProcessResult> {
    if (input.executable === "claude") {
      this.claudeInput = input;
    }
    return this.delegate.run(input);
  }
}

export async function assertClaudeRuntimeAvailable(): Promise<void> {
  const result = await new ClaudeCliRuntimeAvailability().probe();
  assert.equal(
    result.available,
    true,
    `Claude runtime is unavailable: ${JSON.stringify(result)}`,
  );
}

export function assertClaudeIsolationArgs(args: readonly string[]): void {
  assert.ok(args.includes("--safe-mode"));
  assert.ok(args.includes("--restricted"));
  assert.equal(args.includes("--bare"), false);
}

export async function temporaryGitRepository(prefix: string): Promise<{
  readonly root: string;
  readonly sourcePath: string;
  cleanup(): Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const sourcePath = join(root, "source");
  const result = await runProcess({
    executable: "git",
    args: ["init", "--quiet", sourcePath],
    cwd: undefined,
  });
  assert.equal(result.exitCode, 0, "git init failed for Claude live test");
  return {
    root,
    sourcePath,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export function liveInput(options: {
  readonly agent: AgentName;
  readonly sourcePath: string;
  readonly model: string;
  readonly networkEnabled: boolean;
  readonly behavior: AgentBehavior | null;
  readonly instruction: string;
}): AgentExecutionInput {
  return {
    route: {
      agent: options.agent,
      host: { provider: "anthropic" },
      provider: "anthropic",
      configuredSurface: "cli",
      effectiveSurface: "cli",
      cliForcedByCrossProvider: false,
      routingReason: "same_provider_configured_cli",
      model: options.model,
      settings: {},
    },
    context: liveContext(options),
    executionPolicy: livePolicy(options.agent, options.networkEnabled),
  };
}

export async function assertNoSynaphexState(sourcePath: string): Promise<void> {
  await assert.rejects(access(join(sourcePath, ".synaphex")), {
    code: "ENOENT",
  });
}

export async function gitStatus(sourcePath: string): Promise<string> {
  const result = await runProcess({
    executable: "git",
    args: ["status", "--porcelain", "--untracked-files=all"],
    cwd: sourcePath,
  });
  assert.equal(result.exitCode, 0, "git status failed for Claude live test");
  return result.stdout;
}

export function optionValue(
  args: readonly string[],
  option: string,
): string {
  const index = args.indexOf(option);
  assert.notEqual(index, -1, `missing ${option}`);
  const value = args[index + 1];
  assert.ok(value !== undefined, `missing value for ${option}`);
  return value;
}

export function boundedClaudeDiagnostic(error: unknown): string {
  if (error instanceof ClaudeCliExecutionError) {
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

function liveContext(options: {
  readonly agent: AgentName;
  readonly sourcePath: string;
  readonly networkEnabled: boolean;
  readonly behavior: AgentBehavior | null;
  readonly instruction: string;
}): AgentContext {
  const projectId = "prj_claude_live" as const;
  const taskId = "task_claude_live" as const;
  const task = options.agent === "coder"
    ? {
        id: taskId,
        projectId,
        slug: "claude-live-smoke",
        description: "Verify the Claude CLI adapter",
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
      name: "Claude CLI Live Smoke",
      sourcePath: options.sourcePath,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    task,
    roleContract: new RoleContractRegistry().getSnapshot(options.agent),
    rules: {
      outgoingAgentCalls: [],
      actions: [
        {
          key: { kind: "action", action: "network" },
          decision: options.networkEnabled ? "allow" : "deny",
          source: "global",
        },
      ],
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

function livePolicy(
  agent: AgentName,
  networkEnabled: boolean,
): ExecutionPolicy {
  return {
    sourceModification: agent === "coder" ? "workspace_write" : "read_only",
    providerCapabilities: {
      network: {
        decision: networkEnabled ? "allow" : "deny",
        source: "global",
        approvedForInvocation: false,
      },
    },
  };
}

async function runProcess(options: {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
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
