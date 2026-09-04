import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
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

const enabled = process.env.SYNAPHEX_ANTIGRAVITY_CODER_LIVE_TEST === "1";
const model = process.env.SYNAPHEX_ANTIGRAVITY_LIVE_MODEL?.trim() ?? "";

test(
  "live Antigravity CODER performs one sandboxed workspace edit",
  { skip: enabled && model !== "" ? false : skipReason() },
  async () => {
    await assertAntigravityRuntimeAvailable();
    const repository = await temporaryGitRepository("synaphex-antigravity-coder-live-");
    const sourceFile = join(repository.sourcePath, "message.txt");
    await writeFile(sourceFile, "before\n");
    await runGit(repository.sourcePath, ["add", "message.txt"]);
    const runner = new ObservingAntigravityRunner();
    let stage = "Antigravity sandboxed edit";
    try {
      const raw = await new AntigravityCliAgentExecutor({
        processRunner: runner,
        includeStderrDiagnostic: true,
      }).execute(liveInput({
        agent: "coder",
        sourcePath: repository.sourcePath,
        model,
        behavior: { outputFields: ["files_changed"] },
        instruction:
          "Change message.txt from exactly 'before' to exactly 'after' with a trailing newline. Make no other edits. Do not run build/test/shell commands, use network, push Git, trigger CI, or request helper calls/actions. Return success with workRecord.files_changed=['message.txt'].",
      }));
      stage = "Core AgentResult validation";
      const result = validateAgentResult("coder", raw);
      stage = "workspace edit assertions";
      assert.equal(result.outcome, "success");
      assert.deepEqual(result.workRecord.files_changed, ["message.txt"]);
      assert.equal(result.requestedCalls?.length ?? 0, 0);
      assert.equal(result.requestedActions?.length ?? 0, 0);
      assert.equal(await readFile(sourceFile, "utf8"), "after\n");
      assert.match(await gitStatus(repository.sourcePath), /^AM message\.txt\n$/);
      assertAntigravityInvocation(runner, repository.sourcePath, "accept-edits");
      await assertNoSynaphexState(repository.sourcePath);
      console.log(`[antigravity-coder-live] validated agent=${result.agent} outcome=${result.outcome} changed=message.txt mode=accept-edits sandbox=true`);
    } catch (error) {
      console.error(`[antigravity-coder-live] failed stage=${stage} diagnostic=${boundedAntigravityDiagnostic(error)}`);
      throw error;
    } finally {
      await repository.cleanup();
    }
  },
);

function skipReason(): string {
  return enabled
    ? "set SYNAPHEX_ANTIGRAVITY_LIVE_MODEL=<model>"
    : "set SYNAPHEX_ANTIGRAVITY_CODER_LIVE_TEST=1 and SYNAPHEX_ANTIGRAVITY_LIVE_MODEL=<model>";
}
