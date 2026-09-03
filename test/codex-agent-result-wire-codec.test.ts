import assert from "node:assert/strict";
import test from "node:test";
import { validateAgentResult } from "../src/core/agent-result-validator.js";
import { CodexCliExecutionError } from "../src/domain/errors.js";
import { CodexAgentResultWireCodec } from "../src/providers/codex-agent-result-wire-codec.js";
import { syntheticAgentContext } from "./fixtures/synthetic-agent-context.js";

const codec = new CodexAgentResultWireCodec();

test("nullable common and handoff wire values normalize to omitted Core fields", () => {
  const context = syntheticAgentContext("researcher", "/source", {
    outputFields: ["findings"],
  });
  const decoded = codec.decode(context, {
    ...commonWire("researcher"),
    requestedCalls: [
      {
        target: "questioner",
        purpose: "clarification",
        handoff: {
          caller: "researcher",
          target: "questioner",
          purpose: "clarification",
          summary: "Clarify the evidence boundary.",
          question: null,
          artifactRefs: null,
        },
      },
    ],
    payloadJson: JSON.stringify({ findings: "Wire codec worked." }),
  });

  const validated = validateAgentResult("researcher", decoded);
  assert.equal("warnings" in validated, false);
  assert.equal("question" in validated.requestedCalls![0]!.handoff, false);
  assert.equal("artifactRefs" in validated.requestedCalls![0]!.handoff, false);
  assert.deepEqual(validated.researchArtifact, {
    findings: "Wire codec worked.",
  });
});

test("opaque JSON objects with nested arrays and objects round-trip without dropping fields", () => {
  const context = syntheticAgentContext("researcher", "/source", {
    outputFields: ["findings"],
  });
  const payload = {
    findings: {
      sources: [
        { title: "First", confidence: 0.9 },
        { title: "Second", flags: [true, null, 3] },
      ],
      metadata: { complete: true },
    },
    unconfigured: { preservedForCoreRejection: true },
  };
  const decoded = codec.decode(context, {
    ...commonWire("researcher"),
    payloadJson: JSON.stringify(payload),
  });

  const validated = validateAgentResult("researcher", decoded);
  assert.deepEqual(validated.researchArtifact, payload);
  assert.ok("unconfigured" in validated.researchArtifact);
});

test("malformed opaque JSON is a typed provider-output failure", () => {
  const context = syntheticAgentContext("coder", "/source");
  assert.throws(
    () =>
      codec.decode(context, {
        ...commonWire("coder"),
        payloadJson: "{not-json",
      }),
    (error: unknown) =>
      error instanceof CodexCliExecutionError &&
      error.code === "CODEX_CLI_EXECUTION_FAILED" &&
      error.details?.reason === "malformed_result" &&
      error.details.phase === "wire_decode" &&
      error.details.field === "payloadJson",
  );
});

test("Questioner opaque context round-trips and null means semantic omission", () => {
  const context = syntheticAgentContext("questioner", "/source");
  const withContext = validateAgentResult(
    "questioner",
    codec.decode(context, {
      ...commonWire("questioner", "needs_user"),
      state: "pending_question",
      question: "Which target should be used?",
      workingContextJson: JSON.stringify({ explored: ["a", { b: true }] }),
    }),
  );
  assert.deepEqual(withContext.workingContext, {
    explored: ["a", { b: true }],
  });

  const withoutContext = validateAgentResult(
    "questioner",
    codec.decode(context, {
      ...commonWire("questioner"),
      state: "context_complete",
      question: null,
      workingContextJson: null,
    }),
  );
  assert.equal("question" in withoutContext, false);
  assert.equal("workingContext" in withoutContext, false);
});

test("Reviewer lifecycle metadata stays typed while only report payload uses JSON text", () => {
  const context = syntheticAgentContext("reviewer", "/source", {
    outputFields: ["custom_field"],
  });
  const decoded = codec.decode(context, {
    ...commonWire("reviewer"),
    warnings: ["One lifecycle warning."],
    reviewStatus: "FAIL",
    failureOrigin: "implementation",
    payloadJson: JSON.stringify({ custom_field: { defects: ["x"] } }),
  });

  const validated = validateAgentResult("reviewer", decoded);
  assert.equal(validated.reviewStatus, "FAIL");
  assert.equal(validated.failureOrigin, "implementation");
  assert.deepEqual(validated.warnings, ["One lifecycle warning."]);
  assert.deepEqual(validated.report, {
    custom_field: { defects: ["x"] },
  });
});

test("unexpected wire fields fail instead of being silently dropped", () => {
  const context = syntheticAgentContext("researcher", "/source");
  assert.throws(
    () =>
      codec.decode(context, {
        ...commonWire("researcher"),
        payloadJson: "{}",
        unexpected: true,
      }),
    (error: unknown) =>
      error instanceof CodexCliExecutionError &&
      error.details?.reason === "malformed_result" &&
      error.details.phase === "wire_decode",
  );
});

function commonWire(
  agent: string,
  outcome = "success",
): Record<string, unknown> {
  return {
    agent,
    outcome,
    summary: "Synthetic wire result.",
    warnings: null,
    requestedCalls: null,
  };
}
