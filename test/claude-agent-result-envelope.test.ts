import assert from "node:assert/strict";
import test from "node:test";
import { validateAgentResult } from "../src/core/agent-result-validator.js";
import { ClaudeCliExecutionError } from "../src/domain/errors.js";
import { ClaudeAgentResultEnvelopeDecoder } from "../src/providers/claude-agent-result-envelope-decoder.js";

const decoder = new ClaudeAgentResultEnvelopeDecoder();

test("Claude envelope decoder returns only structured_output for Core validation", () => {
  const structured = {
    agent: "researcher",
    outcome: "success",
    summary: "Research complete.",
    researchArtifact: {
      findings: { nested: [true, null, 3] },
    },
  };
  const decoded = decoder.decode(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      session_id: "provider-owned-session",
      usage: { input_tokens: 10 },
      result: "free-form text is not authoritative",
      structured_output: structured,
    }),
  );

  assert.deepEqual(validateAgentResult("researcher", decoded), structured);
  assert.equal("session_id" in (decoded as object), false);
  assert.equal("usage" in (decoded as object), false);
});

test("Claude envelope decoder rejects malformed outer JSON", () => {
  assert.throws(
    () => decoder.decode("{not-json"),
    failure("malformed_output"),
  );
  assert.throws(
    () => decoder.decode("[]"),
    failure("malformed_output"),
  );
});

test("Claude envelope decoder requires structured_output", () => {
  assert.throws(
    () => decoder.decode(JSON.stringify({ type: "result", result: "text" })),
    failure("missing_structured_output"),
  );
  assert.throws(
    () => decoder.decode(JSON.stringify({ structured_output: null })),
    failure("missing_structured_output"),
  );
});

test("Claude envelope decoder rejects provider error envelopes", () => {
  assert.throws(
    () =>
      decoder.decode(
        JSON.stringify({
          type: "result",
          subtype: "error_max_turns",
          is_error: true,
          structured_output: { ignored: true },
        }),
      ),
    failure("structured_output_error"),
  );
});

function failure(reason: string) {
  return (error: unknown) =>
    error instanceof ClaudeCliExecutionError &&
    error.code === "CLAUDE_CLI_EXECUTION_FAILED" &&
    error.details?.reason === reason;
}
