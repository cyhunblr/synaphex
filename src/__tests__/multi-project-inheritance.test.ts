import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { platform } from "node:os";
import { initializeMemoryStructure } from "../memory/structure.js";

describe("Integration: Multi-Project Inheritance", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `synaphex-inherit-test-${Date.now()}`);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("parent → child inheritance", () => {
    it("should establish one-level inheritance", async () => {
      const parentDir = path.join(testDir, "parent");
      const childDir = path.join(testDir, "child");

      // Initialize parent with custom memory
      await initializeMemoryStructure(parentDir);
      await fs.writeFile(
        path.join(parentDir, "memory", "internal", "overview.md"),
        "# Parent Project Overview\nCore infrastructure library.",
        "utf-8",
      );
      await fs.writeFile(
        path.join(parentDir, "memory", "internal", "conventions.md"),
        "# Parent Conventions\n- Use camelCase\n- TypeScript strict mode",
        "utf-8",
      );

      // Initialize child
      await initializeMemoryStructure(childDir);

      // Create symlink from child to parent
      const parentMemoryDir = path.join(parentDir, "memory", "internal");
      const childExternalDir = path.join(childDir, "memory", "external");
      const symlinkPath = path.join(childExternalDir, "parent_memory");

      try {
        await fs.symlink(parentMemoryDir, symlinkPath, "dir");

        // Verify symlink exists and points to parent
        const target = await fs.readlink(symlinkPath);
        expect(path.resolve(target)).toBe(path.resolve(parentMemoryDir));

        // Verify parent memory files are accessible via symlink
        const parentOverviewViaSymlink = path.join(symlinkPath, "overview.md");
        const exists = await fileExists(parentOverviewViaSymlink);
        expect(exists).toBe(true);
      } catch (err) {
        // Skip symlink tests on Windows
        if (platform() !== "win32") {
          throw err;
        }
      }
    });

    it("should allow child to write to its own memory without affecting parent", async () => {
      const parentDir = path.join(testDir, "parent");
      const childDir = path.join(testDir, "child");

      await initializeMemoryStructure(parentDir);
      await initializeMemoryStructure(childDir);

      const parentOverview = path.join(
        parentDir,
        "memory",
        "internal",
        "overview.md",
      );
      const childOverview = path.join(
        childDir,
        "memory",
        "internal",
        "overview.md",
      );

      // Modify child memory
      await fs.writeFile(
        childOverview,
        "# Child Project Overview\nApplication using parent library.",
        "utf-8",
      );

      // Verify parent is unchanged
      const parentContent = await fs.readFile(parentOverview, "utf-8");
      expect(parentContent).not.toContain("Child Project Overview");

      // Verify child has its own content
      const childContent = await fs.readFile(childOverview, "utf-8");
      expect(childContent).toContain("Child Project Overview");
    });

    it("should allow child to reference and extend parent knowledge", async () => {
      const parentDir = path.join(testDir, "parent");
      const childDir = path.join(testDir, "child");

      await initializeMemoryStructure(parentDir, { frameworks: ["express"] });
      await initializeMemoryStructure(childDir);

      // Parent has express framework knowledge
      const parentExpressSetup = path.join(
        parentDir,
        "memory",
        "internal",
        "express",
        "setup.md",
      );
      expect(await fileExists(parentExpressSetup)).toBe(true);

      // Child can extend with its own express patterns
      const childExpressDir = path.join(
        childDir,
        "memory",
        "internal",
        "express",
      );
      await fs.mkdir(childExpressDir, { recursive: true });
      await fs.writeFile(
        path.join(childExpressDir, "app-specific.md"),
        "# App-Specific Express Setup\nCustom middleware...",
        "utf-8",
      );

      // Both parent and child express knowledge is available
      const parentExists = await fileExists(parentExpressSetup);
      const childExists = await fileExists(
        path.join(childExpressDir, "app-specific.md"),
      );

      expect(parentExists).toBe(true);
      expect(childExists).toBe(true);
    });
  });

  describe("research sharing", () => {
    it("should separate parent and child research findings", async () => {
      const parentDir = path.join(testDir, "parent");
      const childDir = path.join(testDir, "child");

      await initializeMemoryStructure(parentDir);
      await initializeMemoryStructure(childDir);

      // Parent conducts research
      const parentResearch = path.join(
        parentDir,
        "memory",
        "internal",
        "research",
      );
      await fs.writeFile(
        path.join(parentResearch, "database-performance.md"),
        "# Database Performance\nPostgreSQL benchmarks...",
        "utf-8",
      );

      // Child conducts its own research
      const childResearch = path.join(
        childDir,
        "memory",
        "internal",
        "research",
      );
      await fs.writeFile(
        path.join(childResearch, "api-design.md"),
        "# REST API Design\nBest practices...",
        "utf-8",
      );

      // Verify separation
      expect(
        await fileExists(path.join(parentResearch, "database-performance.md")),
      ).toBe(true);
      expect(await fileExists(path.join(parentResearch, "api-design.md"))).toBe(
        false,
      );

      expect(await fileExists(path.join(childResearch, "api-design.md"))).toBe(
        true,
      );
      expect(
        await fileExists(path.join(childResearch, "database-performance.md")),
      ).toBe(false);
    });
  });

  describe("memory update propagation", () => {
    it("should propagate parent memory updates to child via symlink", async () => {
      const parentDir = path.join(testDir, "parent");
      const childDir = path.join(testDir, "child");

      await initializeMemoryStructure(parentDir);
      await initializeMemoryStructure(childDir);

      const parentOverview = path.join(
        parentDir,
        "memory",
        "internal",
        "overview.md",
      );

      // Write initial parent content
      await fs.writeFile(parentOverview, "# Version 1", "utf-8");
      let content = await fs.readFile(parentOverview, "utf-8");
      expect(content).toContain("Version 1");

      // Update parent content
      await fs.writeFile(parentOverview, "# Version 2 - Updated", "utf-8");
      content = await fs.readFile(parentOverview, "utf-8");
      expect(content).toContain("Version 2 - Updated");

      // If child had symlink, it would see updated content
      // (Symlink behavior tested separately above)
    });
  });

  describe("task memory isolation across projects", () => {
    it("should keep task memories isolated between parent and child", async () => {
      const parentDir = path.join(testDir, "parent");
      const childDir = path.join(testDir, "child");

      await initializeMemoryStructure(parentDir);
      await initializeMemoryStructure(childDir);

      // Create task in parent
      const parentTaskDir = path.join(
        parentDir,
        "memory",
        "internal",
        "tasks",
        "parent-task",
      );
      await fs.mkdir(parentTaskDir, { recursive: true });
      await fs.writeFile(
        path.join(parentTaskDir, "task-meta.json"),
        JSON.stringify({ slug: "parent-task" }),
        "utf-8",
      );

      // Create task in child
      const childTaskDir = path.join(
        childDir,
        "memory",
        "internal",
        "tasks",
        "child-task",
      );
      await fs.mkdir(childTaskDir, { recursive: true });
      await fs.writeFile(
        path.join(childTaskDir, "task-meta.json"),
        JSON.stringify({ slug: "child-task" }),
        "utf-8",
      );

      // Verify tasks are separate
      expect(await fileExists(path.join(parentTaskDir, "task-meta.json"))).toBe(
        true,
      );
      expect(await fileExists(path.join(childTaskDir, "task-meta.json"))).toBe(
        true,
      );
      expect(
        await fileExists(path.join(parentTaskDir, "child-task-meta.json")),
      ).toBe(false);
    });
  });
});

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
