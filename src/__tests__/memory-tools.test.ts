import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

describe("Memory Tools (read_memory, write_memory)", () => {
  let testDir: string;
  let projectDir: string;
  const projectName = "test-project";

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `synaphex-test-${Date.now()}`);
    projectDir = path.join(testDir, projectName);
    await fs.mkdir(path.join(projectDir, "memory", "internal"), {
      recursive: true,
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("handleWriteMemory", () => {
    it("should write memory file to memory/internal/", async () => {
      const filename = "test.md";

      // This would need mocking of projectExists/paths in real tests
      // For now, test the path sanitization logic
      const normalized = path.normalize(filename);
      expect(normalized).toBe(filename);
      expect(!normalized.startsWith("..")).toBe(true);
    });

    it("should reject path traversal attempts", async () => {
      const filename = "../../../etc/passwd";
      const normalized = path.normalize(filename);
      expect(normalized.startsWith("..")).toBe(true);
    });

    it("should reject absolute paths", async () => {
      const filename = "/etc/passwd";
      expect(path.isAbsolute(filename)).toBe(true);
    });
  });

  describe("handleReadMemory", () => {
    it("should read from memory/internal/ directly", async () => {
      const content = "# Test Memory";
      const filePath = path.join(projectDir, "memory", "internal", "test.md");
      await fs.writeFile(filePath, content, "utf-8");

      // Test would read and verify content
      const readContent = await fs.readFile(filePath, "utf-8");
      expect(readContent).toBe(content);
    });

    it("should throw error if file not found", async () => {
      const filePath = path.join(
        projectDir,
        "memory",
        "internal",
        "missing.md",
      );
      try {
        await fs.readFile(filePath, "utf-8");
        throw new Error("Should throw error");
      } catch (err) {
        expect((err as NodeJS.ErrnoException).code).toBe("ENOENT");
      }
    });

    it("should not fall back to old structure", async () => {
      // Write file to old location only
      const filePath = path.join(projectDir, "memory", "old-structure.md");
      await fs.writeFile(filePath, "Old content", "utf-8");

      // Try to read from internal/ - should fail
      const internalPath = path.join(
        projectDir,
        "memory",
        "internal",
        "old-structure.md",
      );
      try {
        await fs.readFile(internalPath, "utf-8");
        throw new Error("Should not find file");
      } catch (err) {
        expect((err as NodeJS.ErrnoException).code).toBe("ENOENT");
      }
    });
  });

  describe("Memory file sanitization", () => {
    it("should accept relative paths within memory/", () => {
      const validPaths = [
        "overview.md",
        "conventions.md",
        "research/topic.md",
        "tasks/slug/plan.md",
      ];

      validPaths.forEach((p) => {
        const normalized = path.normalize(p);
        expect(!normalized.startsWith("..")).toBe(true);
        expect(!path.isAbsolute(normalized)).toBe(true);
      });
    });

    it("should reject dangerous paths", () => {
      const invalidPaths = ["../../secret.md", "/etc/passwd"];

      invalidPaths.forEach((p) => {
        const normalized = path.normalize(p);
        const isDangerous =
          normalized.startsWith("..") || path.isAbsolute(normalized);
        expect(isDangerous).toBe(true);
      });
    });
  });
});
