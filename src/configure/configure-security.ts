import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/**
 * Local-only access control for the configure server.
 *
 * The server binds loopback, but loopback alone is not a boundary: any page
 * the user visits can issue requests to 127.0.0.1, and a hostile DNS answer
 * can point an attacker-controlled name at loopback. Three checks close that:
 *
 *  1. a per-launch bearer token that only the page we served ever receives;
 *  2. an Origin allowlist, so a foreign page's fetch is refused even if it
 *     somehow learned the token;
 *  3. a Host allowlist, so a rebound DNS name cannot reach the API at all.
 *
 * There is deliberately no credential handling here. The configure surface
 * edits Synaphex configuration and never reads provider or registry secrets.
 */

export const SESSION_TOKEN_HEADER = "x-synaphex-configure-token";

/** Content types a browser can send cross-origin without a preflight. */
const SIMPLE_CONTENT_TYPES = [
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
];

export class ConfigureSession {
  /** 256 bits from the CSPRNG: not guessable within a process lifetime. */
  readonly token: string = randomBytes(32).toString("hex");

  constructor(private readonly port: number) {}

  /** Hosts the API answers to. Anything else is a rebinding attempt. */
  private allowedHosts(): readonly string[] {
    return [`127.0.0.1:${this.port}`, `localhost:${this.port}`];
  }

  private allowedOrigins(): readonly string[] {
    return [
      `http://127.0.0.1:${this.port}`,
      `http://localhost:${this.port}`,
    ];
  }

  /**
   * Constant-time token comparison. A length mismatch is reported directly
   * because the lengths are public, and `timingSafeEqual` requires equal
   * buffers.
   */
  private tokenMatches(candidate: string | undefined): boolean {
    if (candidate === undefined) {
      return false;
    }
    const expected = Buffer.from(this.token, "utf8");
    const actual = Buffer.from(candidate, "utf8");
    if (expected.length !== actual.length) {
      return false;
    }
    return timingSafeEqual(expected, actual);
  }

  /**
   * Authorizes one API request. Returns null when allowed, or the reason it
   * was refused. Reasons stay coarse: a caller that is not our page learns
   * only that it was rejected.
   */
  authorize(
    request: IncomingMessage,
    mutating: boolean,
  ): ConfigureAuthorizationFailure | null {
    const host = request.headers.host;
    if (host === undefined || !this.allowedHosts().includes(host)) {
      return { status: 403, reason: "host_not_allowed" };
    }

    // Origin is absent on same-origin non-CORS GETs in some browsers, so it is
    // required only when present or when the request mutates state.
    const origin = request.headers.origin;
    if (origin !== undefined && !this.allowedOrigins().includes(origin)) {
      return { status: 403, reason: "origin_not_allowed" };
    }

    if (!this.tokenMatches(headerValue(request, SESSION_TOKEN_HEADER))) {
      return { status: 401, reason: "invalid_session_token" };
    }

    if (mutating) {
      if (origin === undefined) {
        return { status: 403, reason: "origin_required_for_mutation" };
      }
      // A simple content type is the one shape an HTML form can post without
      // a preflight; requiring JSON means a cross-site form cannot mutate.
      const contentType = (headerValue(request, "content-type") ?? "")
        .split(";")[0]
        ?.trim()
        .toLowerCase();
      if (contentType !== "application/json") {
        return { status: 415, reason: "json_content_type_required" };
      }
      if (
        contentType !== undefined &&
        SIMPLE_CONTENT_TYPES.includes(contentType)
      ) {
        return { status: 415, reason: "json_content_type_required" };
      }
    }

    return null;
  }
}

export interface ConfigureAuthorizationFailure {
  readonly status: 401 | 403 | 415;
  readonly reason:
    | "host_not_allowed"
    | "origin_not_allowed"
    | "invalid_session_token"
    | "origin_required_for_mutation"
    | "json_content_type_required";
}

function headerValue(
  request: IncomingMessage,
  name: string,
): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
