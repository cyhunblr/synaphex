import assert from "node:assert/strict";
import test from "node:test";
import { GeminiCliExecutionError } from "../src/domain/errors.js";
import { GeminiAgentResultEnvelopeDecoder } from "../src/providers/gemini-agent-result-envelope-decoder.js";

const decoder = new GeminiAgentResultEnvelopeDecoder();
const result = {
  agent: "researcher",
  outcome: "success",
  summary: "Gemini worked.",
  researchArtifact: { findings: { source: "official" } },
};

test("Gemini envelope decoder returns only the strict inner candidate", () => {
  assert.deepEqual(
    decoder.decode(JSON.stringify({ response: JSON.stringify(result), stats: { tokens: 1 }, error: null })),
    result,
  );
});

test("Gemini envelope decoder fails closed for malformed outer output", () => {
  for (const output of ["", "not json", "{} trailing", "[]", "null"]) {
    assert.throws(() => decoder.decode(output), failure("malformed_envelope"));
  }
});

test("Gemini envelope decoder rejects provider errors and missing responses", () => {
  assert.throws(
    () => decoder.decode(JSON.stringify({ response: null, error: { message: "failed" } })),
    failure("provider_error"),
  );
  for (const envelope of [{}, { response: null }, { response: "" }, { response: "  " }]) {
    assert.throws(
      () => decoder.decode(JSON.stringify(envelope)),
      failure("missing_response"),
    );
  }
});

test("Gemini envelope decoder never repairs or extracts model JSON", () => {
  for (const response of [
    `\`\`\`json\n${JSON.stringify(result)}\n\`\`\``,
    `Here is the result: ${JSON.stringify(result)}`,
    `${JSON.stringify(result)} trailing`,
    "{malformed",
  ]) {
    assert.throws(
      () => decoder.decode(JSON.stringify({ response, error: null })),
      failure("malformed_agent_json"),
    );
  }
});

function failure(reason: string) {
  return (error: unknown) =>
    error instanceof GeminiCliExecutionError &&
    error.code === "GEMINI_CLI_EXECUTION_FAILED" &&
    error.details?.reason === reason;
}
