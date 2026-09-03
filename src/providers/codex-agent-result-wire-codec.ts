import type { AgentContext } from "../domain/agent-context.js";
import { CodexCliExecutionError } from "../domain/errors.js";

const COMMON_KEYS = [
  "agent",
  "outcome",
  "summary",
  "warnings",
  "requestedCalls",
  "requestedActions",
] as const;

const ROLE_KEYS = {
  questioner: ["state", "question", "workingContextJson"],
  researcher: ["payloadJson"],
  examiner: ["memoryIntent", "memoryConflict"],
  planner: ["draftPlanMarkdown", "consultation"],
  coder: ["payloadJson"],
  reviewer: ["reviewStatus", "failureOrigin", "payloadJson"],
} as const;

export class CodexAgentResultWireCodec {
  decode(context: AgentContext, value: unknown): unknown {
    const wire = requireRecord(value, "$result");
    requireExactKeys(wire, [...COMMON_KEYS, ...ROLE_KEYS[context.agent]], "$result");

    const result: Record<string, unknown> = {
      agent: wire.agent,
      outcome: wire.outcome,
      summary: wire.summary,
    };
    copyNullable(result, "warnings", wire.warnings);
    if (wire.requestedCalls !== null) {
      result.requestedCalls = decodeRequestedCalls(wire.requestedCalls);
    }
    if (wire.requestedActions !== null) {
      result.requestedActions = decodeRequestedActions(wire.requestedActions);
    }

    switch (context.agent) {
      case "questioner":
        result.state = wire.state;
        copyNullable(result, "question", wire.question);
        if (wire.workingContextJson !== null) {
          result.workingContext = parseOpaqueJson(
            wire.workingContextJson,
            "workingContextJson",
          );
        }
        break;
      case "researcher":
        result.researchArtifact = parseOpaqueJson(
          wire.payloadJson,
          "payloadJson",
        );
        break;
      case "examiner":
        result.memoryIntent = decodeMemoryIntent(wire.memoryIntent);
        if (wire.memoryConflict !== null) {
          result.memoryConflict = decodeFixedObject(
            wire.memoryConflict,
            ["summary"],
            "memoryConflict",
          );
        }
        break;
      case "planner":
        copyNullable(result, "draftPlanMarkdown", wire.draftPlanMarkdown);
        if (wire.consultation !== null) {
          result.consultation = decodeFixedObject(
            wire.consultation,
            ["disposition", "message"],
            "consultation",
          );
        }
        break;
      case "coder":
        result.workRecord = parseOpaqueJson(wire.payloadJson, "payloadJson");
        break;
      case "reviewer":
        result.reviewStatus = wire.reviewStatus;
        copyNullable(result, "failureOrigin", wire.failureOrigin);
        result.report = parseOpaqueJson(wire.payloadJson, "payloadJson");
        break;
    }

    return result;
  }

  instructions(context: AgentContext): string {
    const opaqueInstruction =
      context.agent === "questioner"
        ? "When working context is present, encode its complete JSON object as JSON text in workingContextJson; otherwise use null."
        : context.agent === "researcher" ||
            context.agent === "coder" ||
            context.agent === "reviewer"
          ? "Encode the complete configured payload object as JSON text in payloadJson. Preserve every key and nested value."
          : "";
    return [
      "## CODEX WIRE TRANSPORT",
      "The supplied output schema is a transport contract decoded into the Core AgentResult.",
      "For required nullable transport fields whose Core value is absent, output null; do not invent a semantic value.",
      opaqueInstruction,
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  }
}

function decodeRequestedCalls(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw malformedWire("requestedCalls");
  }
  return value.map((entry, index) => {
    const field = `requestedCalls[${index}]`;
    const call = requireRecord(entry, field);
    requireExactKeys(call, ["target", "purpose", "handoff"], field);
    const handoff = requireRecord(call.handoff, `${field}.handoff`);
    requireExactKeys(
      handoff,
      [
        "caller",
        "target",
        "purpose",
        "summary",
        "question",
        "artifactRefs",
      ],
      `${field}.handoff`,
    );
    const decodedHandoff: Record<string, unknown> = {
      caller: handoff.caller,
      target: handoff.target,
      purpose: handoff.purpose,
      summary: handoff.summary,
    };
    copyNullable(decodedHandoff, "question", handoff.question);
    copyNullable(decodedHandoff, "artifactRefs", handoff.artifactRefs);
    return {
      target: call.target,
      purpose: call.purpose,
      handoff: decodedHandoff,
    };
  });
}

function decodeRequestedActions(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw malformedWire("requestedActions");
  }
  return value.map((entry, index) => {
    const field = `requestedActions[${index}]`;
    const action = requireRecord(entry, field);
    requireExactKeys(action, ["action", "reason"], field);
    return { action: action.action, reason: action.reason };
  });
}

function decodeMemoryIntent(value: unknown): Record<string, unknown> {
  const intent = requireRecord(value, "memoryIntent");
  requireExactKeys(
    intent,
    ["kind", "projectId", "taskId", "content"],
    "memoryIntent",
  );
  const decoded: Record<string, unknown> = { kind: intent.kind };
  copyNullable(decoded, "projectId", intent.projectId);
  copyNullable(decoded, "taskId", intent.taskId);
  copyNullable(decoded, "content", intent.content);
  return decoded;
}

function decodeFixedObject(
  value: unknown,
  keys: readonly string[],
  field: string,
): Record<string, unknown> {
  const record = requireRecord(value, field);
  requireExactKeys(record, keys, field);
  return Object.fromEntries(keys.map((key) => [key, record[key]]));
}

function parseOpaqueJson(value: unknown, field: string): unknown {
  if (typeof value !== "string") {
    throw malformedWire(field);
  }
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw malformedWire(field, error);
  }
}

function copyNullable(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value !== null) {
    target[key] = value;
  }
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw malformedWire(field);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  field: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw malformedWire(field);
  }
}

function malformedWire(field: string, cause?: unknown): CodexCliExecutionError {
  return new CodexCliExecutionError(
    "malformed_result",
    { phase: "wire_decode", field },
    cause === undefined ? undefined : { cause },
  );
}
