import { ClaudeCliExecutionError } from "../domain/errors.js";

export class ClaudeAgentResultEnvelopeDecoder {
  decode(stdout: string): unknown {
    let envelope: unknown;
    try {
      envelope = JSON.parse(stdout) as unknown;
    } catch (error) {
      throw new ClaudeCliExecutionError(
        "malformed_output",
        {},
        { cause: error },
      );
    }

    if (!isPlainObject(envelope)) {
      throw new ClaudeCliExecutionError("malformed_output");
    }
    if (
      envelope.is_error === true ||
      (typeof envelope.subtype === "string" &&
        envelope.subtype.toLowerCase().includes("error"))
    ) {
      throw new ClaudeCliExecutionError("structured_output_error");
    }
    if (
      !Object.hasOwn(envelope, "structured_output") ||
      envelope.structured_output === null ||
      envelope.structured_output === undefined
    ) {
      throw new ClaudeCliExecutionError("missing_structured_output");
    }
    return envelope.structured_output;
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
