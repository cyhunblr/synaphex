import {
  AGENT_RESULT_OUTCOMES,
  PLANNER_CONSULTATION_DISPOSITIONS,
  REVIEWER_FAILURE_ORIGINS,
  REVIEWER_STATUSES,
  type AgentResultFor,
  type ExaminerMemoryIntent,
} from "../domain/agent-result.js";
import { isAgentName, type AgentName } from "../domain/agent.js";
import { InvalidAgentResultError } from "../domain/errors.js";
import { parseAgentHandoff } from "./agent-handoff-validator.js";

const COMMON_KEYS = [
  "agent",
  "outcome",
  "summary",
  "warnings",
  "requestedCalls",
] as const;

export function validateAgentResult<TAgent extends AgentName>(
  expectedAgent: TAgent,
  value: unknown,
): AgentResultFor<TAgent> {
  try {
    validateResult(expectedAgent, value);
    return value as AgentResultFor<TAgent>;
  } catch (error) {
    if (error instanceof InvalidAgentResultError) {
      throw error;
    }
    throw new InvalidAgentResultError(
      expectedAgent,
      error instanceof Error ? error.message : "result validation failed",
    );
  }
}

function validateResult(expectedAgent: AgentName, value: unknown): void {
  if (!isPlainObject(value)) {
    throw invalid(expectedAgent, "result must be an object");
  }
  if (!isAgentName(value.agent) || value.agent !== expectedAgent) {
    throw invalid(expectedAgent, "agent discriminator does not match");
  }
  if (
    typeof value.outcome !== "string" ||
    !(AGENT_RESULT_OUTCOMES as readonly string[]).includes(value.outcome)
  ) {
    throw invalid(expectedAgent, "outcome is not recognized");
  }
  if (!isNonEmptyString(value.summary)) {
    throw invalid(expectedAgent, "summary must be non-empty");
  }
  validateWarnings(expectedAgent, value.warnings, Object.hasOwn(value, "warnings"));
  validateRequestedCalls(
    expectedAgent,
    value.requestedCalls,
    Object.hasOwn(value, "requestedCalls"),
  );

  switch (expectedAgent) {
    case "questioner":
      validateQuestioner(value);
      break;
    case "researcher":
      assertAllowedKeys(value, expectedAgent, ["researchArtifact"]);
      assertPayload(value.researchArtifact, expectedAgent, "researchArtifact");
      break;
    case "examiner":
      validateExaminer(value);
      break;
    case "planner":
      validatePlanner(value);
      break;
    case "coder":
      assertAllowedKeys(value, expectedAgent, ["workRecord"]);
      assertPayload(value.workRecord, expectedAgent, "workRecord");
      break;
    case "reviewer":
      validateReviewer(value);
      break;
  }
}

function validateQuestioner(value: Record<string, unknown>): void {
  if (value.state === "pending_question") {
    assertAllowedKeys(value, "questioner", [
      "state",
      "question",
      "workingContext",
    ]);
    if (value.outcome !== "needs_user") {
      throw invalid(
        "questioner",
        "pending question requires needs_user outcome",
      );
    }
    if (!isNonEmptyString(value.question)) {
      throw invalid("questioner", "pending question must be non-empty");
    }
  } else if (value.state === "context_complete") {
    assertAllowedKeys(value, "questioner", ["state", "workingContext"]);
    if (value.outcome === "needs_user") {
      throw invalid(
        "questioner",
        "context_complete cannot use needs_user outcome",
      );
    }
  } else {
    throw invalid("questioner", "state is not recognized");
  }
  if (Object.hasOwn(value, "workingContext")) {
    assertPayload(value.workingContext, "questioner", "workingContext");
  }
}

function validateExaminer(value: Record<string, unknown>): void {
  assertAllowedKeys(value, "examiner", ["memoryIntent", "memoryConflict"]);
  validateMemoryIntent(value.memoryIntent);
  if (Object.hasOwn(value, "memoryConflict")) {
    if (
      !isPlainObject(value.memoryConflict) ||
      !hasExactKeys(value.memoryConflict, ["summary"]) ||
      !isNonEmptyString(value.memoryConflict.summary)
    ) {
      throw invalid("examiner", "memoryConflict must contain a summary");
    }
  }
}

