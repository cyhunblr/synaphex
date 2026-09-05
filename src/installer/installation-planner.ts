import {
  isSupportedTarget,
  type HostAvailability,
  type InstallationTarget,
} from "../domain/installation.js";
import type { ProviderMcpRegistrar } from "./provider-mcp-registrar.js";

export type PlannedAction =
  | "register"
  | "refresh"
  | "already_configured"
  | "unregister"
  | "not_configured";

export interface PlannedMutation {
  readonly target: InstallationTarget;
  readonly action: PlannedAction;
}

export interface SkippedTarget {
  readonly target: InstallationTarget;
  readonly reason: string;
}

/**
 * The decision record produced BEFORE any external configuration is touched.
 *
 * Building a plan performs no mutation, which is what makes both the terminal
 * flow and the tests deterministic: the same inputs always produce the same
 * plan, and a cancelled confirmation simply discards it.
 */
export interface InstallationPlan {
  readonly selected: readonly InstallationTarget[];
  readonly detected: ReadonlyMap<string, HostAvailability>;
  readonly mutations: readonly PlannedMutation[];
  readonly skipped: readonly SkippedTarget[];
  readonly warnings: readonly string[];
}

export function targetKey(target: InstallationTarget): string {
  return target.provider;
}

export interface InstallationPlannerDependencies {
  readonly registrars: ReadonlyMap<string, ProviderMcpRegistrar>;
}

/**
 * Turns a user selection into an executable plan.
 *
 * Detection is by direct runtime invocation, never by inferring availability
 * from the presence of a configuration file.
 */
export class InstallationPlanner {
  constructor(private readonly dependencies: InstallationPlannerDependencies) {}

  async planInstall(
    selected: readonly InstallationTarget[],
    launcher: Parameters<ProviderMcpRegistrar["inspect"]>[0],
    home?: string,
  ): Promise<InstallationPlan> {
    const detected = new Map<string, HostAvailability>();
    const mutations: PlannedMutation[] = [];
    const skipped: SkippedTarget[] = [];
    const warnings: string[] = [];

    for (const target of selected) {
      const key = targetKey(target);
      if (!isSupportedTarget(target)) {
        skipped.push({ target, reason: "this provider is not supported" });
        continue;
      }
      const registrar = this.dependencies.registrars.get(key);
      if (registrar === undefined) {
        skipped.push({ target, reason: "registration unsupported" });
        continue;
      }
      const availability = await registrar.detect(home);
      detected.set(key, availability);
      if (availability.state === "not_found") {
        skipped.push({ target, reason: "unavailable" });
        continue;
      }
      if (availability.state === "unsupported_version") {
        skipped.push({
          target,
          reason: `runtime ${availability.version} is older than the required ${availability.minimum}`,
        });
        continue;
      }
      if (availability.state === "registration_unsupported") {
        skipped.push({ target, reason: `registration unsupported: ${availability.reason}` });
        continue;
      }

      const inspection = await registrar.inspect(launcher, home);
      switch (inspection.state) {
        case "absent":
          mutations.push({ target, action: "register" });
          break;
        case "current":
          mutations.push({ target, action: "already_configured" });
          break;
        case "outdated":
          mutations.push({ target, action: "refresh" });
          break;
        case "foreign":
          skipped.push({
            target,
            reason: `an unrelated MCP server named "synaphex" already exists; it was left untouched`,
          });
          break;
        case "unknown":
          skipped.push({
            target,
            reason: `existing registration could not be verified: ${inspection.detail}`,
          });
          break;
      }
    }

    return { selected, detected, mutations, skipped, warnings };
  }
}
