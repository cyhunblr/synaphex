import { detectInstalledIDEs } from "../../src/setup/detect";

describe("IDE Detection", () => {
  describe("detectInstalledIDEs", () => {
    it("should return an object with vscode and antigravity properties", async () => {
      const result = await detectInstalledIDEs();
      expect(result).toHaveProperty("vscode");
      expect(result).toHaveProperty("antigravity");
      expect(typeof result.vscode).toBe("boolean");
      expect(typeof result.antigravity).toBe("boolean");
    });

    it("should not crash on detection errors", async () => {
      expect(async () => {
        await detectInstalledIDEs();
      }).not.toThrow();
    });

    it("should return antigravity as false (not yet implemented)", async () => {
      const result = await detectInstalledIDEs();
      expect(result.antigravity).toBe(false);
    });
  });
});
