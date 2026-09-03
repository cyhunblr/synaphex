import assert from "node:assert/strict";
import test from "node:test";
import { AgentPromptSerializer } from "../src/providers/agent-prompt-serializer.js";
import {
  syntheticAgentContext,
  syntheticExecutionPolicy,
} from "./fixtures/synthetic-agent-context.js";

test("prompt serializes only selected structured context with explicit protection", () => {
  const prompt = new AgentPromptSerializer().serialize(
    syntheticAgentContext("coder", "/canonical/source"),
    syntheticExecutionPolicy("coder"),
  );

  for (const section of [
    "SYNAPHEX AGENT",
    "ROLE / IMMUTABLE CONTRACT",
    "PROJECT",
    "TASK",
    "CANONICAL MEMORY",
    "DIRECTLY LOADED MEMORY",
    "CURRENT PLAN STATE",
    "RELEVANT ARTIFACTS",
    "EFFECTIVE RULES",
    "EXECUTION POLICY",
    "OUTPUT CONTRACT",
    "USER INSTRUCTION / HANDOFF",
  ]) {
    assert.match(prompt, new RegExp(`## ${section}`));
  }
  assert.match(prompt, /Logical agent: CODER/);
  assert.match(prompt, /implementation agent/);
  assert.match(prompt, /ACCEPTED_PLAN_CONTENT/);
  assert.match(prompt, /PROJECT_CANONICAL_MEMORY/);
  assert.match(prompt, /TASK_CANONICAL_MEMORY/);
  assert.match(prompt, /DIRECT_MEMORY_ONLY/);
  assert.match(prompt, /SELECTED_ARTIFACT/);
  assert.match(prompt, /CONTINUATION_HANDOFF/);
  assert.match(prompt, /custom_field/);
  assert.match(prompt, /requestedActions/);
  assert.match(prompt, /"network": \{/);
  assert.match(prompt, /"state": "denied"/);
  assert.match(prompt, /Do not directly create, edit, delete, or otherwise mutate Synaphex internal state under ~\/\.synaphex/);
  assert.doesNotMatch(prompt, /TRANSITIVE_OR_UNRELATED_MEMORY/);
  assert.doesNotMatch(prompt, /UNRELATED_ARCHIVED_ARTIFACT/);
});

test("shared serializer emits concise role-specific immutable instructions", () => {
  const serializer = new AgentPromptSerializer();
  const examiner = serializer.serialize(
    syntheticAgentContext("examiner", "/source"),
    syntheticExecutionPolicy("examiner"),
  );
  const reviewer = serializer.serialize(
    syntheticAgentContext("reviewer", "/source"),
    syntheticExecutionPolicy("reviewer"),
  );
  const planner = serializer.serialize(
    syntheticAgentContext("planner", "/source"),
    syntheticExecutionPolicy("planner"),
  );

  assert.match(examiner, /only logical role allowed to request canonical-memory mutation/);
  assert.match(examiner, /typed memoryIntent/);
  assert.match(reviewer, /without modifying or fixing source code/);
  assert.match(reviewer, /PASS_WITH_WARNINGS/);
  assert.match(planner, /Never mark a plan accepted/);
  assert.match(planner, /Never silently transition the workflow into CODER/);
});
