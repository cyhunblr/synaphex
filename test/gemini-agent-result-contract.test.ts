import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_NAMES } from "../src/domain/agent.js";
import { GeminiAgentResultContractSerializer } from "../src/providers/gemini-agent-result-contract-serializer.js";
import { syntheticAgentContext } from "./fixtures/synthetic-agent-context.js";

test("Gemini result contracts document only the expected discriminator for every role", () => {
  const serializer = new GeminiAgentResultContractSerializer();
  for (const agent of AGENT_NAMES) {
    const output = serializer.serialize(syntheticAgentContext(agent, "/tmp/source"));
    assert.match(output, /one_raw_json_object/);
    assert.match(output, new RegExp(`"expectedAgent": "${agent}"`));
    assert.match(output, new RegExp(`"const": "${agent}"`));
    for (const other of AGENT_NAMES.filter((candidate) => candidate !== agent)) {
      assert.doesNotMatch(output, new RegExp(`"expectedAgent": "${other}"`));
    }
    assert.match(output, /requestedCalls/);
    assert.match(output, /requestedActions/);
    assert.match(output, /arbitrary JSON-compatible values|workingContext|memoryIntent|draftPlanMarkdown/);
  }
});

test("Gemini role contracts preserve lifecycle authority boundaries", () => {
  const serializer = new GeminiAgentResultContractSerializer();
  const planner = serializer.serialize(syntheticAgentContext("planner", "/tmp/source"));
  assert.match(planner, /no plan-acceptance property or authority/);
  assert.doesNotMatch(planner, /"accepted"/);

  const reviewer = serializer.serialize(syntheticAgentContext("reviewer", "/tmp/source"));
  assert.match(reviewer, /PASS_WITH_WARNINGS/);
  assert.match(reviewer, /failureOrigin/);
  assert.match(reviewer, /FAIL requires failureOrigin/);

  const examiner = serializer.serialize(syntheticAgentContext("examiner", "/tmp/source"));
  assert.match(examiner, /"projectId": "prj_prompt"/);
  assert.match(examiner, /"taskId": "task_prompt"/);
  assert.match(examiner, /never emit filesystem paths/);
});

test("Gemini configured payload contract contains only configured field names", () => {
  const output = new GeminiAgentResultContractSerializer().serialize(
    syntheticAgentContext("researcher", "/tmp/source", {
      outputFields: ["findings", "sources"],
    }),
  );
  assert.match(output, /"allowedProperties": \[\n\s+"findings",\n\s+"sources"/);
  assert.match(output, /"additionalProperties": false/);
});
