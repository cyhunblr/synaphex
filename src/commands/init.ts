import { existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import chalk from "chalk";
import ora from "ora";
import { detectInstalledIDEs } from "../setup/detect.js";
import { promptIDESelection } from "../setup/prompts.js";
import { registerMCPServer } from "../setup/mcp-registration.js";

export async function handleInit(force = false): Promise<void> {
  const home = homedir();
  const synaphexDir = join(home, ".synaphex");
  const markerFile = join(synaphexDir, ".initialized");

  if (existsSync(markerFile) && !force) {
    console.log(chalk.yellow("\n⚠ Synaphex is already initialized"));
    console.log(chalk.gray("Run synaphex init --force to re-initialize\n"));
    return;
  }

  console.log(
    chalk.cyan("\n╭─────────────────────────────────────────────────────────╮"),
  );
  console.log(
    chalk.cyan("│                                                         │"),
  );
  console.log(
    chalk.cyan("│     ✨  Synaphex Environment Setup Wizard               │"),
  );
  console.log(
    chalk.cyan("│                                                         │"),
  );
  console.log(
    chalk.cyan("╰─────────────────────────────────────────────────────────╯\n"),
  );

  const detectionSpinner = ora("Detecting installed IDEs...").start();
  const detected = await detectInstalledIDEs();
  detectionSpinner.succeed(chalk.green("IDE detection complete"));

  const selected = await promptIDESelection(detected);

  console.log();

  const setupSpinner = ora("Setting up synaphex...").start();

  try {
    let configuredCount = 0;

    if (selected.includes("vscode")) {
      const mcpSpinner = ora("Configuring VS Code...").start();
      const result = await registerMCPServer();

      if (result.success) {
        mcpSpinner.succeed(
          chalk.green("✓ MCP server registered in ~/.claude/settings.json"),
        );
        configuredCount++;
      } else {
        mcpSpinner.warn(chalk.yellow(`⚠ ${result.message}`));
      }
    }

    if (selected.includes("antigravity")) {
      setupSpinner.text = "Configuring Antigravity...";
      setupSpinner.succeed(chalk.gray("→ Antigravity setup (coming soon)"));
    }

    if (selected.includes("cli")) {
      setupSpinner.text = "CLI mode selected";
      setupSpinner.succeed(
        chalk.green("✓ CLI mode ready (no IDE integration needed)"),
      );
      configuredCount++;
    }

    if (configuredCount > 0 || !selected.length) {
      mkdirSync(synaphexDir, { recursive: true });
      writeFileSync(markerFile, `initialized=${new Date().toISOString()}\n`);
    }

    console.log();
    console.log(chalk.green("✨ Setup complete!"));
    console.log();

    if (selected.includes("vscode")) {
      console.log(chalk.cyan("Next steps for VS Code:"));
      console.log(chalk.gray("  1. Restart VS Code"));
      console.log(chalk.gray("  2. Run: /synaphex:create my-project"));
    }

    if (selected.includes("cli")) {
      console.log(chalk.cyan("CLI is ready:"));
      console.log(chalk.gray("  synaphex create my-project"));
    }

    console.log();
    console.log(
      chalk.gray("For more info: https://github.com/cyhunblr/synaphex"),
    );
    console.log();
  } catch (err) {
    setupSpinner.fail(chalk.red(`Setup failed: ${(err as Error).message}`));
    process.exit(1);
  }
}
