import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoleContractRegistry } from "../../src/core/role-contract-registry.js";
import type { AgentName } from "../../src/domain/agent.js";
import type { AgentBehavior } from "../../src/domain/agent-behavior.js";
import type { AgentContext } from "../../src/domain/agent-context.js";
import type { AgentExecutionInput } from "../../src/domain/agent-invocation.js";
import type { ExecutionPolicy } from "../../src/domain/execution-policy.js";
import { GeminiCliExecutionError } from "../../src/domain/errors.js";
import {
  SpawnProcessRunner,
  type ProcessResult,
  type ProcessRunInput,
  type ProcessRunner,
} from "../../src/infrastructure/process-runner.js";
import { GeminiCliRuntimeAvailability } from "../../src/providers/gemini-cli-runtime-availability.js";

export class ObservingGeminiRunner implements ProcessRunner {
  private readonly delegate = new SpawnProcessRunner();
  geminiInput: ProcessRunInput | null = null;
  settings: unknown = null;
  policy = "";
  driverRoot: string | null = null;

  async run(input: ProcessRunInput): Promise<ProcessResult> {
    if (input.executable === "gemini") {
      assert.ok(input.cwd, "Gemini invocation must have a driver cwd");
      this.geminiInput = input;
      this.driverRoot = input.cwd;
      this.settings = JSON.parse(
        await readFile(join(input.cwd, ".gemini", "settings.json"), "utf8"),
      );
      this.policy = await readFile(optionValue(input.args, "--policy"), "utf8");
    }
    return this.delegate.run(input);
  }
}

export async function assertGeminiRuntimeAvailable(): Promise<void> {
  const result = await new GeminiCliRuntimeAvailability().probe();
  assert.equal(
    result.available,
    true,
    `Gemini runtime is unavailable: ${JSON.stringify(result)}`,
  );
}

export function assertGeminiIsolation(
  runner: ObservingGeminiRunner,
  sourcePath: string,
  expectedTools: readonly string[],
): void {
  assert.ok(runner.geminiInput);
  const input = runner.geminiInput;
  assert.notEqual(input.cwd, sourcePath);
  assert.equal(optionValue(input.args, "--include-directories"), sourcePath);
  assert.equal(optionValue(input.args, "--extensions"), "none");
  assert.equal(optionValue(input.args, "--approval-mode"), "default");
  assert.equal(input.args.includes("--yolo"), false);
  assert.equal(input.args.includes("--resume"), false);
  assert.match(optionValue(input.args, "--allowed-mcp-server-names"), /^synaphex-no-mcp-/);
  assert.deepEqual(allowedTools(runner.policy), expectedTools);
  assert.match(runner.policy, /mcpName = "\*"/);
  assert.deepEqual(runner.settings, {
    hooksConfig: { enabled: false },
    skills: { enabled: false },
    experimental: { autoMemory: false },
    general: { checkpointing: { enabled: false } },
    context: {
      fileName: (runner.settings as { context: { fileName: string } }).context.fileName,
      loadMemoryFromIncludeDirectories: false,
    },
    security: {
      disableYoloMode: true,
      disableAlwaysAllow: true,
      enablePermanentToolApproval: false,
    },
  });
}

export async function assertDriverCleaned(runner: ObservingGeminiRunner): Promise<void> {
  assert.ok(runner.driverRoot);
  await assert.rejects(access(runner.driverRoot), { code: "ENOENT" });
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
  });
  assert.equal(result.exitCode, 0, "git init failed for Gemini live test");
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
      host: { provider: "google", surface: "cli" },
      provider: "google",
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
  await assert.rejects(access(join(sourcePath, ".synaphex")), { code: "ENOENT" });
  await assert.rejects(access(join(sourcePath, ".gemini")), { code: "ENOENT" });
}

export async function gitStatus(sourcePath: string): Promise<string> {
  const result = await runProcess({
    executable: "git",
    args: ["status", "--porcelain", "--untracked-files=all"],
    cwd: sourcePath,
  });
  assert.equal(result.exitCode, 0, "git status failed for Gemini live test");
  return result.stdout;
}

export function optionValue(args: readonly string[], option: string): string {
  const index = args.indexOf(option);
  assert.notEqual(index, -1, `missing ${option}`);
  const value = args[index + 1];
  assert.ok(value !== undefined, `missing value for ${option}`);
  return value;
}

export function boundedGeminiDiagnostic(error: unknown): string {
  if (error instanceof GeminiCliExecutionError) {
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

export async function runGit(
  sourcePath: string,
  args: readonly string[],
): Promise<void> {
  const result = await runProcess({ executable: "git", args, cwd: sourcePath });
  assert.equal(result.exitCode, 0, `git ${args[0] ?? "command"} failed`);
}

const READ_TOOLS = [
  "read_file",
  "read_many_files",
  "list_directory",
  "glob",
  "grep_search",
] as const;

export const GEMINI_LIVE_READ_TOOLS = READ_TOOLS;
export const GEMINI_LIVE_SEARCH_TOOLS = [...READ_TOOLS, "google_web_search"] as const;
export const GEMINI_LIVE_CODER_TOOLS = [...READ_TOOLS, "write_file", "replace"] as const;

function allowedTools(policy: string): string[] {
  return [...policy.matchAll(/toolName = "([^"]+)"\ndecision = "allow"/g)].map(
    (match) => match[1]!,
  );
}

function liveContext(options: {
  readonly agent: AgentName;
  readonly sourcePath: string;
  readonly networkEnabled: boolean;
  readonly behavior: AgentBehavior | null;
  readonly instruction: string;
}): AgentContext {
  const projectId = "prj_gemini_live" as const;
  const taskId = "task_gemini_live" as const;
  const task = options.agent === "coder"
    ? {
        id: taskId,
        projectId,
        slug: "gemini-live-smoke",
        description: "Verify the Gemini CLI adapter",
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
      name: "Gemini CLI Live Smoke",
      sourcePath: options.sourcePath,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    task,
    roleContract: new RoleContractRegistry().getSnapshot(options.agent),
    rules: {
      outgoingAgentCalls: [],
      actions: [{
        key: { kind: "action", action: "network" },
        decision: options.networkEnabled ? "allow" : "deny",
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

function livePolicy(agent: AgentName, networkEnabled: boolean): ExecutionPolicy {
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
