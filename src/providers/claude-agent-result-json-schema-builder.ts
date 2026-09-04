import { AGENT_NAMES, type AgentName } from "../domain/agent.js";
import { AGENT_CALL_PURPOSES } from "../domain/agent-context.js";
import type { AgentContext } from "../domain/agent-context.js";
import {
  AGENT_RESULT_OUTCOMES,
  PLANNER_CONSULTATION_DISPOSITIONS,
  REVIEWER_FAILURE_ORIGINS,
  REVIEWER_STATUSES,
} from "../domain/agent-result.js";
import { ACTION_NAMES } from "../domain/rule.js";

export type ClaudeAgentResultJsonSchema = Readonly<Record<string, unknown>>;

type JsonSchema = Record<string, unknown>;

/** Builds Claude's structured-output schema for the Core-shaped AgentResult. */
export class ClaudeAgentResultJsonSchemaBuilder {
  build(context: AgentContext): ClaudeAgentResultJsonSchema {
    switch (context.agent) {
      case "questioner":
        return resultObject(
          "questioner",
          {
            state: stringEnumSchema(["pending_question", "context_complete"]),
            question: nonEmptyStringSchema(),
            workingContext: { type: "object" },
          },
          ["state"],
        );
      case "researcher":
        return resultObject(
          "researcher",
          {
            researchArtifact: configuredPayloadSchema(
              context.behavior?.outputFields ?? [],
            ),
          },
          ["researchArtifact"],
        );
      case "examiner":
        return resultObject(
          "examiner",
          {
            memoryIntent: memoryIntentSchema(),
            memoryConflict: strictObjectSchema(
              { summary: nonEmptyStringSchema() },
              ["summary"],
            ),
          },
          ["memoryIntent"],
        );
      case "planner":
        return resultObject(
          "planner",
          {
            draftPlanMarkdown: nonEmptyStringSchema(),
            consultation: strictObjectSchema(
              {
                disposition: stringEnumSchema(
                  PLANNER_CONSULTATION_DISPOSITIONS,
                ),
                message: nonEmptyStringSchema(),
              },
              ["disposition", "message"],
            ),
          },
          [],
        );
      case "coder":
        return resultObject(
          "coder",
          {
            workRecord: configuredPayloadSchema(
              context.behavior?.outputFields ?? [],
            ),
          },
          ["workRecord"],
        );
      case "reviewer":
        return reviewerResultSchema(context);
    }
  }
}

function resultObject(
  agent: AgentName,
  roleProperties: Readonly<Record<string, JsonSchema>>,
  requiredRoleProperties: readonly string[],
  allOf?: readonly JsonSchema[],
): JsonSchema {
  const schema = strictObjectSchema(
    {
      agent: { type: "string", const: agent },
      outcome: stringEnumSchema(AGENT_RESULT_OUTCOMES),
      summary: nonEmptyStringSchema(),
      warnings: {
        type: "array",
        items: nonEmptyStringSchema(),
      },
      requestedCalls: {
        type: "array",
        items: requestedCallSchema(agent),
      },
      requestedActions: {
        type: "array",
        items: requestedActionSchema(),
      },
      ...roleProperties,
    },
    ["agent", "outcome", "summary", ...requiredRoleProperties],
  );
  return allOf === undefined ? schema : { ...schema, allOf: [...allOf] };
}

function reviewerResultSchema(context: AgentContext): JsonSchema {
  return resultObject(
    "reviewer",
    {
      reviewStatus: stringEnumSchema(REVIEWER_STATUSES),
      failureOrigin: stringEnumSchema(REVIEWER_FAILURE_ORIGINS),
      report: configuredPayloadSchema(
        context.behavior?.outputFields ?? [],
      ),
    },
    ["reviewStatus", "report"],
    [
      {
        if: {
          properties: { reviewStatus: { const: "FAIL" } },
          required: ["reviewStatus"],
        },
        then: { required: ["failureOrigin"] },
        else: { not: { required: ["failureOrigin"] } },
      },
      {
        if: {
          properties: {
            reviewStatus: { const: "PASS_WITH_WARNINGS" },
          },
          required: ["reviewStatus"],
        },
        then: {
          required: ["warnings"],
          properties: { warnings: { minItems: 1 } },
        },
      },
    ],
  );
}

function requestedCallSchema(caller: AgentName): JsonSchema {
  return strictObjectSchema(
    {
      target: stringEnumSchema(AGENT_NAMES),
      purpose: stringEnumSchema(AGENT_CALL_PURPOSES),
      handoff: strictObjectSchema(
        {
          caller: { type: "string", const: caller },
          target: stringEnumSchema(AGENT_NAMES),
          purpose: stringEnumSchema(AGENT_CALL_PURPOSES),
          summary: nonEmptyStringSchema(),
          question: nonEmptyStringSchema(),
          artifactRefs: {
            type: "array",
            items: nonEmptyStringSchema(),
          },
        },
        ["caller", "target", "purpose", "summary"],
      ),
    },
    ["target", "purpose", "handoff"],
  );
}

function requestedActionSchema(): JsonSchema {
  return strictObjectSchema(
    {
      action: stringEnumSchema(ACTION_NAMES),
      reason: nonEmptyStringSchema(),
    },
    ["action", "reason"],
  );
}

function memoryIntentSchema(): JsonSchema {
  return {
    oneOf: [
      strictObjectSchema({ kind: { const: "none" } }, ["kind"]),
      strictObjectSchema(
        {
          kind: { const: "replace_project" },
          projectId: nonEmptyStringSchema(),
          content: { type: "string" },
        },
        ["kind", "projectId", "content"],
      ),
      strictObjectSchema(
        {
          kind: { const: "replace_task" },
          projectId: nonEmptyStringSchema(),
          taskId: nonEmptyStringSchema(),
          content: { type: "string" },
        },
        ["kind", "projectId", "taskId", "content"],
      ),
      strictObjectSchema(
        {
          kind: { const: "clear_project" },
          projectId: nonEmptyStringSchema(),
        },
        ["kind", "projectId"],
      ),
      strictObjectSchema(
        {
          kind: { const: "clear_task" },
          projectId: nonEmptyStringSchema(),
          taskId: nonEmptyStringSchema(),
        },
        ["kind", "projectId", "taskId"],
      ),
    ],
  };
}

function configuredPayloadSchema(outputFields: readonly string[]): JsonSchema {
  return strictObjectSchema(
    Object.fromEntries(outputFields.map((field) => [field, {}])),
    [],
  );
}

function strictObjectSchema(
  properties: Readonly<Record<string, JsonSchema>>,
  required: readonly string[],
): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: [...required],
  };
}

function stringEnumSchema(values: readonly string[]): JsonSchema {
  return { type: "string", enum: [...values] };
}

function nonEmptyStringSchema(): JsonSchema {
  return { type: "string", minLength: 1 };
}
