import { AGENT_NAMES, type AgentName } from "../domain/agent.js";
import { AGENT_CALL_PURPOSES } from "../domain/agent-context.js";
import {
  AGENT_RESULT_OUTCOMES,
  PLANNER_CONSULTATION_DISPOSITIONS,
  REVIEWER_FAILURE_ORIGINS,
  REVIEWER_STATUSES,
} from "../domain/agent-result.js";
import type { AgentContext } from "../domain/agent-context.js";

export type AgentResultJsonSchema = Readonly<Record<string, unknown>>;

type JsonSchema = Record<string, unknown>;

/** Builds the strict Codex wire schema, not the provider-independent Core shape. */
export class AgentResultJsonSchemaBuilder {
  build(context: AgentContext): AgentResultJsonSchema {
    switch (context.agent) {
      case "questioner":
        return resultObject("questioner", {
          state: stringEnumSchema(["pending_question", "context_complete"]),
          question: nullable(nonEmptyStringSchema()),
          workingContextJson: nullable(
            jsonTextSchema(
              "JSON text encoding the optional Questioner working-context object.",
            ),
          ),
        });
      case "researcher":
        return resultObject("researcher", {
          payloadJson: configuredPayloadJsonSchema(
            "Researcher artifact",
            context.behavior?.outputFields ?? [],
          ),
        });
      case "examiner":
        return resultObject("examiner", {
          memoryIntent: memoryIntentSchema(),
          memoryConflict: nullableObjectSchema({
            summary: nonEmptyStringSchema(),
          }),
        });
      case "planner":
        return resultObject("planner", {
          draftPlanMarkdown: nullable(nonEmptyStringSchema()),
          consultation: nullableObjectSchema({
            disposition: stringEnumSchema(
              PLANNER_CONSULTATION_DISPOSITIONS,
            ),
            message: nonEmptyStringSchema(),
          }),
        });
      case "coder":
        return resultObject("coder", {
          payloadJson: configuredPayloadJsonSchema(
            "Coder work record",
            context.behavior?.outputFields ?? [],
          ),
        });
      case "reviewer":
        return resultObject("reviewer", {
          reviewStatus: stringEnumSchema(REVIEWER_STATUSES),
          failureOrigin: nullableEnumSchema(REVIEWER_FAILURE_ORIGINS),
          payloadJson: configuredPayloadJsonSchema(
            "Reviewer report",
            context.behavior?.outputFields ?? [],
          ),
        });
    }
  }
}

function resultObject(
  agent: AgentName,
  roleProperties: Readonly<Record<string, JsonSchema>>,
): JsonSchema {
  return strictObjectSchema({
    agent: { type: "string", enum: [agent] },
    outcome: stringEnumSchema(AGENT_RESULT_OUTCOMES),
    summary: nonEmptyStringSchema(),
    warnings: nullable({
      type: "array",
      items: nonEmptyStringSchema(),
    }),
    requestedCalls: nullable({
      type: "array",
      items: requestedCallSchema(agent),
    }),
    ...roleProperties,
  });
}

function requestedCallSchema(caller: AgentName): JsonSchema {
  return strictObjectSchema({
    target: stringEnumSchema(AGENT_NAMES),
    purpose: stringEnumSchema(AGENT_CALL_PURPOSES),
    handoff: strictObjectSchema({
      caller: { type: "string", enum: [caller] },
      target: stringEnumSchema(AGENT_NAMES),
      purpose: stringEnumSchema(AGENT_CALL_PURPOSES),
      summary: nonEmptyStringSchema(),
      question: nullable(nonEmptyStringSchema()),
      artifactRefs: nullable({
        type: "array",
        items: { type: "string" },
      }),
    }),
  });
}

function memoryIntentSchema(): JsonSchema {
  return strictObjectSchema({
    kind: stringEnumSchema([
      "none",
      "replace_project",
      "replace_task",
      "clear_project",
      "clear_task",
    ]),
    projectId: nullable(projectIdSchema()),
    taskId: nullable(taskIdSchema()),
    content: nullable({ type: "string" }),
  });
}

function configuredPayloadJsonSchema(
  label: string,
  outputFields: readonly string[],
): JsonSchema {
  const allowed = outputFields.length === 0 ? "none" : outputFields.join(", ");
  return jsonTextSchema(
    `${label} as JSON text encoding an object. Allowed top-level keys: ${allowed}. Configured fields may be omitted; do not add unconfigured fields.`,
  );
}

function jsonTextSchema(description: string): JsonSchema {
  return { type: "string", description };
}

function strictObjectSchema(
  properties: Readonly<Record<string, JsonSchema>>,
): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}

function nullableObjectSchema(
  properties: Readonly<Record<string, JsonSchema>>,
): JsonSchema {
  return {
    ...strictObjectSchema(properties),
    type: ["object", "null"],
  };
}

function nullable(schema: JsonSchema): JsonSchema {
  if (typeof schema.type !== "string") {
    throw new TypeError("Nullable Codex schema must have one concrete type");
  }
  return { ...schema, type: [schema.type, "null"] };
}

function stringEnumSchema(values: readonly string[]): JsonSchema {
  return { type: "string", enum: [...values] };
}

function nullableEnumSchema(values: readonly string[]): JsonSchema {
  return { type: ["string", "null"], enum: [...values, null] };
}

function nonEmptyStringSchema(): JsonSchema {
  return { type: "string" };
}

function projectIdSchema(): JsonSchema {
  return { type: "string" };
}

function taskIdSchema(): JsonSchema {
  return { type: "string" };
}
