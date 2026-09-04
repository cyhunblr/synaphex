import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_NAMES } from "../src/domain/agent.js";
import { ClaudeAgentResultJsonSchemaBuilder } from "../src/providers/claude-agent-result-json-schema-builder.js";
import { syntheticAgentContext } from "./fixtures/synthetic-agent-context.js";

type Schema = Record<string, unknown>;

const builder = new ClaudeAgentResultJsonSchemaBuilder();

test("Claude schemas cover every logical agent with a fixed discriminator", () => {
  for (const agent of AGENT_NAMES) {
    const schema = builder.build(
      syntheticAgentContext(agent, "/source"),
    ) as Schema;
    const properties = schema.properties as Record<string, Schema>;
    assert.equal(properties.agent?.const, agent);
    assert.equal(schema.additionalProperties, false);
    assert.ok((schema.required as string[]).includes("agent"));
    assert.ok((schema.required as string[]).includes("outcome"));
    assert.ok((schema.required as string[]).includes("summary"));
  }
});

test("Claude common schema supports structured helper calls and host actions", () => {
  const schema = builder.build(
    syntheticAgentContext("researcher", "/source"),
  ) as Schema;
  const properties = schema.properties as Record<string, Schema>;
  const calls = properties.requestedCalls?.items as Schema;
  const callProperties = calls.properties as Record<string, Schema>;
  const handoff = callProperties.handoff;
  const handoffProperties = handoff?.properties as Record<string, Schema>;
  assert.equal(handoffProperties.caller?.const, "researcher");
  assert.ok(Array.isArray(callProperties.target?.enum));
  assert.ok(Array.isArray(callProperties.purpose?.enum));
  const actions = properties.requestedActions?.items as Schema;
  const actionProperties = actions.properties as Record<string, Schema>;
  assert.deepEqual(actionProperties.action?.enum, ["network", "git_push", "ci"]);
});

test("Claude configured payloads preserve arbitrary JSON values but reject unconfigured fields", () => {
  const schema = builder.build(
    syntheticAgentContext("researcher", "/source", {
      outputFields: ["findings", "evidence_matrix"],
    }),
  ) as Schema;
  const properties = schema.properties as Record<string, Schema>;
  const payload = properties.researchArtifact;
  assert.equal(payload?.type, "object");
  assert.equal(payload?.additionalProperties, false);
  assert.deepEqual(Object.keys(payload?.properties as object).sort(), [
    "evidence_matrix",
    "findings",
  ]);
  assert.deepEqual(payload?.required, []);
  assert.deepEqual(
    (payload?.properties as Record<string, unknown>).findings,
    {},
  );
});

test("Claude Reviewer schema keeps lifecycle authority outside configurable report payload", () => {
  const schema = builder.build(
    syntheticAgentContext("reviewer", "/source", {
      outputFields: ["custom_report"],
    }),
  ) as Schema;
  const properties = schema.properties as Record<string, Schema>;
  assert.deepEqual(properties.reviewStatus?.enum, [
    "PASS",
    "PASS_WITH_WARNINGS",
    "FAIL",
  ]);
  assert.deepEqual(properties.failureOrigin?.enum, [
    "implementation",
    "plan",
    "mixed",
  ]);
  assert.deepEqual(
    Object.keys(properties.report?.properties as object),
    ["custom_report"],
  );
  assert.ok(Array.isArray(schema.allOf));
  assert.match(JSON.stringify(schema.allOf), /PASS_WITH_WARNINGS/);
  assert.match(JSON.stringify(schema.allOf), /minItems/);
  assert.match(JSON.stringify(schema.allOf), /failureOrigin/);
});

test("Claude Planner and Examiner schemas preserve workflow authority", () => {
  const planner = JSON.stringify(
    builder.build(syntheticAgentContext("planner", "/source")),
  );
  assert.doesNotMatch(planner, /"accepted"/);
  assert.match(planner, /plan_still_valid/);
  assert.match(planner, /revision_required/);

  const examiner = JSON.stringify(
    builder.build(syntheticAgentContext("examiner", "/source")),
  );
  for (const intent of [
    "none",
    "replace_project",
    "replace_task",
    "clear_project",
    "clear_task",
  ]) {
    assert.match(examiner, new RegExp(intent));
  }
  assert.doesNotMatch(examiner, /filesystemPath|sourcePath|filePath/);
});