function validatePlanner(value: Record<string, unknown>): void {
  assertAllowedKeys(value, "planner", ["draftPlanMarkdown", "consultation"]);
  if (
    Object.hasOwn(value, "draftPlanMarkdown") &&
    !isNonEmptyString(value.draftPlanMarkdown)
  ) {
    throw invalid(
      "planner",
      "draftPlanMarkdown must be non-empty when provided",
    );
  }
  if (Object.hasOwn(value, "consultation")) {
    if (
      !isPlainObject(value.consultation) ||
      !hasExactKeys(value.consultation, ["disposition", "message"]) ||
      typeof value.consultation.disposition !== "string" ||
      !(PLANNER_CONSULTATION_DISPOSITIONS as readonly string[]).includes(
        value.consultation.disposition,
      ) ||
      !isNonEmptyString(value.consultation.message)
    ) {
      throw invalid("planner", "consultation is invalid");
    }
    if (
      value.consultation.disposition === "revision_required" &&
      !Object.hasOwn(value, "draftPlanMarkdown")
    ) {
      throw invalid(
        "planner",
        "revision_required consultation requires draftPlanMarkdown",
      );
    }
    if (
      value.consultation.disposition === "plan_still_valid" &&
      Object.hasOwn(value, "draftPlanMarkdown")
    ) {
      throw invalid(
        "planner",
        "plan_still_valid consultation cannot include draftPlanMarkdown",
      );
    }
  }
}

function validateReviewer(value: Record<string, unknown>): void {
  assertAllowedKeys(value, "reviewer", [
    "reviewStatus",
    "failureOrigin",
    "report",
  ]);
  if (
    typeof value.reviewStatus !== "string" ||
    !(REVIEWER_STATUSES as readonly string[]).includes(value.reviewStatus)
  ) {
    throw invalid("reviewer", "reviewStatus is not recognized");
  }
  assertPayload(value.report, "reviewer", "report");
  const hasFailureOrigin = Object.hasOwn(value, "failureOrigin");
  if (value.reviewStatus === "FAIL") {
    if (
      typeof value.failureOrigin !== "string" ||
      !(REVIEWER_FAILURE_ORIGINS as readonly string[]).includes(
        value.failureOrigin,
      )
    ) {
      throw invalid("reviewer", "FAIL requires a valid failureOrigin");
    }
  } else if (hasFailureOrigin) {
    throw invalid(
      "reviewer",
      "failureOrigin is valid only for FAIL review status",
    );
  }
  if (
    value.reviewStatus === "PASS_WITH_WARNINGS" &&
    (!Array.isArray(value.warnings) || value.warnings.length === 0)
  ) {
    throw invalid(
      "reviewer",
      "PASS_WITH_WARNINGS requires lifecycle warnings",
    );
  }
}

function validateMemoryIntent(value: unknown): asserts value is ExaminerMemoryIntent {
  if (!isPlainObject(value) || typeof value.kind !== "string") {
    throw invalid("examiner", "memoryIntent must be a typed object");
  }
  if (value.kind === "none") {
    if (!hasExactKeys(value, ["kind"])) {
      throw invalid("examiner", "none memory intent has unexpected fields");
    }
    return;
  }
  if (value.kind === "replace_project") {
    if (
      !hasExactKeys(value, ["kind", "projectId", "content"]) ||
      !isProjectId(value.projectId) ||
      typeof value.content !== "string"
    ) {
      throw invalid("examiner", "replace_project memory intent is invalid");
    }
    return;
  }
  if (value.kind === "replace_task") {
    if (
      !hasExactKeys(value, ["kind", "projectId", "taskId", "content"]) ||
      !isProjectId(value.projectId) ||
      !isTaskId(value.taskId) ||
      typeof value.content !== "string"
    ) {
      throw invalid("examiner", "replace_task memory intent is invalid");
    }
    return;
  }
  if (value.kind === "clear_project") {
    if (
      !hasExactKeys(value, ["kind", "projectId"]) ||
      !isProjectId(value.projectId)
    ) {
      throw invalid("examiner", "clear_project memory intent is invalid");
    }
    return;
  }
  if (value.kind === "clear_task") {
    if (
      !hasExactKeys(value, ["kind", "projectId", "taskId"]) ||
      !isProjectId(value.projectId) ||
      !isTaskId(value.taskId)
    ) {
      throw invalid("examiner", "clear_task memory intent is invalid");
    }
    return;
  }
  throw invalid("examiner", "memoryIntent kind is not recognized");
}

