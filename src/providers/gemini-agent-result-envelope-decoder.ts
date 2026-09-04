import { GeminiCliExecutionError } from "../domain/errors.js";

export class GeminiAgentResultEnvelopeDecoder {
  decode(stdout: string): unknown {
    let envelope: unknown;
    try {
      envelope = JSON.parse(stdout) as unknown;
    } catch (error) {
      throw new GeminiCliExecutionError(
        "malformed_envelope",
        {},
        { cause: error },
      );
    }
    if (!isPlainObject(envelope)) {
      throw new GeminiCliExecutionError("malformed_envelope");
    }
    if (Object.hasOwn(envelope, "error") && envelope.error !== null) {
      throw new GeminiCliExecutionError("provider_error");
    }
    if (typeof envelope.response !== "string" || envelope.response.trim() === "") {
      throw new GeminiCliExecutionError("missing_response");
    }
    try {
      return JSON.parse(envelope.response.trim()) as unknown;
    } catch (error) {
      throw new GeminiCliExecutionError(
        "malformed_agent_json",
        {},
        { cause: error },
      );
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
