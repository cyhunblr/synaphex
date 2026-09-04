import { AntigravityCliExecutionError } from "../domain/errors.js";

export class AntigravityAgentResultEnvelopeDecoder {
  decode(stdout: string): unknown {
    let envelope: unknown;
    try {
      envelope = JSON.parse(stdout) as unknown;
    } catch (error) {
      throw new AntigravityCliExecutionError(
        "malformed_output",
        {},
        { cause: error },
      );
    }
    if (!isPlainObject(envelope) || typeof envelope.status !== "string") {
      throw new AntigravityCliExecutionError("malformed_output");
    }
    if (
      envelope.status !== "SUCCESS" ||
      (Object.hasOwn(envelope, "error") && envelope.error !== null)
    ) {
      throw new AntigravityCliExecutionError("provider_error", {
        providerStatus: envelope.status,
      });
    }
    if (
      !Object.hasOwn(envelope, "structured_output") ||
      envelope.structured_output === null ||
      envelope.structured_output === undefined
    ) {
      throw new AntigravityCliExecutionError("missing_structured_output");
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
