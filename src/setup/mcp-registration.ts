import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { z } from "zod";

const MCPServerSchema = z.record(
  z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
  }),
);

const ClaudeSettingsSchema = z.object({
  mcpServers: z.optional(MCPServerSchema),
});

type ClaudeSettings = z.infer<typeof ClaudeSettingsSchema>;

export interface RegistrationResult {
  success: boolean;
  message: string;
  isNew?: boolean;
  wasAlreadyConfigured?: boolean;
}

export async function registerMCPServer(): Promise<RegistrationResult> {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  let settings: ClaudeSettings = {};

  try {
    if (existsSync(settingsPath)) {
      const content = readFileSync(settingsPath, "utf-8");
      const parsed = JSON.parse(content);
      const validated = ClaudeSettingsSchema.parse(parsed);
      settings = validated;
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        success: false,
        message: `Invalid JSON in ~/.claude/settings.json: ${error.message}`,
      };
    }
    return {
      success: false,
      message: `Failed to read ~/.claude/settings.json: ${error}`,
    };
  }

  if (!settings.mcpServers) {
    settings.mcpServers = {};
  }

  const wasAlreadyConfigured = !!settings.mcpServers.synaphex;

  settings.mcpServers.synaphex = { command: "npx", args: ["synaphex"] };

  try {
    const jsonString = JSON.stringify(settings, null, 2);
    ClaudeSettingsSchema.parse(JSON.parse(jsonString));

    const backupPath = `${settingsPath}.bak`;
    if (existsSync(settingsPath)) {
      copyFileSync(settingsPath, backupPath);
    }

    writeFileSync(settingsPath, jsonString + "\n", "utf-8");

    return {
      success: true,
      message: "MCP server registered in ~/.claude/settings.json",
      isNew: !wasAlreadyConfigured,
      wasAlreadyConfigured,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        message: `Settings validation failed: ${error.message}`,
      };
    }
    if ((error as NodeJS.ErrnoException).code === "EACCES") {
      return {
        success: false,
        message: "Permission denied: Cannot write ~/.claude/settings.json",
      };
    }
    return {
      success: false,
      message: `Failed to register MCP server: ${error}`,
    };
  }
}
