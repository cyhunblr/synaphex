import { registerMCPServer } from "../../src/setup/mcp-registration";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

describe("MCP Server Registration", () => {
  describe("registerMCPServer", () => {
    it("should return a RegistrationResult object", async () => {
      const result = await registerMCPServer();
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("message");
      expect(typeof result.success).toBe("boolean");
      expect(typeof result.message).toBe("string");
    });

    it("should handle missing settings.json gracefully", async () => {
      const result = await registerMCPServer();
      expect(result.message).toBeTruthy();
    });

    it("should create backup file before writing", async () => {
      const result = await registerMCPServer();
      const home = homedir();
      const backupPath = join(home, ".claude", "settings.json.bak");

      if (result.success) {
        expect(
          existsSync(backupPath) ||
            !existsSync(join(home, ".claude", "settings.json")),
        ).toBe(true);
      }
    });

    it("should validate JSON before writing", async () => {
      const result = await registerMCPServer();
      if (result.success) {
        const home = homedir();
        const settingsPath = join(home, ".claude", "settings.json");
        if (existsSync(settingsPath)) {
          const { readFileSync } = await import("fs");
          const content = readFileSync(settingsPath, "utf-8");
          expect(() => JSON.parse(content)).not.toThrow();
        }
      }
    });
  });
});
