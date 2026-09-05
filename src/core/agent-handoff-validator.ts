import {
  AGENT_CALL_PURPOSES,
  type AgentCallPurpose,
  type AgentHandoff,
} from "../domain/agent-context.js";
import { isAgentName, type AgentName } from "../domain/agent.js";
import { InvalidAgentHandoffError } from "../domain/errors.js";
import { isArtifactId, type ArtifactId } from "../domain/artifact.js";

export function parseAgentHandoff(
  value: unknown,
  expectedTarget?: AgentName,
): AgentHandoff {
  if (!isPlainObject(value)) {
    throw new InvalidAgentHandoffError("handoff must be an object");
  }
  const allowedKeys = new Set([
    "caller",
    "target",
    "purpose",
    "summary",
    "question",
    "artifactRefs",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new InvalidAgentHandoffError(
      "handoff contains unsupported properties",
    );
  }
  if (!isAgentName(value.caller) || !isAgentName(value.target)) {
    throw new InvalidAgentHandoffError(
      "caller and target must be recognized agents",
    );
  }
  if (expectedTarget !== undefined && value.target !== expectedTarget) {
    throw new InvalidAgentHandoffError(
      `handoff target must match requested agent ${expectedTarget}`,
    );
  }
  if (!isAgentCallPurpose(value.purpose)) {
    throw new InvalidAgentHandoffError("purpose is not recognized");
  }
  if (!isNonEmptyString(value.summary)) {
    throw new InvalidAgentHandoffError("summary must be non-empty");
  }
  if (Object.hasOwn(value, "question") && !isNonEmptyString(value.question)) {
    throw new InvalidAgentHandoffError(
      "question must be non-empty when provided",
    );
  }

  let artifactRefs: readonly ArtifactId[] | undefined;
  if (Object.hasOwn(value, "artifactRefs")) {
    if (!Array.isArray(value.artifactRefs)) {
      throw new InvalidAgentHandoffError(
        "artifactRefs must be an array of artifact IDs",
      );
    }
    const refs = value.artifactRefs as unknown[];
    if (!refs.every(isArtifactId)) {
      throw new InvalidAgentHandoffError(
        "artifactRefs must contain only valid Synaphex artifact IDs",
      );
    }
    if (new Set(refs).size !== refs.length) {
      throw new InvalidAgentHandoffError(
        "artifactRefs must not contain duplicates",
      );
    }
    artifactRefs = [...refs] as ArtifactId[];
  }

  return {
    caller: value.caller,
    target: value.target,
    purpose: value.purpose,
    summary: value.summary,
    ...(Object.hasOwn(value, "question")
      ? { question: value.question as string }
      : {}),
    ...(artifactRefs === undefined ? {} : { artifactRefs }),
  };
}

function isAgentCallPurpose(value: unknown): value is AgentCallPurpose {
  return (
    typeof value === "string" &&
    (AGENT_CALL_PURPOSES as readonly string[]).includes(value)
  );
}



function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
