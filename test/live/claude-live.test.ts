import assert from "node:assert/strict";
import test from "node:test";
import { validateAgentResult } from "../../src/core/agent-result-validator.js";
import { ClaudeCliAgentExecutor } from "../../src/providers/claude-cli-agent-executor.js";
import {
  ObservingClaudeRunner,
  assertClaudeIsolationArgs,
  assertClaudeRuntimeAvailable,
  assertNoSynaphexState,
  boundedClaudeDiagnostic,
  gitStatus,
  liveInput,
  optionValue,
  temporaryGitRepository,
} from "./claude-live-support.js";

const enabled = process.env.SYNAPHEX_CLAUDE_LIVE_TEST === "1";
const model = process.env.SYNAPHEX_CLAUDE_LIVE_MODEL?.trim() ?? "";

test(
  "live Claude CLI adapter returns a validated read-only RESEARCHER result",
  { skip: enabled && model.length > 0 ? false : skipReason() },
  async () => {
    await assertClaudeRuntimeAvailable();
    const repository = await temporaryGitRepository("synaphex-claude-live-");
    const runner = new ObservingClaudeRunner();
    let stage = "Claude process execution";
    try {
      const raw = await new ClaudeCliAgentExecutor({
        processRunner: runner,
        includeStderrDiagnostic: true,
      }).execute(
        liveInput({
          agent: "researcher",
          sourcePath: repository.sourcePath,
          model,
          networkEnabled: false,
          behavior: { outputFields: ["findings"] },
          instruction:
            "Return a successful RESEARCHER smoke result with researchArtifact.findings set to a short value saying the Claude live adapter worked. Do not modify files or request helper calls or actions.",
        }),
      );
      stage = "AgentResult runtime validation";
      const result = validateAgentResult("researcher", raw);
      assert.equal(result.outcome, "success");
      assert.deepEqual(Object.keys(result.researchArtifact), ["findings"]);
      assert.equal(result.requestedCalls?.length ?? 0, 0);
      assert.equal(result.requestedActions?.length ?? 0, 0);
      assert.ok(runner.claudeInput);
      assertClaudeIsolationArgs(runner.claudeInput.args);
      assert.deepEqual(optionValue(runner.claudeInput.args, "--tools").split(","), [
        "Read",
        "Glob",
        "Grep",
      ]);
      stage = "workspace safety validation";
      assert.equal(await gitStatus(repository.sourcePath), "");
      await assertNoSynaphexState(repository.sourcePath);
      console.log(
        `[claude-live] validated agent=${result.agent} outcome=${result.outcome} helperCalls=${result.requestedCalls?.length ?? 0}`,
      );
    } catch (error) {
      console.error(
        `[claude-live] failed stage=${stage} diagnostic=${boundedClaudeDiagnostic(error)}`,
      );
      throw error;
    } finally {
      await repository.cleanup();
    }
  },
);

function skipReason(): string {
  if (!enabled) {
    return "set SYNAPHEX_CLAUDE_LIVE_TEST=1 and SYNAPHEX_CLAUDE_LIVE_MODEL=<model>";
  }
  return "set SYNAPHEX_CLAUDE_LIVE_MODEL=<model>";
}
