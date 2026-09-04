import {
  StandardAgentResultJsonSchemaBuilder,
  type StandardAgentResultJsonSchema,
} from "./standard-agent-result-json-schema-builder.js";

export type ClaudeAgentResultJsonSchema = StandardAgentResultJsonSchema;

/** Backward-compatible Claude name for the shared Core-shaped schema builder. */
export class ClaudeAgentResultJsonSchemaBuilder extends StandardAgentResultJsonSchemaBuilder {}
