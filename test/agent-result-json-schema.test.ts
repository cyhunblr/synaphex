import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_NAMES } from "../src/domain/action.js";
import { AGENT_NAMES } from "../src/domain/agent.js";
import { AgentResultJsonSchemaBuilder } from "../src/providers/agent-result-json-schema-builder.js";
import { syntheticAgentContext } from "./fixtures/synthetic-agent-context.js";

type Schema = Record<string, unknown>;

const builder = new AgentResultJsonSchemaBuilder();

test("every Codex wire object is closed and requires every declared property", () => {
  for (const agent of AGENT_NAMES) {
    const schema = builder.build(
      syntheticAgentContext(agent, "/source"),
    ) as Schema;
    assertStrictObjects(schema, agent);
    const serialized = JSON.stringify(schema);
    assert.doesNotMatch(serialized, /"oneOf"|"anyOf"/);
    assert.doesNotMatch(serialized, /"additionalProperties":true/);
  }
});

test("optional Core fields are required nullable fields on the Codex wire", () => {
  const researcher = builder.build(
    syntheticAgentContext("researcher", "/source", {
      outputFields: ["findings"],
    }),
  ) as Schema;
  const researcherProperties = researcher.properties as Record<string, Schema>;

  assert.deepEqual(researcherProperties.warnings?.type, ["array", "null"]);
  assert.deepEqual(researcherProperties.requestedCalls?.type, [
    "array",
    "null",
  ]);
  assert.deepEqual(researcherProperties.requestedActions?.type, [
    "array",
    "null",
  ]);
  assert.ok((researcher.required as string[]).includes("warnings"));
  assert.ok((researcher.required as string[]).includes("requestedCalls"));
  assert.ok((researcher.required as string[]).includes("requestedActions"));

  const requestedAction = researcherProperties.requestedActions
    ?.items as Schema;
  const actionProperties = requestedAction.properties as Record<string, Schema>;
  assert.deepEqual(actionProperties.action?.enum, ACTION_NAMES);

  const requestedCall = researcherProperties.requestedCalls?.items as Schema;
  const callProperties = requestedCall.properties as Record<string, Schema>;
  const handoff = callProperties.handoff!;
  const handoffProperties = handoff.properties as Record<string, Schema>;
  assert.deepEqual(handoffProperties.question?.type, ["string", "null"]);
  assert.deepEqual(handoffProperties.artifactRefs?.type, ["array", "null"]);

  const planner = builder.build(
    syntheticAgentContext("planner", "/source"),
  ) as Schema;
  const plannerProperties = planner.properties as Record<string, Schema>;
  assert.deepEqual(plannerProperties.draftPlanMarkdown?.type, [
    "string",
    "null",
  ]);
  assert.deepEqual(plannerProperties.consultation?.type, ["object", "null"]);
});

test("opaque configured payloads use JSON text instead of dynamic object schemas", () => {
  const schema = builder.build(
    syntheticAgentContext("researcher", "/source", {
      outputFields: ["findings", "evidence_matrix"],
    }),
  ) as Schema;
  const properties = schema.properties as Record<string, Schema>;

  assert.equal("researchArtifact" in properties, false);
  assert.equal(properties.payloadJson?.type, "string");
  assert.match(
    String(properties.payloadJson?.description),
    /findings, evidence_matrix/,
  );
  assert.equal("properties" in properties.payloadJson!, false);
});

test("Reviewer lifecycle fields remain typed outside its opaque report payload", () => {
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
  assert.deepEqual(properties.failureOrigin?.type, ["string", "null"]);
  assert.deepEqual(properties.failureOrigin?.enum, [
    "implementation",
    "plan",
    "mixed",
    null,
  ]);
  assert.equal(properties.payloadJson?.type, "string");
  assert.equal("reviewStatus" in properties.payloadJson!, false);
});

test("Planner and Examiner wire schemas preserve immutable authority boundaries", () => {
  const planner = builder.build(
    syntheticAgentContext("planner", "/source"),
  ) as Schema;
  const plannerText = JSON.stringify(planner);
  assert.doesNotMatch(plannerText, /"accepted"/);
  assert.match(plannerText, /plan_still_valid/);
  assert.match(plannerText, /revision_required/);

  const examiner = builder.build(
    syntheticAgentContext("examiner", "/source"),
  ) as Schema;
  const examinerText = JSON.stringify(examiner);
  for (const intent of [
    "none",
    "replace_project",
    "replace_task",
    "clear_project",
    "clear_task",
  ]) {
    assert.match(examinerText, new RegExp(intent));
  }
  assert.doesNotMatch(examinerText, /filesystemPath|sourcePath|filePath/);
});

function assertStrictObjects(schema: Schema, path: string): void {
  const type = schema.type;
  const isObject =
    type === "object" ||
    (Array.isArray(type) && type.includes("object"));
  if (isObject) {
    assert.equal(schema.additionalProperties, false, path);
    const properties = schema.properties as Record<string, Schema>;
    assert.ok(properties !== undefined, path);
    assert.deepEqual(
      [...(schema.required as string[])].sort(),
      Object.keys(properties).sort(),
      path,
    );
    for (const [key, child] of Object.entries(properties)) {
      assertStrictObjects(child, `${path}.${key}`);
    }
  }
  if (isSchema(schema.items)) {
    assertStrictObjects(schema.items, `${path}[]`);
  }
}

function isSchema(value: unknown): value is Schema {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
