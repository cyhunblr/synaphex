/**
 * Centralized minimum runtime versions for INSTALLER registration support.
 *
 * These are the versions whose official MCP registration mechanism was
 * verified directly against the installed runtime. They are recorded
 * separately from executor minimums on purpose: the version a runtime needs to
 * be *callable as an agent provider* and the version it needs to *host
 * Synaphex over MCP* are different capabilities, and conflating them would
 * misreport one as the other.
 *
 * Verified during the Phase-6B1 audit:
 *
 * ```text
 * codex  0.153.0   codex mcp add/list --json/remove
 * claude 2.1.260   claude mcp add --scope user / get / remove -s user
 * agy    1.1.26    agy mcp add/list/remove
 * ```
 *
 * Each minimum is set to the verified version rather than guessed lower: we
 * have no evidence about older releases' MCP syntax, and claiming support we
 * did not test would be exactly the "fake guarantee" this project forbids.
 */
export const INSTALLER_MINIMUM_VERSIONS = Object.freeze({
  openai: "0.153.0",
  anthropic: "2.1.260",
  google: "1.1.26",
} as const);

export interface ParsedVersion {
  readonly display: string;
  readonly parts: readonly number[];
}

/** Extracts the first dotted numeric version from arbitrary runtime output. */
export function parseVersion(output: string): ParsedVersion | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(output);
  if (match === null) {
    return null;
  }
  return {
    display: match[0],
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
  };
}

/** Negative when `left` precedes `right`. */
export function compareVersions(
  left: readonly number[],
  right: readonly number[],
): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export function meetsMinimum(version: ParsedVersion, minimum: string): boolean {
  const parsedMinimum = parseVersion(minimum);
  return (
    parsedMinimum !== null &&
    compareVersions(version.parts, parsedMinimum.parts) >= 0
  );
}
