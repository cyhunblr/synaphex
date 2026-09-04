import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { validateAgentResult } from "../../src/core/agent-result-validator.js";
import { SpawnProcessRunner } from "../../src/infrastructure/process-runner.js";
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

const enabled = process.env.SYNAPHEX_CLAUDE_CODER_LIVE_TEST === "1";
const model = process.env.SYNAPHEX_CLAUDE_LIVE_MODEL?.trim() ?? "";

test(
  "live Claude CODER performs one sandboxed workspace edit without network",
  { skip: enabled && model.length > 0 ? false : skipReason() },
  async () => {
    await assertClaudeRuntimeAvailable();
    const repository = await temporaryGitRepository("synaphex-claude-coder-live-");
    const sourceFile = join(repository.sourcePath, "message.txt");
    await writeFile(sourceFile, "before\n");
    await new SpawnProcessRunner().run({
      executable: "git",
      args: ["add", "message.txt"],
      stdin: "",
      cwd: repository.sourcePath,
      timeoutMs: 10_000,
      terminationGraceMs: 1_000,
    });
    const runner = new ObservingClaudeRunner();
    let stage = "Claude sandboxed edit execution";
    try {
      const raw = await new ClaudeCliAgentExecutor({
        processRunner: runner,
        includeStderrDiagnostic: true,
      }).execute(
        liveInput({
          agent: "coder",
          sourcePath: repository.sourcePath,
          model,
          networkEnabled: false,
          behavior: { outputFields: ["files_changed"] },
          instruction:
            "Change message.txt from exactly 'before' to exactly 'after' with a trailing newline. Make no other file changes. Do not use external network, git push, CI, helper calls, or requested actions. Return a successful CODER result with files_changed=['message.txt'].",
        }),
      );
      stage = "AgentResult runtime validation";
      const result = validateAgentResult("coder", raw);
      assert.equal(result.outcome, "success");
      assert.deepEqual(result.workRecord.files_changed, ["message.txt"]);
      assert.equal(result.requestedActions?.length ?? 0, 0);
      assert.equal(await readFile(sourceFile, "utf8"), "after\n");
      assert.match(await gitStatus(repository.sourcePath), /^AM message\.txt\n$/);
      assert.ok(runner.claudeInput);
      assertClaudeIsolationArgs(runner.claudeInput.args);
      const tools = optionValue(runner.claudeInput.args, "--tools").split(",");
      assert.ok(tools.includes("Edit"));
      assert.ok(tools.includes("Write"));
      assert.ok(tools.includes("Bash"));
      assert.equal(tools.includes("WebSearch"), false);
      assert.equal(tools.includes("WebFetch"), false);
      const settings = JSON.parse(optionValue(runner.claudeInput.args, "--settings"));
      assert.deepEqual(settings.sandbox.network.allowedDomains, []);
      assert.equal(settings.sandbox.network.strictAllowlist, true);
      assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
      await assertNoSynaphexState(repository.sourcePath);
      console.log(
        `[claude-coder-live] validated agent=${result.agent} outcome=${result.outcome} changed=message.txt network=false`,
      );
    } catch (error) {
      console.error(
        `[claude-coder-live] failed stage=${stage} diagnostic=${boundedClaudeDiagnostic(error)}`,
      );
      throw error;
    } finally {
      await repository.cleanup();
    }
  },
);

function skipReason(): string {
  if (!enabled) {
    return "set SYNAPHEX_CLAUDE_CODER_LIVE_TEST=1 and SYNAPHEX_CLAUDE_LIVE_MODEL=<model>";
  }
  return "set SYNAPHEX_CLAUDE_LIVE_MODEL=<model>";
}
