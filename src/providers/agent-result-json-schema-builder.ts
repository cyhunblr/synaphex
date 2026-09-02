import { AGENT_NAMES, type AgentName } from "../domain/agent.js";
import { AGENT_CALL_PURPOSES } from "../domain/agent-context.js";
import { AGENT_RESULT_OUTCOMES } from "../domain/agent-result.js";
import type { AgentContext } from "../domain/agent-context.js";

export type AgentResultJsonSchema = Readonly<Record<string, unknown>>;

type JsonSchema = Record<string, unknown>;

export class AgentResultJsonSchemaBuilder {
  build(context: AgentContext): AgentResultJsonSchema {
    const agent = context.agent;
    const payload = configuredPayloadSchema(
      context.behavior?.outputFields ?? [],
    );
    switch (agent) {
      case "questioner":
        return {
          oneOf: [questionerPendingSchema(), questionerCompleteSchema()],
        };
      case "researcher":
        return resultObject(agent, {
          researchArtifact: payload,
        }, ["researchArtifact"]);
      case "examiner":
        return resultObject(agent, {
          memoryIntent: memoryIntentSchema(),
          memoryConflict: objectSchema(
            { summary: nonEmptyStringSchema() },
            ["summary"],
          ),
        }, ["memoryIntent"]);
      case "planner":
        return plannerSchema();
      case "coder":
        return resultObject(agent, { workRecord: payload }, ["workRecord"]);
      case "reviewer":
        return reviewerSchema(payload);
    }
  }
}

function questionerPendingSchema(): JsonSchema {
  return resultObject(
    "questioner",
    {
      outcome: { const: "needs_user" },
      state: { const: "pending_question" },
      question: nonEmptyStringSchema(),
      workingContext: opaqueObjectSchema(),
    },
    ["state", "question"],
  );
}

function questionerCompleteSchema(): JsonSchema {
  return resultObject(
    "questioner",
    {
      outcome: { enum: ["success", "blocked", "error"] },
      state: { const: "context_complete" },
      workingContext: opaqueObjectSchema(),
    },
    ["state"],
  );
}

function plannerSchema(): JsonSchema {
  return {
    oneOf: [
      resultObject(
        "planner",
        { draftPlanMarkdown: nonEmptyStringSchema() },
        [],
      ),
      resultObject(
        "planner",
        {
          consultation: objectSchema(
            {
              disposition: { const: "plan_still_valid" },
              message: nonEmptyStringSchema(),
            },
            ["disposition", "message"],
          ),
        },
        ["consultation"],
      ),
      resultObject(
        "planner",
        {
          consultation: objectSchema(
            {
              disposition: { const: "revision_required" },
              message: nonEmptyStringSchema(),
            },
            ["disposition", "message"],
          ),
          draftPlanMarkdown: nonEmptyStringSchema(),
        },
        ["consultation", "draftPlanMarkdown"],
      ),
    ],
  };
}

function reviewerSchema(report: JsonSchema): JsonSchema {
  return {
    oneOf: [
      resultObject(
        "reviewer",
        { reviewStatus: { const: "PASS" }, report },
        ["reviewStatus", "report"],
      ),
      resultObject(
        "reviewer",
        {
          reviewStatus: { const: "PASS_WITH_WARNINGS" },
          warnings: {
            type: "array",
            minItems: 1,
            items: nonEmptyStringSchema(),
          },
          report,
        },
        ["reviewStatus", "warnings", "report"],
      ),
      resultObject(
        "reviewer",
        {
          reviewStatus: { const: "FAIL" },
          failureOrigin: {
            enum: ["implementation", "plan", "mixed"],
          },
          report,
        },
        ["reviewStatus", "failureOrigin", "report"],
      ),
    ],
  };
}

function resultObject(
  agent: AgentName,
  roleProperties: Readonly<Record<string, JsonSchema>>,
  roleRequired: readonly string[],
): JsonSchema {
  return objectSchema(
    {
      agent: { const: agent },
      outcome: { enum: [...AGENT_RESULT_OUTCOMES] },
      summary: nonEmptyStringSchema(),
      warnings: {
        type: "array",
        items: nonEmptyStringSchema(),
      },
      requestedCalls: {
        type: "array",
        items: requestedCallSchema(agent),
      },
      ...roleProperties,
    },
    ["agent", "outcome", "summary", ...roleRequired],
  );
}

function requestedCallSchema(caller: AgentName): JsonSchema {
  return objectSchema(
    {
      target: { enum: [...AGENT_NAMES] },
      purpose: { enum: [...AGENT_CALL_PURPOSES] },
      handoff: objectSchema(
        {
          caller: { const: caller },
          target: { enum: [...AGENT_NAMES] },
          purpose: { enum: [...AGENT_CALL_PURPOSES] },
          summary: nonEmptyStringSchema(),
          question: nonEmptyStringSchema(),
          artifactRefs: {
            type: "array",
            items: { type: "string", pattern: "^artifact_[A-Za-z0-9_-]+$" },
          },
        },
        ["caller", "target", "purpose", "summary"],
      ),
    },
    ["target", "purpose", "handoff"],
  );
}

function memoryIntentSchema(): JsonSchema {
  return {
    oneOf: [
      objectSchema({ kind: { const: "none" } }, ["kind"]),
      objectSchema(
        {
          kind: { const: "replace_project" },
          projectId: projectIdSchema(),
          content: { type: "string" },
        },
        ["kind", "projectId", "content"],
      ),
      objectSchema(
        {
          kind: { const: "replace_task" },
          projectId: projectIdSchema(),
          taskId: taskIdSchema(),
          content: { type: "string" },
        },
        ["kind", "projectId", "taskId", "content"],
      ),
      objectSchema(
        { kind: { const: "clear_project" }, projectId: projectIdSchema() },
        ["kind", "projectId"],
      ),
      objectSchema(
        {
          kind: { const: "clear_task" },
          projectId: projectIdSchema(),
          taskId: taskIdSchema(),
        },
        ["kind", "projectId", "taskId"],
      ),
    ],
  };
}

function configuredPayloadSchema(outputFields: readonly string[]): JsonSchema {
  return objectSchema(
    Object.fromEntries(outputFields.map((field) => [field, {}])),
    [],
  );
}

function opaqueObjectSchema(): JsonSchema {
  return { type: "object", additionalProperties: true };
}

function objectSchema(
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

function nonEmptyStringSchema(): JsonSchema {
  return { type: "string", minLength: 1 };
}

function projectIdSchema(): JsonSchema {
  return { type: "string", pattern: "^prj_[A-Za-z0-9_-]+$" };
}

function taskIdSchema(): JsonSchema {
  return { type: "string", pattern: "^task_[A-Za-z0-9_-]+$" };
}
