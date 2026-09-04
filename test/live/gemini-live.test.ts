import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { validateAgentResult } from "../../src/core/agent-result-validator.js";
import { GeminiCliAgentExecutor } from "../../src/providers/gemini-cli-agent-executor.js";
import {
  GEMINI_LIVE_READ_TOOLS,
  ObservingGeminiRunner,
  assertDriverCleaned,
  assertGeminiIsolation,
  assertGeminiRuntimeAvailable,
  assertNoSynaphexState,
  boundedGeminiDiagnostic,
  gitStatus,
  liveInput,
  runGit,
  temporaryGitRepository,
} from "./gemini-live-support.js";

const enabled = process.env.SYNAPHEX_GEMINI_LIVE_TEST === "1";
const model = process.env.SYNAPHEX_GEMINI_LIVE_MODEL?.trim() ?? "";

test(
  "live Gemini CLI adapter returns a validated read-only RESEARCHER result",
  { skip: enabled && model !== "" ? false : skipReason() },
  async () => {
    await assertGeminiRuntimeAvailable();
    const repository = await temporaryGitRepository("synaphex-gemini-live-");
    await writeFile(join(repository.sourcePath, "marker.txt"), "INCLUDED_SOURCE_MARKER_7429\n");
    await runGit(repository.sourcePath, ["add", "marker.txt"]);
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
        networkEnabled: false,
        behavior: { outputFields: ["findings"] },
        instruction:
          "Read marker.txt from the included source repository. Return a successful RESEARCHER result whose researchArtifact.findings contains INCLUDED_SOURCE_MARKER_7429. Do not modify files or request helper calls or actions.",
      }));
      stage = "Core AgentResult validation";
      const result = validateAgentResult("researcher", raw);
      stage = "smoke-test semantic assertions";
      assert.equal(result.outcome, "success");
      assert.deepEqual(Object.keys(result.researchArtifact), ["findings"]);
      assert.match(JSON.stringify(result.researchArtifact.findings), /INCLUDED_SOURCE_MARKER_7429/);
      assert.equal(result.requestedCalls?.length ?? 0, 0);
      assert.equal(result.requestedActions?.length ?? 0, 0);
      assertGeminiIsolation(runner, repository.sourcePath, GEMINI_LIVE_READ_TOOLS);
      assert.equal(await gitStatus(repository.sourcePath), originalStatus);
      await assertNoSynaphexState(repository.sourcePath);
      await assertDriverCleaned(runner);
      console.log(`[gemini-live] validated agent=${result.agent} outcome=${result.outcome} tools=read-only`);
    } catch (error) {
      console.error(`[gemini-live] failed stage=${stage} diagnostic=${boundedGeminiDiagnostic(error)}`);
      throw error;
    } finally {
      await repository.cleanup();
    }
  },
);

function skipReason(): string {
  return enabled
    ? "set SYNAPHEX_GEMINI_LIVE_MODEL=<model>"
    : "set SYNAPHEX_GEMINI_LIVE_TEST=1 and SYNAPHEX_GEMINI_LIVE_MODEL=<model>";
}
