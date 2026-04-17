import { promptIDESelection } from "../../src/setup/prompts";

describe("IDE Selection Prompts", () => {
  describe("promptIDESelection", () => {
    it("should handle detected VS Code", async () => {
      const detected = { vscode: true, antigravity: false };
      expect(() => {
        promptIDESelection(detected);
      }).not.toThrow();
    });

    it("should handle detected Antigravity", async () => {
      const detected = { vscode: false, antigravity: true };
      expect(() => {
        promptIDESelection(detected);
      }).not.toThrow();
    });

    it("should handle no IDEs detected", async () => {
      const detected = { vscode: false, antigravity: false };
      expect(() => {
        promptIDESelection(detected);
      }).not.toThrow();
    });

    it("should handle all IDEs detected", async () => {
      const detected = { vscode: true, antigravity: true };
      expect(() => {
        promptIDESelection(detected);
      }).not.toThrow();
    });
  });
});
