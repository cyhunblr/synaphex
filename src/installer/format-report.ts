import { formatTarget } from "../domain/installation.js";
import type { HostOutcome, InstallationReport } from "./installer-service.js";

const LABELS: Readonly<Record<HostOutcome["status"], string>> = Object.freeze({
  configured: "configured",
  already_configured: "already configured",
  refreshed: "refreshed",
  removed: "removed",
  not_configured: "not configured",
  unavailable: "unavailable",
  skipped: "skipped",
  failed: "failed",
});

/**
 * Renders a concise per-host summary.
 *
 * One line per host, no stack traces and no raw provider stderr: a failure
 * shows a bounded reason, because provider diagnostics can carry account or
 * path detail that does not belong in terminal output.
 */
export function formatReport(
  report: InstallationReport,
  heading: string,
): string {
  const lines: string[] = [heading, ""];
  const width = Math.max(
    ...report.outcomes.map((outcome) => formatTarget(outcome.target).length),
    "Synaphex state".length,
  );
  for (const outcome of report.outcomes) {
    const label = LABELS[outcome.status];
    const detail =
      outcome.status === "configured" ||
      outcome.status === "already_configured" ||
      outcome.status === "refreshed" ||
      outcome.status === "removed"
        ? ""
        : outcome.detail === undefined
          ? ""
          : `: ${outcome.detail}`;
    lines.push(
      `${formatTarget(outcome.target).padEnd(width)}  ${label}${detail}`,
    );
  }
  for (const warning of report.warnings) {
    lines.push("", warning);
  }
  return lines.join("\n");
}

export function formatPlanConfirmation(
  targets: readonly { provider: string }[],
): string {
  const lines = ["Synaphex will configure:", ""];
  for (const target of targets) {
    lines.push(`  ${formatTarget(target as never)}`);
  }
  lines.push(
    "",
    "Synaphex will not install provider software or manage authentication.",
  );
  return lines.join("\n");
}
