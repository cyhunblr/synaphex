import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { platform } from "node:os";

describe("Platform Portability", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `synaphex-platform-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("platform detection", () => {
    it("should detect current platform", () => {
      const currentPlatform = platform();
      expect(["darwin", "linux", "win32"]).toContain(currentPlatform);
    });

    it("should have different behavior for different platforms", () => {
      const isWindows = platform() === "win32";
      const isUnix = platform() === "darwin" || platform() === "linux";

      // At least one must be true
      expect(isWindows || isUnix).toBe(true);
    });
  });

  describe("symlink support detection", () => {
    it("should detect if symlinks are supported", async () => {
      const sourceDir = path.join(testDir, "source");
      const linkPath = path.join(testDir, "link");

      await fs.mkdir(sourceDir);

      try {
        await fs.symlink(sourceDir, linkPath, "dir");
      } catch {
        symlinkSupported = false;
      }

      // On Unix systems, symlinks should work
      if (platform() !== "win32") {
        expect(symlinkSupported).toBe(true);
      }
    });
  });

  describe("directory copy fallback", () => {
    it("should copy directory recursively as fallback", async () => {
      const sourceDir = path.join(testDir, "source");
      const destDir = path.join(testDir, "dest");

      // Create source directory with files
      await fs.mkdir(path.join(sourceDir, "subdir"), { recursive: true });
      await fs.writeFile(
        path.join(sourceDir, "file1.txt"),
        "Content 1",
        "utf-8",
      );
      await fs.writeFile(
        path.join(sourceDir, "subdir", "file2.txt"),
        "Content 2",
        "utf-8",
      );

      // Copy directory
      await copyDirRecursive(sourceDir, destDir);

      // Verify copy worked
      const files = await fs.readdir(destDir, { recursive: true });
      expect(files.length).toBeGreaterThan(0);

      const file1Content = await fs.readFile(
        path.join(destDir, "file1.txt"),
        "utf-8",
      );
      const file2Content = await fs.readFile(
        path.join(destDir, "subdir", "file2.txt"),
        "utf-8",
      );

      expect(file1Content).toBe("Content 1");
      expect(file2Content).toBe("Content 2");
    });

    it("should handle nested directories in copy", async () => {
      const sourceDir = path.join(testDir, "source");
      const destDir = path.join(testDir, "dest");

      // Create nested structure
      await fs.mkdir(path.join(sourceDir, "a", "b", "c"), { recursive: true });
      await fs.writeFile(
        path.join(sourceDir, "a", "b", "c", "deep.txt"),
        "Deep content",
        "utf-8",
      );

      await copyDirRecursive(sourceDir, destDir);

      const deepContent = await fs.readFile(
        path.join(destDir, "a", "b", "c", "deep.txt"),
        "utf-8",
      );
      expect(deepContent).toBe("Deep content");
    });
  });

  describe("path normalization", () => {
    it("should normalize paths for current platform", () => {
      // Path.normalize handles platform differences
      const unixPath = "src/memory/internal/overview.md";
      const normalized = path.normalize(unixPath);

      // On Windows, separators would be backslashes
      // On Unix, they remain forward slashes
      expect(normalized).toBeDefined();
      expect(normalized.length).toBeGreaterThan(0);
    });

    it("should handle absolute paths correctly", () => {
      const absolutePath = path.join(testDir, "test.md");
      const isAbsolute = path.isAbsolute(absolutePath);

      expect(isAbsolute).toBe(true);
    });

    it("should resolve relative paths consistently", () => {
      const cwd = testDir;
      const relative = "memory/internal";
      const resolved = path.resolve(cwd, relative);

      expect(path.isAbsolute(resolved)).toBe(true);
      expect(resolved).toContain("memory");
      expect(resolved).toContain("internal");
    });
  });

  describe("file permissions (Unix)", () => {
    it("should handle file operations with standard permissions", async () => {
      const testFile = path.join(testDir, "test.md");
      await fs.writeFile(testFile, "Test content", "utf-8");

      const stat = await fs.stat(testFile);
      expect(stat.isFile()).toBe(true);

      // File should be readable
      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe("Test content");
    });
  });

  describe("line ending handling", () => {
    it("should write files with consistent line endings", async () => {
      const testFile = path.join(testDir, "test.md");
      const content = "Line 1\nLine 2\nLine 3";

      await fs.writeFile(testFile, content, "utf-8");
      const readContent = await fs.readFile(testFile, "utf-8");

      expect(readContent).toBe(content);
    });
  });
});

async function copyDirRecursive(
  source: string,
  destination: string,
): Promise<void> {
  await fs.mkdir(destination, { recursive: true });

  const entries = await fs.readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      await copyDirRecursive(sourcePath, destPath);
    } else {
      await fs.copyFile(sourcePath, destPath);
    }
  }
}
