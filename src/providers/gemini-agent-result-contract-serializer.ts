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

interface GeminiResultContract {
  readonly format: "one_raw_json_object";
  readonly expectedAgent: AgentName;
  readonly common: Readonly<Record<string, unknown>>;
  readonly roleSpecific: Readonly<Record<string, unknown>>;
  readonly constraints: readonly string[];
}

/** Documents only the expected Core AgentResult variant for Gemini's prompt. */
export class GeminiAgentResultContractSerializer {
  serialize(context: AgentContext): string {
    const contract: GeminiResultContract = {
      format: "one_raw_json_object",
      expectedAgent: context.agent,
      common: commonContract(context.agent),
      roleSpecific: roleContract(context),
      constraints: constraints(context),
    };
    return [
      "## GEMINI TARGET RESULT CONTRACT",
      "The final response must be only one JSON object matching this contract. Optional properties may be omitted. No Markdown or prose may surround it.",
      JSON.stringify(contract, null, 2),
    ].join("\n");
  }
}

function commonContract(agent: AgentName): Readonly<Record<string, unknown>> {
  return {
    agent: { required: true, const: agent },
    outcome: { required: true, enum: AGENT_RESULT_OUTCOMES },
    summary: { required: true, type: "non_empty_string" },
    warnings: { required: false, type: "array_of_non_empty_strings" },
    requestedCalls: {
      required: false,
      type: "array",
      item: {
        target: { enum: AGENT_NAMES },
        purpose: { enum: AGENT_CALL_PURPOSES },
        handoff: {
          caller: { const: agent },
          target: { enum: AGENT_NAMES },
          purpose: { enum: AGENT_CALL_PURPOSES },
          summary: "non_empty_string",
          question: "optional_non_empty_string",
          artifactRefs: "optional_array_of_non_empty_strings",
        },
      },
    },
    requestedActions: {
      required: false,
      type: "array",
      item: {
        action: { enum: ACTION_NAMES },
        reason: "non_empty_string",
      },
    },
    additionalProperties: false,
  };
}

function roleContract(context: AgentContext): Readonly<Record<string, unknown>> {
  switch (context.agent) {
    case "questioner":
      return {
        state: { required: true, enum: ["pending_question", "context_complete"] },
        question: "required only for pending_question; non_empty_string",
        workingContext: "optional JSON object",
      };
    case "researcher":
      return {
        researchArtifact: configuredPayload(context.behavior?.outputFields ?? []),
      };
    case "examiner":
      return {
        memoryIntent: {
          required: true,
          variants: [
            { kind: "none" },
            {
              kind: "replace_project",
              projectId: context.project.id,
              content: "string",
            },
            ...(context.task === null
              ? []
              : [{
                  kind: "replace_task",
                  projectId: context.project.id,
                  taskId: context.task.id,
                  content: "string",
                }]),
            { kind: "clear_project", projectId: context.project.id },
            ...(context.task === null
              ? []
              : [{
                  kind: "clear_task",
                  projectId: context.project.id,
                  taskId: context.task.id,
                }]),
          ],
        },
        memoryConflict: {
          required: false,
          shape: { summary: "non_empty_string" },
        },
      };
    case "planner":
      return {
        draftPlanMarkdown: "optional_non_empty_string",
        consultation: {
          required: false,
          shape: {
            disposition: { enum: PLANNER_CONSULTATION_DISPOSITIONS },
            message: "non_empty_string",
          },
        },
      };
    case "coder":
      return {
        workRecord: configuredPayload(context.behavior?.outputFields ?? []),
      };
    case "reviewer":
      return {
        reviewStatus: { required: true, enum: REVIEWER_STATUSES },
        failureOrigin: {
          enum: REVIEWER_FAILURE_ORIGINS,
          rule: "required only for FAIL and forbidden for PASS variants",
        },
        report: configuredPayload(context.behavior?.outputFields ?? []),
      };
  }
}

function configuredPayload(outputFields: readonly string[]) {
  return {
    required: true,
    type: "object",
    allowedProperties: outputFields,
    propertyValues: "arbitrary JSON-compatible values",
    additionalProperties: false,
  };
}

function constraints(context: AgentContext): readonly string[] {
  const common = [
    "requestedCalls entries must keep target/purpose equal to handoff.target/handoff.purpose",
    "All values must be JSON-compatible and the object must satisfy the Core runtime validator",
  ];
  switch (context.agent) {
    case "planner":
      return [
        ...common,
        "PLANNER has no plan-acceptance property or authority; return only a draft or consultation",
      ];
    case "reviewer":
      return [
        ...common,
        "PASS_WITH_WARNINGS requires at least one lifecycle warning",
        "FAIL requires failureOrigin; PASS and PASS_WITH_WARNINGS forbid failureOrigin",
      ];
    case "examiner":
      return [
        ...common,
        "Memory intents may target only the exact logical project/task identifiers shown above; never emit filesystem paths",
      ];
    default:
      return common;
  }
}
