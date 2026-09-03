import assert from "node:assert/strict";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateAgentResult } from "../../src/core/agent-result-validator.js";
import { RoleContractRegistry } from "../../src/core/role-contract-registry.js";
import type { AgentContext } from "../../src/domain/agent-context.js";
import type { AgentExecutionInput } from "../../src/domain/agent-invocation.js";
import { CodexCliExecutionError } from "../../src/domain/errors.js";
import type { ExecutionPolicy } from "../../src/domain/execution-policy.js";
import { SpawnProcessRunner } from "../../src/infrastructure/process-runner.js";
import { CodexCliAgentExecutor } from "../../src/providers/codex-cli-agent-executor.js";
import {
  CODEX_WORKSPACE_WRITE_NETWORK_OVERRIDE,
  resolveCodexExecutionPolicy,
} from "../../src/providers/codex-execution-policy-resolver.js";

const liveEnabled = process.env.SYNAPHEX_CODEX_NETWORK_LIVE_TEST === "1";
const liveModel = process.env.SYNAPHEX_CODEX_LIVE_MODEL?.trim() ?? "";
const shouldRun = liveEnabled && liveModel.length > 0;

test(
  "live Codex CLI maps enabled CODER network and performs a harmless HTTPS check",
  { skip: shouldRun ? false : skipReason() },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "synaphex-codex-network-live-"));
    const sourcePath = join(root, "source");
    const processRunner = new SpawnProcessRunner();
    const temporaryDirectoriesBefore = await listAdapterTemporaryDirectories();
    let stage = "temporary Git repository initialization";

    try {
      const git = await processRunner.run({
        executable: "git",
        args: ["init", "--quiet", sourcePath],
        stdin: "",
        timeoutMs: 10_000,
        terminationGraceMs: 1_000,
      });
      assert.equal(git.exitCode, 0, "git init failed for network smoke workspace");
      assert.equal(git.timedOut, false, "git init timed out");

      const executionPolicy = networkEnabledCoderPolicy();
      assert.deepEqual(resolveCodexExecutionPolicy(executionPolicy), {
        sandbox: "workspace-write",
        network: "enabled",
        mechanism: "legacy_workspace_write_override",
        configOverrides: [CODEX_WORKSPACE_WRITE_NETWORK_OVERRIDE],
      });
      const input: AgentExecutionInput = {
        route: {
          agent: "coder",
          host: { provider: "openai", surface: "cli" },
          provider: "openai",
          configuredSurface: "cli",
          effectiveSurface: "cli",
          cliForcedByCrossProvider: false,
          routingReason: "same_provider_configured_cli",
          model: liveModel,
          settings: {},
        },
        context: coderContext(sourcePath),
        executionPolicy,
      };

      stage = "Codex process execution / network reachability / output parsing";
      const rawResult = await new CodexCliAgentExecutor({
        includeStderrDiagnostic: true,
      }).execute(input);
      stage = "AgentResult runtime validation";
      const validated = validateAgentResult("coder", rawResult);

      assert.equal(validated.agent, "coder");
      assert.equal(validated.outcome, "success");
      assert.deepEqual(Object.keys(validated.workRecord).sort(), [
        "files_changed",
        "network_check",
      ]);
      assert.deepEqual(validated.workRecord.files_changed, []);
      assert.equal(
        validated.workRecord.network_check,
        "openai_robots_reachable",
      );
      assert.equal(validated.requestedCalls?.length ?? 0, 0);
      assert.equal(validated.requestedActions?.length ?? 0, 0);

      stage = "workspace and adapter temporary-file safety validation";
      const gitStatus = await processRunner.run({
        executable: "git",
        args: ["status", "--porcelain", "--untracked-files=all"],
        stdin: "",
        cwd: sourcePath,
        timeoutMs: 10_000,
        terminationGraceMs: 1_000,
      });
      assert.equal(gitStatus.exitCode, 0);
      assert.equal(gitStatus.stdout, "");
      await assert.rejects(access(join(sourcePath, ".synaphex")), {
        code: "ENOENT",
      });
      assert.deepEqual(
        await listAdapterTemporaryDirectories(),
        temporaryDirectoriesBefore,
        "Codex adapter temporary schema/result directory was not cleaned",
      );

      console.log(
        `[codex-network-live] validated agent=${validated.agent} outcome=${validated.outcome} networkCheck=${String(validated.workRecord.network_check)} helperCalls=${validated.requestedCalls?.length ?? 0}`,
      );
    } catch (error) {
      console.error(
        `[codex-network-live] failed stage=${stage} diagnostic=${boundedDiagnostic(error)}`,
      );
      throw error;
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

function coderContext(sourcePath: string): AgentContext {
  const projectId = "prj_codex_network_live" as const;
  const taskId = "task_codex_network_live" as const;
  return {
    agent: "coder",
    project: {
      id: projectId,
      name: "Codex Network Live Smoke",
      sourcePath,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    task: {
      id: taskId,
      projectId,
      slug: "codex-network-live-smoke",
      description: "Verify the native Codex network capability mapping",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      archivedAt: null,
    },
    roleContract: new RoleContractRegistry().getSnapshot("coder"),
    rules: {
      outgoingAgentCalls: [],
      actions: [
        {
          key: { kind: "action", action: "network" },
          decision: "allow",
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
      task: {
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
    behavior: { outputFields: ["files_changed", "network_check"] },
    instruction:
      "Perform a real, read-only HTTPS reachability check by running: curl -L --fail --silent --show-error --max-time 20 https://www.openai.com/robots.txt . Verify that the response contains 'User-agent' (case-insensitive). Do not claim success unless curl succeeds and that text is present. Do not modify project files. Return a successful CODER result whose payload contains exactly files_changed=[] and network_check='openai_robots_reachable'. Do not request helper calls or actions.",
  };
}

function networkEnabledCoderPolicy(): ExecutionPolicy {
  return {
    sourceModification: "workspace_write",
    providerCapabilities: {
      network: {
        decision: "allow",
        source: "global",
        approvedForInvocation: false,
      },
    },
  };
}

async function listAdapterTemporaryDirectories(): Promise<string[]> {
  return (await readdir(tmpdir(), { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.startsWith("synaphex-codex-exec-"),
    )
    .map(({ name }) => name)
    .sort();
}

function skipReason(): string {
  if (!liveEnabled) {
    return "set SYNAPHEX_CODEX_NETWORK_LIVE_TEST=1 and SYNAPHEX_CODEX_LIVE_MODEL=<model>";
  }
  return "set SYNAPHEX_CODEX_LIVE_MODEL=<model>";
}

function boundedDiagnostic(error: unknown): string {
  if (error instanceof CodexCliExecutionError) {
    return JSON.stringify({
      code: error.code,
      reason: error.details?.reason,
      category: error.details?.diagnosticCategory,
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
