import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { validateAgentResult } from "../../src/core/agent-result-validator.js";
import { AntigravityCliAgentExecutor } from "../../src/providers/antigravity-cli-agent-executor.js";
import {
  ObservingAntigravityRunner,
  assertAntigravityInvocation,
  assertAntigravityRuntimeAvailable,
  assertNoSynaphexState,
  boundedAntigravityDiagnostic,
  gitStatus,
  liveInput,
  runGit,
  temporaryGitRepository,
} from "./antigravity-live-support.js";

const enabled = process.env.SYNAPHEX_ANTIGRAVITY_LIVE_TEST === "1";
const model = process.env.SYNAPHEX_ANTIGRAVITY_LIVE_MODEL?.trim() ?? "";

test(
  "live Antigravity CLI returns a validated read-only RESEARCHER result",
  { skip: enabled && model !== "" ? false : skipReason() },
  async () => {
    await assertAntigravityRuntimeAvailable();
    const repository = await temporaryGitRepository("synaphex-antigravity-live-");
    await writeFile(join(repository.sourcePath, "marker.txt"), "ANTIGRAVITY_INCLUDED_SOURCE_126\n");
    await runGit(repository.sourcePath, ["add", "marker.txt"]);
    const originalStatus = await gitStatus(repository.sourcePath);
    const runner = new ObservingAntigravityRunner();
    let stage = "Antigravity process/structured output";
    try {
      const raw = await new AntigravityCliAgentExecutor({
        processRunner: runner,
        includeStderrDiagnostic: true,
      }).execute(liveInput({
        agent: "researcher",
        sourcePath: repository.sourcePath,
        model,
        behavior: { outputFields: ["findings"] },
        instruction:
          "Read marker.txt. Return a successful RESEARCHER result whose researchArtifact.findings contains ANTIGRAVITY_INCLUDED_SOURCE_126. Do not modify files or request helper calls or actions.",
      }));
      stage = "Core AgentResult validation";
      const result = validateAgentResult("researcher", raw);
      stage = "read-only smoke assertions";
      assert.equal(result.outcome, "success");
      assert.match(JSON.stringify(result.researchArtifact.findings), /ANTIGRAVITY_INCLUDED_SOURCE_126/);
      assert.equal(result.requestedCalls?.length ?? 0, 0);
      assert.equal(result.requestedActions?.length ?? 0, 0);
      assertAntigravityInvocation(runner, repository.sourcePath, "plan");
      assert.equal(await gitStatus(repository.sourcePath), originalStatus);
      await assertNoSynaphexState(repository.sourcePath);
      console.log(`[antigravity-live] validated agent=${result.agent} outcome=${result.outcome} mode=plan sandbox=true`);
    } catch (error) {
      console.error(`[antigravity-live] failed stage=${stage} diagnostic=${boundedAntigravityDiagnostic(error)}`);
      throw error;
    } finally {
      await repository.cleanup();
    }
  },
);

function skipReason(): string {
  return enabled
    ? "set SYNAPHEX_ANTIGRAVITY_LIVE_MODEL=<model>"
    : "set SYNAPHEX_ANTIGRAVITY_LIVE_TEST=1 and SYNAPHEX_ANTIGRAVITY_LIVE_MODEL=<model>";
}
