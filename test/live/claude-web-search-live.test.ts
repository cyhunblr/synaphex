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

const enabled = process.env.SYNAPHEX_CLAUDE_WEB_SEARCH_LIVE_TEST === "1";
const model = process.env.SYNAPHEX_CLAUDE_LIVE_MODEL?.trim() ?? "";

test(
  "live Claude RESEARCHER uses hosted web tools without Bash",
  { skip: enabled && model.length > 0 ? false : skipReason() },
  async () => {
    await assertClaudeRuntimeAvailable();
    const repository = await temporaryGitRepository("synaphex-claude-search-live-");
    const runner = new ObservingClaudeRunner();
    let stage = "Claude hosted research execution";
    try {
      const raw = await new ClaudeCliAgentExecutor({
        processRunner: runner,
        includeStderrDiagnostic: true,
      }).execute(
        liveInput({
          agent: "researcher",
          sourcePath: repository.sourcePath,
          model,
          networkEnabled: true,
          behavior: { outputFields: ["findings"] },
          instruction:
            "Use WebSearch or WebFetch to read the current official OpenAI Codex Configuration Reference and report the documented top-level web_search modes plus the official URL in findings. Do not use Bash, modify files, or request helper calls or actions.",
        }),
      );
      stage = "AgentResult runtime validation";
      const result = validateAgentResult("researcher", raw);
      assert.equal(result.outcome, "success");
      assert.equal(typeof result.researchArtifact.findings, "string");
      assert.match(
        String(result.researchArtifact.findings),
        /developers\.openai\.com|learn\.chatgpt\.com/i,
      );
      assert.equal(result.requestedActions?.length ?? 0, 0);
      assert.ok(runner.claudeInput);
      assertClaudeIsolationArgs(runner.claudeInput.args);
      const tools = optionValue(runner.claudeInput.args, "--tools").split(",");
      assert.deepEqual(tools, ["Read", "Glob", "Grep", "WebSearch", "WebFetch"]);
      assert.equal(tools.includes("Bash"), false);
      stage = "workspace safety validation";
      assert.equal(await gitStatus(repository.sourcePath), "");
      await assertNoSynaphexState(repository.sourcePath);
      console.log(
        `[claude-web-search-live] validated agent=${result.agent} outcome=${result.outcome} tools=WebSearch,WebFetch`,
      );
    } catch (error) {
      console.error(
        `[claude-web-search-live] failed stage=${stage} diagnostic=${boundedClaudeDiagnostic(error)}`,
      );
      throw error;
    } finally {
      await repository.cleanup();
    }
  },
);

function skipReason(): string {
  if (!enabled) {
    return "set SYNAPHEX_CLAUDE_WEB_SEARCH_LIVE_TEST=1 and SYNAPHEX_CLAUDE_LIVE_MODEL=<model>";
  }
  return "set SYNAPHEX_CLAUDE_LIVE_MODEL=<model>";
}
