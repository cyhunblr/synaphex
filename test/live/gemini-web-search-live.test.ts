import assert from "node:assert/strict";
import test from "node:test";
import { validateAgentResult } from "../../src/core/agent-result-validator.js";
import { GeminiCliAgentExecutor } from "../../src/providers/gemini-cli-agent-executor.js";
import {
  GEMINI_LIVE_SEARCH_TOOLS,
  ObservingGeminiRunner,
  assertDriverCleaned,
  assertGeminiIsolation,
  assertGeminiRuntimeAvailable,
  assertNoSynaphexState,
  boundedGeminiDiagnostic,
  gitStatus,
  liveInput,
  temporaryGitRepository,
} from "./gemini-live-support.js";

const enabled = process.env.SYNAPHEX_GEMINI_WEB_SEARCH_LIVE_TEST === "1";
const model = process.env.SYNAPHEX_GEMINI_LIVE_MODEL?.trim() ?? "";

test(
  "live Gemini RESEARCHER uses hosted Google Search without shell or web_fetch",
  { skip: enabled && model !== "" ? false : skipReason() },
  async () => {
    await assertGeminiRuntimeAvailable();
    const repository = await temporaryGitRepository("synaphex-gemini-search-live-");
    const originalStatus = await gitStatus(repository.sourcePath);
    const runner = new ObservingGeminiRunner();
    let stage = "Gemini process/output";
    try {
      const raw = await new GeminiCliAgentExecutor({
        processRunner: runner,
        includeStderrDiagnostic: true,
      }).execute(liveInput({
        agent: "researcher",
        sourcePath: repository.sourcePath,
        model,
        networkEnabled: true,
        behavior: { outputFields: ["findings"] },
        instruction:
          "Use google_web_search to obtain one small current fact from the official Gemini CLI documentation at github.com/google-gemini/gemini-cli. Include the official domain and fact in researchArtifact.findings. Do not use shell, web_fetch, modify files, or request helper calls or actions.",
      }));
      stage = "Core AgentResult validation";
      const result = validateAgentResult("researcher", raw);
      stage = "smoke-test semantic assertions";
      assert.equal(result.outcome, "success");
      assert.ok(Object.hasOwn(result.researchArtifact, "findings"));
      const findings = result.researchArtifact.findings;
      assert.equal(isMeaningfullyNonEmptyJson(findings), true);
      assert.match(flattenJson(findings), /github\.com|google-gemini|geminicli\.com/i);
      assert.equal(result.requestedCalls?.length ?? 0, 0);
      assert.equal(result.requestedActions?.length ?? 0, 0);
      assertGeminiIsolation(runner, repository.sourcePath, GEMINI_LIVE_SEARCH_TOOLS);
      assert.equal(runner.policy.includes("web_fetch"), false);
      assert.equal(runner.policy.includes("run_shell_command"), false);
      assert.equal(await gitStatus(repository.sourcePath), originalStatus);
      await assertNoSynaphexState(repository.sourcePath);
      await assertDriverCleaned(runner);
      console.log(`[gemini-web-search-live] validated agent=${result.agent} outcome=${result.outcome} findingsType=${jsonType(findings)}`);
    } catch (error) {
      console.error(`[gemini-web-search-live] failed stage=${stage} diagnostic=${boundedGeminiDiagnostic(error)}`);
      throw error;
    } finally {
      await repository.cleanup();
    }
  },
);

function skipReason(): string {
  return enabled
    ? "set SYNAPHEX_GEMINI_LIVE_MODEL=<model>"
    : "set SYNAPHEX_GEMINI_WEB_SEARCH_LIVE_TEST=1 and SYNAPHEX_GEMINI_LIVE_MODEL=<model>";
}

function isMeaningfullyNonEmptyJson(value: unknown): boolean {
  if (value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "object" && Object.keys(value).length > 0;
}

function flattenJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return value.map(flattenJson).join(" ");
  if (typeof value === "object") {
    return Object.entries(value)
      .flatMap(([key, nested]) => [key, flattenJson(nested)])
      .join(" ");
  }
  return String(value);
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}
