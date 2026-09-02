import assert from "node:assert/strict";
import test from "node:test";
import { AgentResultJsonSchemaBuilder } from "../src/providers/agent-result-json-schema-builder.js";
import { syntheticAgentContext } from "./fixtures/synthetic-agent-context.js";

type Schema = Record<string, unknown>;

const builder = new AgentResultJsonSchemaBuilder();

test("Coder schema fixes the discriminator and restricts configured work fields", () => {
  const schema = builder.build(
    syntheticAgentContext("coder", "/source", {
      outputFields: ["custom_record", "optional_detail"],
    }),
  ) as Schema;
  const properties = schema.properties as Record<string, Schema>;
  const workRecord = properties.workRecord!;

  assert.equal((properties.agent as Schema).const, "coder");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(workRecord.properties as object), [
    "custom_record",
    "optional_detail",
  ]);
  assert.deepEqual(workRecord.required, []);
  assert.equal(workRecord.additionalProperties, false);
  assert.equal("report" in properties, false);
  assert.equal("reviewStatus" in properties, false);
});

test("Reviewer schema keeps lifecycle metadata outside configured report payload", () => {
  const schema = builder.build(
    syntheticAgentContext("reviewer", "/source", {
      outputFields: ["custom_report"],
    }),
  ) as Schema;
  const variants = schema.oneOf as Schema[];

  assert.deepEqual(
    variants.map((variant) =>
      ((variant.properties as Record<string, Schema>).reviewStatus as Schema)
        .const,
    ),
    ["PASS", "PASS_WITH_WARNINGS", "FAIL"],
  );
  const warningsVariant = variants[1]!;
  const warningProperties = warningsVariant.properties as Record<string, Schema>;
  assert.equal((warningProperties.warnings as Schema).minItems, 1);
  assert.ok((warningsVariant.required as string[]).includes("warnings"));
  const report = warningProperties.report as Schema;
  assert.deepEqual(Object.keys(report.properties as object), ["custom_report"]);
  assert.equal("warnings" in (report.properties as object), false);
  const failureProperties = variants[2]!.properties as Record<string, Schema>;
  assert.deepEqual((failureProperties.failureOrigin as Schema).enum, [
    "implementation",
    "plan",
    "mixed",
  ]);
});

test("Planner and Examiner schemas preserve their immutable authority boundaries", () => {
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

test("Researcher custom behavior fields constrain its artifact payload", () => {
  const schema = builder.build(
    syntheticAgentContext("researcher", "/source", {
      outputFields: ["evidence_matrix"],
    }),
  ) as Schema;
  const properties = schema.properties as Record<string, Schema>;
  const payload = properties.researchArtifact!;

  assert.equal((properties.agent as Schema).const, "researcher");
  assert.deepEqual(Object.keys(payload.properties as object), [
    "evidence_matrix",
  ]);
  assert.equal(payload.additionalProperties, false);
  assert.equal("workRecord" in properties, false);
});
