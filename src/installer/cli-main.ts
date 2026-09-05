#!/usr/bin/env node
import { createInterface } from "node:readline";
import { AgentConfigManager } from "../core/agent-config-manager.js";
import { SynaphexError } from "../domain/errors.js";
import {
  SUPPORTED_INSTALLATION_TARGETS,
  formatTarget,
  type InstallationTarget,
} from "../domain/installation.js";
import { isProcessEntrypoint } from "../infrastructure/process-entrypoint.js";
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

  const prompt = createAsker();
  let plan;
  try {
    const selection = await promptForSelection(prompt.ask);
    if (selection.length === 0) {
      process.stdout.write("Nothing selected. No changes were made.\n");
      return 0;
    }

    // Plan first: nothing external is touched until the user confirms.
    plan = await service.plan(selection, launcher);
    const actionable = plan.mutations.filter(
      (mutation) => mutation.action !== "already_configured",
    );
    process.stdout.write(
      `${formatPlanConfirmation(actionable.map((mutation) => mutation.target))}\n\n`,
    );
    if (actionable.length > 0 && !isYes(await prompt.ask("Proceed? [y/N] "))) {
      process.stdout.write("Cancelled. No changes were made.\n");
      return 0;
    }
  } finally {
    prompt.close();
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
 * One question per provider runtime.
 *
 * There is no surface question, because a provider's CLI and its VS Code
 * extension share one MCP registration -- offering them separately would offer
 * a distinction the installer cannot deliver (ADR 0009).
 */
async function promptForSelection(
  ask: (question: string) => Promise<string>,
): Promise<readonly InstallationTarget[]> {
  const selected: InstallationTarget[] = [];
  for (const target of SUPPORTED_INSTALLATION_TARGETS) {
    const answer = await ask(`Configure ${formatTarget(target)}? [y/N] `);
    if (isYes(answer)) {
      selected.push(target);
    }
  }
  return selected;
}

function createAsker(): {
  ask: (question: string) => Promise<string>;
  close: () => void;
} {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  return {
    ask: async (question) => {
      process.stdout.write(question);
      const next = await lines.next();
      // Treat closed stdin as "declined" rather than hanging forever.
      return next.done === true ? "" : next.value;
    },
    close: () => {
      rl.close();
    },
  };
}

function isYes(answer: string): boolean {
  return /^(y|yes)$/i.test(answer.trim());
}

function safeMessage(error: unknown): string {
  return error instanceof SynaphexError
    ? error.message
    : "Synaphex installation could not start.";
}

if (isProcessEntrypoint(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.exitCode = 1;
    });
}
