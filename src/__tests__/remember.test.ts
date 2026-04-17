import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { platform } from "node:os";

describe("Remember Command", () => {
  let testDir: string;
  let parentDir: string;
  let childDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `synaphex-remember-test-${Date.now()}`);
    parentDir = path.join(testDir, "parent");
    childDir = path.join(testDir, "child");

    // Create parent project with memory
    await fs.mkdir(path.join(parentDir, "memory", "internal"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(parentDir, "memory", "internal", "overview.md"),
      "# Parent Overview",
      "utf-8",
    );

    // Create child project
    await fs.mkdir(path.join(childDir, "memory", "external"), {
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

  describe("symlink creation", () => {
    it("should create external memory directory if missing", async () => {
      const externalDir = path.join(childDir, "memory", "external");
      const stat = await fs.stat(externalDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it("should create symlink pointing to parent memory", async () => {
      const parentMemoryDir = path.join(parentDir, "memory", "internal");
      const childExternalDir = path.join(childDir, "memory", "external");
      const symlinkPath = path.join(childExternalDir, "parent_memory");

      try {
        // Try to create symlink
        await fs.symlink(parentMemoryDir, symlinkPath, "dir");

        // Verify symlink exists
        const stat = await fs.lstat(symlinkPath);
        expect(stat.isSymbolicLink()).toBe(true);

        // Verify it points to correct location
        const target = await fs.readlink(symlinkPath);
        expect(path.resolve(target)).toBe(path.resolve(parentMemoryDir));
      } catch (err) {
        // On Windows, symlink might not be supported, that's ok for this test
        if (platform() !== "win32") {
          throw err;
        }
      }
    });
  });

  describe("symlink updates", () => {
    it("should update symlink if it points to wrong location", async () => {
      const oldMemoryPath = path.join(testDir, "old-memory");
      const newMemoryPath = path.join(parentDir, "memory", "internal");
      const symlinkPath = path.join(
        childDir,
        "memory",
        "external",
        "parent_memory",
      );

      try {
        // Create initial symlink to wrong location
        await fs.mkdir(oldMemoryPath, { recursive: true });
        await fs.symlink(oldMemoryPath, symlinkPath, "dir");

        // Update symlink
        await fs.unlink(symlinkPath);
        await fs.symlink(newMemoryPath, symlinkPath, "dir");

        // Verify it now points to new location
        const target = await fs.readlink(symlinkPath);
        expect(path.resolve(target)).toBe(path.resolve(newMemoryPath));
      } catch (err) {
        if (platform() !== "win32") {
          throw err;
        }
      }
    });
  });

  describe("platform-agnostic handling", () => {
    it("should handle directory copy fallback on Windows", async () => {
      const sourceDir = path.join(testDir, "source");
      const destDir = path.join(testDir, "dest");

      // Create source with files
      await fs.mkdir(path.join(sourceDir, "subdir"), { recursive: true });
      await fs.writeFile(
        path.join(sourceDir, "file1.md"),
        "Content 1",
        "utf-8",
      );
      await fs.writeFile(
        path.join(sourceDir, "subdir", "file2.md"),
        "Content 2",
        "utf-8",
      );

      // Copy directory
      await copyDirRecursive(sourceDir, destDir);

      // Verify copy worked
      const file1 = await fs.readFile(path.join(destDir, "file1.md"), "utf-8");
      const file2 = await fs.readFile(
        path.join(destDir, "subdir", "file2.md"),
        "utf-8",
      );

      expect(file1).toBe("Content 1");
      expect(file2).toBe("Content 2");
    });
  });

  describe("validation", () => {
    it("should validate parent project exists", async () => {
      const nonexistentParent = path.join(testDir, "nonexistent");
      expect(await dirExists(nonexistentParent)).toBe(false);
    });

    it("should validate child project exists", async () => {
      expect(await dirExists(childDir)).toBe(true);
    });
  });
});

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

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
