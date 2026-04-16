import path from "path";
import fs from "fs/promises";
import { execSync } from "child_process";
import os from "os";
import readline from "readline/promises";

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
    const skillsSrc = path.join(cwd, "skills");

    console.log(`\n🚀 Synaphex Setup Assistant`);
    console.log(`--------------------------`);
    console.log(`Node Environment: ${process.version}`);
    console.log(`npx path: ${npxPath}`);
    console.log(`Project path: ${cwd}\n`);

    if (!platform) {
      console.log("Usage: npx synaphex setup <claude|copilot|antigravity>");
      return;
    }

    const targets = getTargets(platform);

    for (const target of targets) {
      await processTarget(target, npxPath, rl);
    }

    // Always attempt to link skills
    await setupSkills(skillsSrc, rl);

    console.log(
      "\n✅ Setup complete! Please reload your IDE for changes to take effect.",
    );
  } catch (err) {
    console.error(`\n❌ Setup failed: ${(err as Error).message}`);
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
    // If it's a deep path like .gemini/antigravity, we might want to skip instead of create?
    // For now, let's ask to create.
    const parent = path.dirname(filePath);
    const answer = await rl.question(
      `Target file ${filePath} doesn't exist. Create it? [y/N] `,
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
    console.warn(`⚠️ Warning: Could not parse ${filePath}. Skipping.`);
    return;
  }

  if (!config.mcpServers) config.mcpServers = {};

  const synaphexEntry = {
    command: npxPath,
    args: ["-y", "synaphex@latest"],
  };

  console.log(`\nProposed update for ${filePath}:`);
  console.log(JSON.stringify({ synaphex: synaphexEntry }, null, 2));

  const confirm = await rl.question(`Apply this update? [y/N] `);
  if (confirm.toLowerCase() === "y") {
    config.mcpServers["synaphex"] = synaphexEntry;
    await fs.writeFile(filePath, JSON.stringify(config, null, 2));
    console.log(`✅ Updated ${filePath}`);
  } else {
    console.log(`⏭️ Skipped ${filePath}`);
  }
}

async function setupSkills(
  skillsSrc: string,
  rl: readline.Interface,
): Promise<void> {
  const home = os.homedir();
  const skillsDest = path.join(home, ".claude", "skills", "synaphex");

  console.log(`\n--- Skills Installation ---`);
  console.log(`Source: ${skillsSrc}`);
  console.log(`Destination: ${skillsDest}`);

  const confirm = await rl.question(`Link Synaphex skills to your IDE? [y/N] `);
  if (confirm.toLowerCase() === "y") {
    try {
      await fs.mkdir(path.dirname(skillsDest), { recursive: true });
      // Remove existing symlink or folder if present
      await execSync(`rm -rf "${skillsDest}"`);
      await fs.symlink(skillsSrc, skillsDest, "dir");
      console.log(`✅ Skills linked successfully.`);
    } catch (err) {
      console.warn(
        `⚠️ Warning: Failed to link skills: ${(err as Error).message}`,
      );
    }
  } else {
    console.log(`⏭️ Skills linking skipped.`);
  }
}
