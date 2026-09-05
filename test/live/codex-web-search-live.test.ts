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
import {
  SpawnProcessRunner,
  type ProcessResult,
  type ProcessRunInput,
  type ProcessRunner,
} from "../../src/infrastructure/process-runner.js";
import { CodexCliAgentExecutor } from "../../src/providers/codex-cli-agent-executor.js";
import {
  CODEX_WEB_SEARCH_LIVE_OVERRIDE,
  resolveCodexExecutionPolicy,
} from "../../src/providers/codex-execution-policy-resolver.js";

const liveEnabled = process.env.SYNAPHEX_CODEX_WEB_SEARCH_LIVE_TEST === "1";
const liveModel = process.env.SYNAPHEX_CODEX_LIVE_MODEL?.trim() ?? "";
const shouldRun = liveEnabled && liveModel.length > 0;

class JsonEventObservingRunner implements ProcessRunner {
  private readonly delegate = new SpawnProcessRunner();
  readonly codexEvents: unknown[] = [];
  codexInput: ProcessRunInput | null = null;

  async run(input: ProcessRunInput): Promise<ProcessResult> {
    const isCodexExecution =
      input.executable === "codex" && input.args[0] === "exec";
    const effectiveInput = isCodexExecution
      ? { ...input, args: ["exec", "--json", ...input.args.slice(1)] }
      : input;
    if (isCodexExecution) {
      this.codexInput = effectiveInput;
    }
    const result = await this.delegate.run(effectiveInput);
    if (isCodexExecution) {
      this.codexEvents.push(...parseJsonLines(result.stdout));
    }
    return result;
  }

  observedWebSearch(): boolean {
    return this.codexEvents.some(isWebSearchEvent);
  }

  eventTypes(): string[] {
    return this.codexEvents
      .map((event) =>
        isRecord(event) && typeof event.type === "string"
          ? event.type
          : "unknown",
      )
      .slice(-30);
  }
}

test(
  "live Codex CLI gives read-only RESEARCHER native hosted web search",
  { skip: shouldRun ? false : skipReason() },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "synaphex-codex-search-live-"));
    const sourcePath = join(root, "source");
    const processRunner = new JsonEventObservingRunner();
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
      assert.equal(git.exitCode, 0, "git init failed for hosted-search smoke");
      assert.equal(git.timedOut, false, "git init timed out");

      const executionPolicy = hostedSearchPolicy();
      assert.deepEqual(resolveCodexExecutionPolicy(executionPolicy), {
        sandbox: "read-only",
        network: { enabled: true, mechanism: "hosted_web_search" },
        configOverrides: [CODEX_WEB_SEARCH_LIVE_OVERRIDE],
      });
      const input: AgentExecutionInput = {
        route: {
          agent: "researcher",
          host: { provider: "openai" },
          provider: "openai",
          configuredSurface: "cli",
          effectiveSurface: "cli",
          cliForcedByCrossProvider: false,
          routingReason: "same_provider_configured_cli",
          model: liveModel,
          settings: {},
        },
        context: researcherContext(sourcePath),
        executionPolicy,
      };

      stage = "Codex process execution / hosted web search / output parsing";
      const rawResult = await new CodexCliAgentExecutor({
        processRunner,
        includeStderrDiagnostic: true,
      }).execute(input);
      stage = "AgentResult runtime validation";
      const validated = validateAgentResult("researcher", rawResult);

      assert.equal(validated.agent, "researcher");
      assert.equal(validated.outcome, "success");
      assert.deepEqual(Object.keys(validated.researchArtifact), ["findings"]);
      const findings = validated.researchArtifact.findings;
      assert.equal(typeof findings, "string");
      for (const expected of ["disabled", "cached", "indexed", "live"]) {
        assert.match(String(findings), new RegExp(`\\b${expected}\\b`, "i"));
      }
      assert.match(String(findings), /developers\.openai\.com|learn\.chatgpt\.com/i);
      assert.equal(validated.requestedCalls?.length ?? 0, 0);
      assert.equal(validated.requestedActions?.length ?? 0, 0);

      stage = "hosted web-search event validation";
      assert.equal(
        processRunner.observedWebSearch(),
        true,
        `no web_search event observed; event types: ${processRunner.eventTypes().join(",")}`,
      );
      assert.ok(processRunner.codexInput);
      assert.equal(
        optionValue(processRunner.codexInput.args, "--sandbox"),
        "read-only",
      );
      assert.deepEqual(configOverrides(processRunner.codexInput.args), [
        CODEX_WEB_SEARCH_LIVE_OVERRIDE,
      ]);
      assert.equal(
        processRunner.codexInput.args.some((argument) =>
          argument.startsWith("sandbox_workspace_write.network_access="),
        ),
        false,
      );

      stage = "read-only workspace and temporary-file safety validation";
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
        `[codex-web-search-live] validated agent=${validated.agent} outcome=${validated.outcome} webSearchEvent=true helperCalls=${validated.requestedCalls?.length ?? 0}`,
      );
    } catch (error) {
      console.error(
        `[codex-web-search-live] failed stage=${stage} eventTypes=${processRunner.eventTypes().join(",")} diagnostic=${boundedDiagnostic(error)}`,
      );
      throw error;
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

function researcherContext(sourcePath: string): AgentContext {
  const projectId = "prj_codex_search_live" as const;
  return {
    agent: "researcher",
    project: {
      id: projectId,
      name: "Codex Hosted Search Live Smoke",
      sourcePath,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    task: null,
    roleContract: new RoleContractRegistry().getSnapshot("researcher"),
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
      "Use Codex's native hosted web-search tool to retrieve the current official OpenAI Codex Configuration Reference page at https://developers.openai.com/codex/config-reference . Do not use shell commands, curl, wget, Node, Python, or local process network access. Find the documented allowed values for the top-level web_search setting. Return a successful RESEARCHER result whose findings string includes all four values and the official page URL. Do not modify files or request helper calls or actions.",
  };
}

function hostedSearchPolicy(): ExecutionPolicy {
  return {
    sourceModification: "read_only",
    providerCapabilities: {
      network: {
        decision: "allow",
        source: "global",
        approvedForInvocation: false,
      },
    },
  };
}

function parseJsonLines(output: string): unknown[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
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
    return "set SYNAPHEX_CODEX_WEB_SEARCH_LIVE_TEST=1 and SYNAPHEX_CODEX_LIVE_MODEL=<model>";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isWebSearchEvent(event: unknown): boolean {
  if (!isRecord(event)) {
    return false;
  }
  if (
    typeof event.type === "string" &&
    event.type.toLowerCase().includes("web_search")
  ) {
    return true;
  }
  const item = event.item;
  return (
    isRecord(item) &&
    typeof item.type === "string" &&
    item.type.toLowerCase().includes("web_search")
  );
}
