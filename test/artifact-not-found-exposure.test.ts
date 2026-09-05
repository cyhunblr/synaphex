import assert from "node:assert/strict";
import test from "node:test";
import {
  MCP_EXPOSED_ERROR_CODES,
  toMcpToolFailure,
} from "../src/mcp/mcp-error-mapping.js";
import {
  ArtifactNotFoundError,
  InvalidAgentHandoffError,
  MemoryMutationLockTimeoutError,
} from "../src/domain/errors.js";
import { ARTIFACT_ID_PATTERN } from "../src/domain/artifact.js";

/**
 * A helper handoff may cite an artifact whose SHAPE is valid but which does
 * not exist: existence is only knowable against persisted state, so the JSON
 * schema cannot rule it out. That refusal is expected and actionable, yet it
 * used to reach hosts as INTERNAL_ERROR, leaving a real cause undiagnosable.
 */

const WELL_FORMED_BUT_ABSENT = `artifact_${"c7e72d96c96e46719959066f979f9a69"}` as const;

test("a well-formed but nonexistent artifact keeps its public identity", () => {
  // Shape validation cannot catch this: the id is canonical.
  assert.ok(new RegExp(ARTIFACT_ID_PATTERN).test(WELL_FORMED_BUT_ABSENT));

  const failure = toMcpToolFailure(
    new ArtifactNotFoundError(WELL_FORMED_BUT_ABSENT),
  );

  assert.equal(failure.code, "ARTIFACT_NOT_FOUND");
  assert.notEqual(failure.code, "INTERNAL_ERROR");
  assert.equal(failure.message, "The referenced artifact was not found.");
  // The message must not echo storage detail back to the client.
  assert.doesNotMatch(failure.message, /artifact_/);
  assert.doesNotMatch(failure.message, /\//);
});

test("ARTIFACT_NOT_FOUND is on the public allowlist exactly once", () => {
  const occurrences = MCP_EXPOSED_ERROR_CODES.filter(
    (code) => code === "ARTIFACT_NOT_FOUND",
  );
  assert.equal(occurrences.length, 1);
});

test("unexpected failures are still collapsed to INTERNAL_ERROR", () => {
  // The allowlist stays an allowlist. Exposing one expected refusal must not
  // turn the boundary into pass-through for arbitrary internal errors.
  for (const error of [
    new Error("provider stderr with ANTHROPIC_API_KEY=sk-secret"),
    new MemoryMutationLockTimeoutError(),
    new InvalidAgentHandoffError("handoff must be an object"),
  ]) {
    const failure = toMcpToolFailure(error);
    assert.equal(failure.code, "INTERNAL_ERROR", String(error));
    assert.doesNotMatch(failure.message, /sk-secret/);
  }
});
