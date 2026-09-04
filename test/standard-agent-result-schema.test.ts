import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_NAMES } from "../src/domain/agent.js";
import { ClaudeAgentResultJsonSchemaBuilder } from "../src/providers/claude-agent-result-json-schema-builder.js";
import { StandardAgentResultJsonSchemaBuilder } from "../src/providers/standard-agent-result-json-schema-builder.js";
import { syntheticAgentContext } from "./fixtures/synthetic-agent-context.js";

test("Claude retains byte-equivalent schemas through the shared standard builder", () => {
  const standard = new StandardAgentResultJsonSchemaBuilder();
  const claude = new ClaudeAgentResultJsonSchemaBuilder();
  for (const agent of AGENT_NAMES) {
    const context = syntheticAgentContext(agent, "/source");
    assert.deepEqual(claude.build(context), standard.build(context));
  }
});
