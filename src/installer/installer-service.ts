import { SynaphexError } from "../domain/errors.js";
import {
  formatTarget,
  type InstallationTarget,
  type SynaphexLauncher,
} from "../domain/installation.js";
import type { InstallationPlan } from "./installation-planner.js";
import { targetKey, type InstallationPlanner } from "./installation-planner.js";
import type { ProviderMcpRegistrar } from "./provider-mcp-registrar.js";

export type HostOutcomeStatus =
  | "configured"
  | "already_configured"
  | "refreshed"
  | "removed"
  | "not_configured"
  | "unavailable"
  | "skipped"
  | "failed";

export interface HostOutcome {
  readonly target: InstallationTarget;
  readonly status: HostOutcomeStatus;
  readonly detail?: string;
  /** Stable error code when the status is `failed` or `skipped`. */
  readonly code?: string;
}

export interface InstallationReport {
  readonly outcomes: readonly HostOutcome[];
  readonly warnings: readonly string[];
}

export interface InstallerServiceDependencies {
  readonly registrars: ReadonlyMap<string, ProviderMcpRegistrar>;
  readonly planner: InstallationPlanner;
}

/**
 * Executes an installation plan.
 *
 * Registrations are INDEPENDENT: one host failing never rolls back another
 * that already succeeded, and never aborts the remaining work. Every host gets
 * its own line in the report, so a partial success is reported as exactly
 * that rather than as total success.
 *
 * This layer holds no terminal interaction, so the whole installer is testable
 * without a TTY.
 */
export class InstallerService {
  constructor(private readonly dependencies: InstallerServiceDependencies) {}

  async plan(
    selected: readonly InstallationTarget[],
    launcher: SynaphexLauncher,
    home?: string,
  ): Promise<InstallationPlan> {
    return this.dependencies.planner.planInstall(selected, launcher, home);
  }

  /** Applies a plan. Nothing external is mutated before this is called. */
  async apply(
    plan: InstallationPlan,
    launcher: SynaphexLauncher,
    home?: string,
  ): Promise<InstallationReport> {
    const outcomes: HostOutcome[] = [];

    for (const skipped of plan.skipped) {
      outcomes.push({
        target: skipped.target,
        status: skipped.reason === "unavailable" ? "unavailable" : "skipped",
        detail: skipped.reason,
      });
    }

    for (const mutation of plan.mutations) {
      if (mutation.action === "already_configured") {
        outcomes.push({ target: mutation.target, status: "already_configured" });
        continue;
      }
      const registrar = this.dependencies.registrars.get(
        targetKey(mutation.target),
      );
      if (registrar === undefined) {
        outcomes.push({
          target: mutation.target,
          status: "skipped",
          detail: "registration unsupported",
        });
        continue;
      }
      try {
        await registrar.register(launcher, home);
        outcomes.push({
          target: mutation.target,
          status: mutation.action === "refresh" ? "refreshed" : "configured",
        });
      } catch (error) {
        // Independent hosts: keep going and report per host.
        outcomes.push({
          target: mutation.target,
          status: "failed",
          detail: safeDetail(error),
          ...(error instanceof SynaphexError ? { code: error.code } : {}),
        });
      }
    }
    return { outcomes: sortOutcomes(outcomes), warnings: plan.warnings };
  }

  /**
   * Removes Synaphex registrations that Synaphex provably owns.
   *
   * An entry that has drifted to an unknown command is NEVER deleted merely
   * because it carries the Synaphex name; it is reported as a conflict and
   * left in place. Cleanup continues across hosts after an individual failure.
   */
  async uninstall(
    targets: readonly InstallationTarget[],
    launcher: SynaphexLauncher,
    home?: string,
  ): Promise<InstallationReport> {
    const outcomes: HostOutcome[] = [];
    for (const target of targets) {
      const registrar = this.dependencies.registrars.get(targetKey(target));
      if (registrar === undefined) {
        outcomes.push({ target, status: "not_configured" });
        continue;
      }
      const availability = await registrar.detect(home);
      if (availability.state === "not_found") {
        outcomes.push({ target, status: "unavailable" });
        continue;
      }
      const inspection = await registrar.inspect(launcher, home);
      if (inspection.state === "absent") {
        // Harmless no-op.
        outcomes.push({ target, status: "not_configured" });
        continue;
      }
      if (inspection.state === "foreign" || inspection.state === "unknown") {
        outcomes.push({
          target,
          status: "skipped",
          detail: `left untouched: ${inspection.detail}`,
          code: "PROVIDER_MCP_REGISTRATION_CONFLICT",
        });
        continue;
      }
      try {
        await registrar.unregister(home);
        outcomes.push({ target, status: "removed" });
      } catch (error) {
        outcomes.push({
          target,
          status: "failed",
          detail: safeDetail(error),
          ...(error instanceof SynaphexError ? { code: error.code } : {}),
        });
      }
    }
    return { outcomes: sortOutcomes(outcomes), warnings: [] };
  }
}

/** Never leaks a stack trace or raw provider stderr into installer output. */
function safeDetail(error: unknown): string {
  if (error instanceof SynaphexError) {
    return error.message;
  }
  return "the provider command failed";
}

function sortOutcomes(outcomes: readonly HostOutcome[]): readonly HostOutcome[] {
  return [...outcomes].sort((left, right) =>
    formatTarget(left.target).localeCompare(formatTarget(right.target)),
  );
}
