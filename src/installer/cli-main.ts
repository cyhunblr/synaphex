#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { AgentConfigManager } from "../core/agent-config-manager.js";
import { SynaphexError } from "../domain/errors.js";
import {
  SUPPORTED_INSTALLATION_TARGETS,
  formatTarget,
  type InstallationTarget,
} from "../domain/installation.js";
import { StateStore } from "../infrastructure/state-store.js";
import { createRegistrars } from "./create-registrars.js";
import { formatPlanConfirmation, formatReport } from "./format-report.js";
import { InstallationManifestStore } from "./installation-manifest.js";
import { InstallationPlanner } from "./installation-planner.js";
import { InstallerService } from "./installer-service.js";
import { SpawnProviderCommandRunner } from "./provider-command-runner.js";
import { SynaphexLauncherResolver } from "./synaphex-launcher-resolver.js";
import { SynaphexStateInitializer } from "./synaphex-state-initializer.js";

/**
 * The ONLY public terminal surface: `synaphex install` and
 * `synaphex uninstall`.
 *
 * Project, task and agent operations are deliberately absent: those are MCP /
 * provider-host operations, and adding terminal equivalents would create a
 * second orchestration surface.
 *
 * This module is a thin interaction layer. All decisions live in
 * InstallationPlanner and InstallerService so the installer is fully testable
 * without a terminal.
 */
export async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0];
  if (command !== "install" && command !== "uninstall") {
    process.stdout.write(
      "Usage: synaphex install | synaphex uninstall\n",
    );
    return command === undefined ? 1 : 1;
  }

  const runner = new SpawnProviderCommandRunner();
  const registrars = createRegistrars(runner);
  const service = new InstallerService({
    registrars,
    planner: new InstallationPlanner({ registrars }),
  });
  const stateStore = new StateStore();
  const manifest = new InstallationManifestStore(stateStore);

  let launcher;
  try {
    launcher = await new SynaphexLauncherResolver().resolve();
  } catch (error) {
    process.stderr.write(`${safeMessage(error)}\n`);
    return 1;
  }

  if (command === "uninstall") {
    const recorded = await manifest.read();
    const targets: readonly InstallationTarget[] =
      recorded.entries.length > 0
        ? recorded.entries.map((entry) => ({
            provider: entry.provider,
            surface: entry.surface,
          }))
        : SUPPORTED_INSTALLATION_TARGETS;
    const report = await service.uninstall(targets, launcher);
    process.stdout.write(`${formatReport(report, "Synaphex uninstall")}\n`);
    await manifest.forget(
      report.outcomes
        .filter((outcome) => outcome.status === "removed")
        .map((outcome) => outcome.target),
    );
    return report.outcomes.some((outcome) => outcome.status === "failed") ? 1 : 0;
  }

  const selection = await promptForSelection();
  if (selection.length === 0) {
    process.stdout.write("Nothing selected. No changes were made.\n");
    return 0;
  }

  // Plan first: nothing external is touched until the user confirms.
  const plan = await service.plan(selection, launcher);
  const actionable = plan.mutations.filter(
    (mutation) => mutation.action !== "already_configured",
  );
  process.stdout.write(
    `${formatPlanConfirmation(actionable.map((mutation) => mutation.target))}\n\n`,
  );
  if (actionable.length > 0 && !(await confirm())) {
    process.stdout.write("Cancelled. No changes were made.\n");
    return 0;
  }

  const report = await service.apply(plan, launcher);
  await new SynaphexStateInitializer({
    stateStore,
    agentConfigs: new AgentConfigManager(stateStore),
  }).initialize();
  await manifest.record(
    report.outcomes
      .filter(
        (outcome) =>
          outcome.status === "configured" ||
          outcome.status === "refreshed" ||
          outcome.status === "already_configured",
      )
      .map((outcome) => ({
        provider: outcome.target.provider,
        surface: outcome.target.surface,
        registrationName: "synaphex",
        launcherCommand: launcher.command,
        launcherArgs: [...launcher.args],
        configuredAt: new Date().toISOString(),
      })),
  );
  process.stdout.write(
    `${formatReport(report, "Synaphex installation")}\n\nSynaphex state    ready\n`,
  );
  return report.outcomes.some((outcome) => outcome.status === "failed") ? 1 : 0;
}

/**
 * Providers first, then only the surfaces that provider actually supports.
 *
 * Every supported target is currently a CLI surface, so the surface question
 * never appears. The TUI derives its options from
 * SUPPORTED_INSTALLATION_TARGETS rather than a hardcoded list, so it cannot
 * offer a VS Code surface Synaphex is unable to encode (ADR 0007).
 */
async function promptForSelection(): Promise<readonly InstallationTarget[]> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const selected: InstallationTarget[] = [];
    for (const provider of ["openai", "anthropic", "google"] as const) {
      const surfaces = SUPPORTED_INSTALLATION_TARGETS.filter(
        (target) => target.provider === provider,
      );
      const label = formatTarget(surfaces[0]!).split(" ")[0]!;
      const wanted = await rl.question(`Configure ${label}? [y/N] `);
      if (!isYes(wanted)) {
        continue;
      }
      if (surfaces.length === 1) {
        selected.push(surfaces[0]!);
        continue;
      }
      for (const surface of surfaces) {
        const answer = await rl.question(
          `  ${formatTarget(surface)}? [y/N] `,
        );
        if (isYes(answer)) {
          selected.push(surface);
        }
      }
    }
    return selected;
  } finally {
    rl.close();
  }
}

async function confirm(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return isYes(await rl.question("Proceed? [y/N] "));
  } finally {
    rl.close();
  }
}

function isYes(answer: string): boolean {
  return /^(y|yes)$/i.test(answer.trim());
}

function safeMessage(error: unknown): string {
  return error instanceof SynaphexError
    ? error.message
    : "Synaphex installation could not start.";
}

const invokedDirectly = process.argv[1]?.endsWith("cli-main.js") === true;
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.exitCode = 1;
    });
}
