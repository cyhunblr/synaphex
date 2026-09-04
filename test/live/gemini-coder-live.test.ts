import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { validateAgentResult } from "../../src/core/agent-result-validator.js";
import { GeminiCliAgentExecutor } from "../../src/providers/gemini-cli-agent-executor.js";
import {
  GEMINI_LIVE_CODER_TOOLS,
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

const enabled = process.env.SYNAPHEX_GEMINI_CODER_LIVE_TEST === "1";
const model = process.env.SYNAPHEX_GEMINI_LIVE_MODEL?.trim() ?? "";

test(
  "live Gemini CODER edits the included workspace without shell or network",
  { skip: enabled && model !== "" ? false : skipReason() },
  async () => {
    await assertGeminiRuntimeAvailable();
    const repository = await temporaryGitRepository("synaphex-gemini-coder-live-");
    const sourceFile = join(repository.sourcePath, "message.txt");
    await writeFile(sourceFile, "before\n");
    await runGit(repository.sourcePath, ["add", "message.txt"]);
    const runner = new ObservingGeminiRunner();
    let stage = "Gemini included-workspace edit";
    try {
      const raw = await new GeminiCliAgentExecutor({
        processRunner: runner,
        includeStderrDiagnostic: true,
      }).execute(liveInput({
        agent: "coder",
        sourcePath: repository.sourcePath,
        model,
        networkEnabled: false,
        behavior: { outputFields: ["files_changed"] },
        instruction:
          "In the included source repository, change message.txt from exactly 'before' to exactly 'after' with a trailing newline. Make no other edits. Use only write_file or replace; shell and network are unavailable. Do not request git push, CI, helper calls, or actions. Return a successful CODER result with workRecord.files_changed=['message.txt'].",
      }));
      stage = "Core AgentResult validation";
      const result = validateAgentResult("coder", raw);
      stage = "smoke-test semantic assertions";
      assert.equal(result.outcome, "success");
      assert.deepEqual(result.workRecord.files_changed, ["message.txt"]);
      assert.equal(result.requestedCalls?.length ?? 0, 0);
      assert.equal(result.requestedActions?.length ?? 0, 0);
      assert.equal(await readFile(sourceFile, "utf8"), "after\n");
      assert.match(await gitStatus(repository.sourcePath), /^AM message\.txt\n$/);
      assertGeminiIsolation(runner, repository.sourcePath, GEMINI_LIVE_CODER_TOOLS);
      assert.equal(runner.policy.includes("run_shell_command"), false);
      assert.equal(runner.policy.includes("google_web_search"), false);
      assert.equal(runner.policy.includes("web_fetch"), false);
      await assertNoSynaphexState(repository.sourcePath);
      await assertDriverCleaned(runner);
      console.log(`[gemini-coder-live] validated agent=${result.agent} outcome=${result.outcome} changed=message.txt shell=false network=false`);
    } catch (error) {
      console.error(`[gemini-coder-live] failed stage=${stage} diagnostic=${boundedGeminiDiagnostic(error)}`);
      throw error;
    } finally {
      await repository.cleanup();
    }
  },
);

function skipReason(): string {
  return enabled
    ? "set SYNAPHEX_GEMINI_LIVE_MODEL=<model>"
    : "set SYNAPHEX_GEMINI_CODER_LIVE_TEST=1 and SYNAPHEX_GEMINI_LIVE_MODEL=<model>";
}