function validateWarnings(
  agent: AgentName,
  value: unknown,
  present: boolean,
): void {
  if (!present) {
    return;
  }
  if (
    !Array.isArray(value) ||
    !value.every((warning) => isNonEmptyString(warning))
  ) {
    throw invalid(agent, "warnings must contain non-empty strings");
  }
}

function validateRequestedCalls(
  agent: AgentName,
  value: unknown,
  present: boolean,
): void {
  if (!present) {
    return;
  }
  if (!Array.isArray(value)) {
    throw invalid(agent, "requestedCalls must be an array");
  }
  for (const requestedCall of value) {
    if (
      !isPlainObject(requestedCall) ||
      !hasExactKeys(requestedCall, ["target", "purpose", "handoff"]) ||
      !isAgentName(requestedCall.target) ||
      typeof requestedCall.purpose !== "string"
    ) {
      throw invalid(agent, "requested call has an invalid shape");
    }
    let handoff;
    try {
      handoff = parseAgentHandoff(requestedCall.handoff, requestedCall.target);
    } catch {
      throw invalid(agent, "requested call contains an invalid handoff");
    }
    if (
      handoff.caller !== agent ||
      handoff.purpose !== requestedCall.purpose
    ) {
      throw invalid(
        agent,
        "requested call and handoff caller/target/purpose must agree",
      );
    }
  }
}

function assertPayload(
  value: unknown,
  agent: AgentName,
  field: string,
): void {
  if (!isJsonCompatibleObject(value)) {
    throw invalid(agent, `${field} must be a JSON-compatible object`);
  }
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  agent: AgentName,
  roleKeys: readonly string[],
): void {
  const allowed = new Set<string>([...COMMON_KEYS, ...roleKeys]);
  const unsupported = Object.keys(value).find((key) => !allowed.has(key));
  if (unsupported !== undefined) {
    throw invalid(agent, `unsupported result field: ${unsupported}`);
  }
}

function invalid(agent: AgentName, reason: string): InvalidAgentResultError {
  return new InvalidAgentResultError(agent, reason);
}

function isJsonCompatibleObject(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return false;
  }
  try {
    return isJsonValue(value, new WeakSet<object>());
  } catch {
    return false;
  }
}

function isJsonValue(value: unknown, ancestors: WeakSet<object>): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    return false;
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    return false;
  }
  ancestors.add(value);
  if (Object.getOwnPropertySymbols(value).length > 0) {
    ancestors.delete(value);
    return false;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  let valid: boolean;
  if (Array.isArray(value)) {
    const keys = Object.keys(descriptors).filter((key) => key !== "length");
    valid = keys.length === value.length;
    for (let index = 0; valid && index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      valid =
        descriptor !== undefined &&
        descriptor.enumerable === true &&
        "value" in descriptor &&
        isJsonValue(descriptor.value, ancestors);
    }
  } else {
    valid = Object.values(descriptors).every(
      (descriptor) =>
        descriptor.enumerable === true &&
        "value" in descriptor &&
        isJsonValue(descriptor.value, ancestors),
    );
  }
  ancestors.delete(value);
  return valid;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index])
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isProjectId(value: unknown): boolean {
  return typeof value === "string" && /^prj_[a-zA-Z0-9_-]+$/.test(value);
}

function isTaskId(value: unknown): boolean {
  return typeof value === "string" && /^task_[a-zA-Z0-9_-]+$/.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
