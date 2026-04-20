import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface RegistrationResult {
  success: boolean;
  message: string;
  isNew?: boolean;
  wasAlreadyConfigured?: boolean;
}

export async function registerMCPServer(): Promise<RegistrationResult> {
  const configPath = join(homedir(), ".claude.json");
  let config: Record<string, unknown> = {};

  try {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, "utf-8");
      config = JSON.parse(content);
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        success: false,
        message: `Invalid JSON in ~/.claude.json: ${error.message}`,
      };
    }
    return {
      success: false,
      message: `Failed to read ~/.claude.json: ${error}`,
    };
  }

  const mcpServers =
    (config.mcpServers as Record<string, unknown> | undefined) ?? {};
  const wasAlreadyConfigured = !!mcpServers.synaphex;

  mcpServers.synaphex = { command: "npx", args: ["synaphex"] };
  config.mcpServers = mcpServers;

  try {
    const jsonString = JSON.stringify(config, null, 2);

    const backupPath = `${configPath}.bak`;
    if (existsSync(configPath)) {
      copyFileSync(configPath, backupPath);
    }

    writeFileSync(configPath, jsonString + "\n", "utf-8");

    return {
      success: true,
      message: "MCP server registered in ~/.claude.json",
      isNew: !wasAlreadyConfigured,
      wasAlreadyConfigured,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EACCES") {
      return {
        success: false,
        message: "Permission denied: Cannot write ~/.claude.json",
      };
    }
    return {
      success: false,
      message: `Failed to register MCP server: ${error}`,
    };
  }
}
