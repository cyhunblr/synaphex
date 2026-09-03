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
    "PROVIDER CAPABILITY POLICY",
    "SYNAPHEX HOST ACTIONS",
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
  assert.match(prompt, /Network capability is denied/);
  assert.match(prompt, /git_push and ci are Synaphex host actions/);
  assert.match(prompt, /Do not directly execute host actions/);
  assert.match(prompt, /Local Git operations may be part of implementation/);
  assert.match(prompt, /never push directly/);
  assert.match(prompt, /configured project CI action/);
  assert.match(prompt, /Do not directly create, edit, delete, or otherwise mutate Synaphex internal state under ~\/\.synaphex/);
  assert.doesNotMatch(prompt, /TRANSITIVE_OR_UNRELATED_MEMORY/);
  assert.doesNotMatch(prompt, /UNRELATED_ARCHIVED_ARTIFACT/);
});

test("prompt reports enabled and approval-required network state precisely", () => {
  const serializer = new AgentPromptSerializer();
  const enabled = serializer.serialize(
    syntheticAgentContext("coder", "/source"),
    syntheticExecutionPolicy("coder", {
      network: {
        decision: "ask",
        source: "global",
        approvedForInvocation: true,
      },
    }),
  );
  const approvalRequired = serializer.serialize(
    syntheticAgentContext("coder", "/source"),
    syntheticExecutionPolicy("coder", {
      network: {
        decision: "ask",
        source: "global",
        approvedForInvocation: false,
      },
    }),
  );

  assert.match(enabled, /"state": "enabled"/);
  assert.match(enabled, /Network capability is enabled for this invocation/);
  assert.doesNotMatch(enabled, /return a network request/);
  assert.match(approvalRequired, /"state": "approval_required"/);
  assert.match(approvalRequired, /return a network request through requestedActions/);
  assert.doesNotMatch(approvalRequired, /Network capability is enabled/);
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
