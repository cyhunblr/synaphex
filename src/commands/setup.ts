import path from "path";
import fs from "fs/promises";
import { execSync } from "child_process";
import os from "os";
import readline from "readline/promises";
import { fileURLToPath } from "url";

interface McpConfig {
  mcpServers?: Record<string, unknown>;
}

export async function handleSetup(platform?: string): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const npxPath = getNpxPath();
    const cwd = process.cwd();
    const scriptPath = fileURLToPath(import.meta.url);
    const packageRoot = path.resolve(path.dirname(scriptPath), "..", "..");
    const skillsSrc = path.join(packageRoot, "skills");

    console.log(
      "\n╭─────────────────────────────────────────────────────────────╮",
    );
    console.log(
      "│                                                             │",
    );
    console.log(
      "│         🚀  SYNAPHEX: INTEGRATION & SETUP WIZARD            │",
    );
    console.log(
      "│                                                             │",
    );
    console.log(
      "╰─────────────────────────────────────────────────────────────╯",
    );

    console.log("\nSYSTEM ENVIRONMENT:");
    console.log(` • Node version     : ${process.version}`);
    console.log(` • Binary Path      : ${npxPath}`);
    console.log(` • Active Directory : ${cwd}\n`);

    if (!platform) {
      console.log("Usage: npx synaphex setup <claude|copilot|antigravity>");
      return;
    }

    const targets = getTargets(platform);

    console.log(`[1/2] CONFIGURING MCP SERVERS...`);
    for (const target of targets) {
      await processTarget(target, npxPath, rl);
    }

    // Create plugin link for Claude
    if (platform?.toLowerCase() === "claude") {
      console.log(`\n[2/2] INSTALLING CLAUDE PLUGIN...`);
      await setupPlugin(packageRoot, rl);
    } else {
      console.log(`\n[2/2] LINKING SKILLS...`);
      await setupSkills(skillsSrc, rl);
    }

    console.log("\n" + "─".repeat(61));
    console.log("✨  SETUP COMPLETE!");
    console.log("Your environment is now powered by Synaphex.");
    console.log(
      "Please reload your IDE/VSCode to activate the slash commands.",
    );
    console.log("─".repeat(61) + "\n");
  } catch (err) {
    console.error(`\n❌ ERROR: ${(err as Error).message}\n`);
  } finally {
    rl.close();
  }
}

function getNpxPath(): string {
  try {
    return execSync("which npx").toString().trim();
  } catch {
    // Fallback to absolute node path + npx suffix if 'which' fails
    return path.join(path.dirname(process.execPath), "npx");
  }
}

function getTargets(platform: string): string[] {
  const home = os.homedir();
  switch (platform.toLowerCase()) {
    case "claude":
      return [
        path.join(home, ".claude.json"),
        path.join(home, ".config", "Claude", "claude_desktop_config.json"),
      ];
    case "copilot":
      return [path.join(home, ".vscode", "mcp.json")];
    case "antigravity":
      return [path.join(home, ".gemini", "antigravity", "mcp_config.json")];
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

async function processTarget(
  filePath: string,
  npxPath: string,
  rl: readline.Interface,
): Promise<void> {
  const fileExists = await fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);

  if (!fileExists) {
    const parent = path.dirname(filePath);
    const answer = await rl.question(
      `  → File ${filePath} not found. Create? [y/N] `,
    );
    if (answer.toLowerCase() !== "y") return;
    await fs.mkdir(parent, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ mcpServers: {} }, null, 2));
  }

  const content = await fs.readFile(filePath, "utf-8");
  let config: McpConfig;
  try {
    config = JSON.parse(content);
  } catch {
    console.warn(`  ⚠️ Warning: Could not parse ${filePath}. Skipping.`);
    return;
  }

  if (!config.mcpServers) config.mcpServers = {};

  const synaphexEntry = {
    command: npxPath,
    args: ["-y", "synaphex@latest"],
  };

  console.log(`\n  PROPOSED UPDATE FOR ${filePath}:`);
  const diffStr = JSON.stringify({ synaphex: synaphexEntry }, null, 2)
    .split("\n")
    .map((line) => "    " + line)
    .join("\n");
  console.log(diffStr);

  const confirm = await rl.question(`\n  Apply this update? [y/N] `);
  if (confirm.toLowerCase() === "y") {
    config.mcpServers["synaphex"] = synaphexEntry;
    await fs.writeFile(filePath, JSON.stringify(config, null, 2));
    console.log(`  ✔ Successfully updated ${filePath}`);
  } else {
    console.log(`  ⏭️ Skipped ${filePath}`);
  }
}

async function setupPlugin(
  packageRoot: string,
  rl: readline.Interface,
): Promise<void> {
  const home = os.homedir();
  const pluginDest = path.join(home, ".claude", "plugins", "synaphex");

  console.log(`  → Source      : ${packageRoot}`);
  console.log(`  → Destination : ${pluginDest}`);

  const confirm = await rl.question(
    `\n  Register Synaphex as an official plugin? [y/N] `,
  );
  if (confirm.toLowerCase() === "y") {
    try {
      await fs.mkdir(path.dirname(pluginDest), { recursive: true });
      await execSync(`rm -rf "${pluginDest}"`);
      await fs.symlink(packageRoot, pluginDest, "dir");
      console.log(`  ✔ Plugin registered successfully.`);

      const oldSkillsLink = path.join(home, ".claude", "skills", "synaphex");
      await execSync(`rm -rf "${oldSkillsLink}"`);
      console.log(`  ✔ Legacy skills cleaned up.`);
    } catch (err) {
      console.warn(
        `  ⚠️ Warning: Failed to register plugin: ${(err as Error).message}`,
      );
    }
  } else {
    console.log(`  ⏭️ Plugin registration skipped.`);
  }
}

async function setupSkills(
  skillsSrc: string,
  rl: readline.Interface,
): Promise<void> {
  const home = os.homedir();
  const skillsDest = path.join(home, ".claude", "skills", "synaphex");

  console.log(`  → Source      : ${skillsSrc}`);
  console.log(`  → Destination : ${skillsDest}`);

  const confirm = await rl.question(
    `\n  Link Synaphex skills to your environment? [y/N] `,
  );
  if (confirm.toLowerCase() === "y") {
    try {
      await fs.mkdir(path.dirname(skillsDest), { recursive: true });
      await execSync(`rm -rf "${skillsDest}"`);
      await fs.symlink(skillsSrc, skillsDest, "dir");
      console.log(`  ✔ Skills linked successfully.`);
    } catch (err) {
      console.warn(
        `  ⚠️ Warning: Failed to link skills: ${(err as Error).message}`,
      );
    }
  } else {
    console.log(`  ⏭️ Skills linking skipped.`);
  }
}
