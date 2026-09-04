import assert from "node:assert/strict";
import test from "node:test";
import { validateAgentResult } from "../src/core/agent-result-validator.js";
import { AntigravityCliExecutionError } from "../src/domain/errors.js";
import { AntigravityAgentResultEnvelopeDecoder } from "../src/providers/antigravity-agent-result-envelope-decoder.js";

const decoder = new AntigravityAgentResultEnvelopeDecoder();
const researcher = {
  agent: "researcher",
  outcome: "success",
  summary: "Antigravity worked.",
  researchArtifact: { findings: "done" },
};

test("Antigravity decoder returns structured_output without provider metadata", () => {
  assert.deepEqual(
    decoder.decode(JSON.stringify({
      conversation_id: "provider-only",
      status: "SUCCESS",
      response: JSON.stringify(researcher),
      structured_output: researcher,
      json_schema: { type: "object" },
      usage: { total_tokens: 42 },
    })),
    researcher,
  );
});

test("Antigravity decoder rejects malformed outer output", () => {
  for (const output of ["", "not json", "{} trailing", "[]", "null", "{}"]) {
    assert.throws(() => decoder.decode(output), failure("malformed_output"));
  }
});

test("Antigravity decoder rejects every non-success or provider-error envelope", () => {
  for (const envelope of [
    { status: "ERROR", error: "failed", structured_output: researcher },
    { status: "CANCELED", structured_output: researcher },
    { status: "INTERRUPTED", structured_output: researcher },
    { status: "INVALID", structured_output: researcher },
    { status: "WAITING", structured_output: researcher },
    { status: "RUNNING", structured_output: researcher },
    { status: "SUCCESS", error: "unexpected", structured_output: researcher },
  ]) {
    assert.throws(
      () => decoder.decode(JSON.stringify(envelope)),
      failure("provider_error"),
    );
  }
});

test("Antigravity decoder requires non-null native structured output", () => {
  for (const envelope of [
    { status: "SUCCESS" },
    { status: "SUCCESS", structured_output: null },
  ]) {
    assert.throws(
      () => decoder.decode(JSON.stringify(envelope)),
      failure("missing_structured_output"),
    );
  }
});

test("Core validation remains authoritative after Antigravity decoding", () => {
  const wrongRole = {
    agent: "coder",
    outcome: "success",
    summary: "wrong",
    workRecord: {},
  };
  const raw = decoder.decode(JSON.stringify({
    status: "SUCCESS",
    structured_output: wrongRole,
  }));
  assert.throws(() => validateAgentResult("researcher", raw), {
    code: "INVALID_AGENT_RESULT",
  });
});

function failure(reason: string) {
  return (error: unknown) =>
    error instanceof AntigravityCliExecutionError &&
    error.code === "ANTIGRAVITY_CLI_EXECUTION_FAILED" &&
    error.details?.reason === reason;
}
