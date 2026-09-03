import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateAgentResult } from "../../src/core/agent-result-validator.js";
import { RoleContractRegistry } from "../../src/core/role-contract-registry.js";
import type { AgentContext } from "../../src/domain/agent-context.js";
import type { AgentExecutionInput } from "../../src/domain/agent-invocation.js";
import { CodexCliExecutionError } from "../../src/domain/errors.js";
import { SpawnProcessRunner } from "../../src/infrastructure/process-runner.js";
import { CodexCliAgentExecutor } from "../../src/providers/codex-cli-agent-executor.js";
import type { ExecutionPolicy } from "../../src/domain/execution-policy.js";

const liveEnabled = process.env.SYNAPHEX_CODEX_LIVE_TEST === "1";
const liveModel = process.env.SYNAPHEX_CODEX_LIVE_MODEL?.trim() ?? "";
const shouldRun = liveEnabled && liveModel.length > 0;

test(
  "live Codex CLI adapter returns a validated RESEARCHER result",
  { skip: shouldRun ? false : skipReason() },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "synaphex-codex-live-"));
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
      assert.equal(git.exitCode, 0, "git init failed for live smoke workspace");
      assert.equal(git.timedOut, false, "git init timed out");

      const context = researcherContext(sourcePath);
      const input: AgentExecutionInput = {
        route: {
          agent: "researcher",
          host: { provider: "openai", surface: "cli" },
          provider: "openai",
          configuredSurface: "cli",
          effectiveSurface: "cli",
          cliForcedByCrossProvider: false,
          routingReason: "same_provider_configured_cli",
          model: liveModel,
          settings: {},
        },
        context,
        executionPolicy: readOnlySmokePolicy(),
      };

      stage = "Codex process execution / output parsing";
      const rawResult = await new CodexCliAgentExecutor({
        includeStderrDiagnostic: true,
      }).execute(input);
      stage = "AgentResult runtime validation";
      const validated = validateAgentResult("researcher", rawResult);

      assert.equal(validated.agent, "researcher");
      assert.equal(validated.outcome, "success");
      assert.deepEqual(Object.keys(validated.researchArtifact).sort(), [
        "findings",
      ]);
      const findings = validated.researchArtifact.findings;
      assert.equal(typeof findings, "string");
      assert.ok(typeof findings === "string" && findings.trim().length > 0);
      assert.equal(validated.requestedCalls?.length ?? 0, 0);
      assert.equal(validated.requestedActions?.length ?? 0, 0);

      stage = "read-only workspace safety validation";
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
        `[codex-live] validated agent=${validated.agent} outcome=${validated.outcome} payloadFields=${Object.keys(validated.researchArtifact).join(",")} helperCalls=${validated.requestedCalls?.length ?? 0}`,
      );
    } catch (error) {
      console.error(
        `[codex-live] failed stage=${stage} diagnostic=${boundedDiagnostic(error)}`,
      );
      throw error;
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

function researcherContext(sourcePath: string): AgentContext {
  const projectId = "prj_codex_live" as const;
  return {
    agent: "researcher",
    project: {
      id: projectId,
      name: "Codex Live Smoke",
      sourcePath,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    task: null,
    roleContract: new RoleContractRegistry().getSnapshot("researcher"),
    rules: { outgoingAgentCalls: [], actions: [] },
    memory: {
      project: {
        scope: { kind: "project", projectId },
        hasContent: false,
        content: null,
      },
      task: null,
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
    behavior: { outputFields: ["findings"] },
    instruction:
      "Return a successful RESEARCHER result for this smoke test. Set the Researcher payload's only field, findings, to a short value indicating that the Codex live adapter worked. Do not request any helper agent calls or actions. Do not use the web and do not modify files.",
  };
}

function readOnlySmokePolicy(): ExecutionPolicy {
  const approvalRequired = {
    decision: "ask",
    source: "global",
    approvedForInvocation: false,
  } as const;
  return {
    sourceModification: "read_only",
    actions: {
      git_push: approvalRequired,
      network: approvalRequired,
      ci: approvalRequired,
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
    return "set SYNAPHEX_CODEX_LIVE_TEST=1 and SYNAPHEX_CODEX_LIVE_MODEL=<model>";
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
