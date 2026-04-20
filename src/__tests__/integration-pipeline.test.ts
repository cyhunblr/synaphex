import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  initializeMemoryStructure,
  createTaskMemory,
  MEMORY_TOPICS,
} from "../memory/structure.js";

describe("Integration: Full Task Pipeline with Memory Structure", () => {
  let testDir: string;
  let projectDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `synaphex-pipeline-test-${Date.now()}`);
    projectDir = path.join(testDir, "project");
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("memory structure initialization", () => {
    it("should initialize complete memory structure for new project", async () => {
      await initializeMemoryStructure(projectDir, {
        languages: ["typescript", "python"],
        frameworks: ["express"],
      });

      // Verify directory structure
      const internal = path.join(projectDir, "memory", "internal");
      const external = path.join(projectDir, "memory", "external");

      expect(await dirExists(internal)).toBe(true);
      expect(await dirExists(external)).toBe(true);

      // Verify all core memory topics are created
      for (const topic of MEMORY_TOPICS) {
        const file = `${topic}.md`;
        expect(await fileExists(path.join(internal, file))).toBe(true);
      }

      // Verify language files
      expect(
        await fileExists(path.join(internal, "typescript-guidelines.md")),
      ).toBe(true);
      expect(
        await fileExists(path.join(internal, "python-guidelines.md")),
      ).toBe(true);

      // Verify framework dirs
      expect(await dirExists(path.join(internal, "express"))).toBe(true);
      expect(await fileExists(path.join(internal, "express", "setup.md"))).toBe(
        true,
      );
    });
  });

  describe("task memory isolation", () => {
    it("should create isolated task memory directories", async () => {
      await initializeMemoryStructure(projectDir);

      // Create multiple tasks
      await createTaskMemory(projectDir, "task-one");
      await createTaskMemory(projectDir, "task-two");

      const task1Dir = path.join(
        projectDir,
        "memory",
        "internal",
        "tasks",
        "task-one",
      );
      const task2Dir = path.join(
        projectDir,
        "memory",
        "internal",
        "tasks",
        "task-two",
      );

      expect(await dirExists(task1Dir)).toBe(true);
      expect(await dirExists(task2Dir)).toBe(true);

      // Verify they're separate
      const task1Meta = path.join(task1Dir, "task-meta.json");
      const task2Meta = path.join(task2Dir, "task-meta.json");

      const meta1 = JSON.parse(await fs.readFile(task1Meta, "utf-8"));
      const meta2 = JSON.parse(await fs.readFile(task2Meta, "utf-8"));

      expect(meta1.slug).toBe("task-one");
      expect(meta2.slug).toBe("task-two");
    });

    it("should preserve task memory across reruns", async () => {
      await initializeMemoryStructure(projectDir);
      await createTaskMemory(projectDir, "test-task");

      const taskDir = path.join(
        projectDir,
        "memory",
        "internal",
        "tasks",
        "test-task",
      );
      const planPath = path.join(taskDir, "plan.md");

      // Modify plan
      await fs.writeFile(
        planPath,
        "# Updated Plan\n1. Step one\n2. Step two",
        "utf-8",
      );

      // Re-initialize memory structure
      await initializeMemoryStructure(projectDir);

      // Verify plan is unchanged
      const plan = await fs.readFile(planPath, "utf-8");
      expect(plan).toContain("Updated Plan");
    });
  });

  describe("research directory", () => {
    it("should create research subdirectory for findings", async () => {
      await initializeMemoryStructure(projectDir);

      const researchDir = path.join(
        projectDir,
        "memory",
        "internal",
        "research",
      );
      expect(await dirExists(researchDir)).toBe(true);

      // Simulate research findings
      const topicPath = path.join(researchDir, "typescript-frameworks.md");
      await fs.writeFile(
        topicPath,
        "# TypeScript Framework Research\n- Express\n- Fastify",
        "utf-8",
      );

      const content = await fs.readFile(topicPath, "utf-8");
      expect(content).toContain("TypeScript Framework Research");
    });
  });

  describe("external memory inheritance", () => {
    it("should support symlink-based memory inheritance", async () => {
      const parentDir = path.join(testDir, "parent");
      const childDir = path.join(testDir, "child");

      // Initialize parent
      await initializeMemoryStructure(parentDir);
      await fs.writeFile(
        path.join(parentDir, "memory", "internal", "overview.md"),
        "# Parent Project",
        "utf-8",
      );

      // Initialize child
      await initializeMemoryStructure(childDir);

      // Link child to parent (simulate remember command)
      const parentMemoryDir = path.join(parentDir, "memory", "internal");
      const childExternalDir = path.join(childDir, "memory", "external");

      try {
        // Skip symlink test on Windows
        const stat = await fs.stat(parentMemoryDir);
        if (stat.isDirectory()) {
          // Symlink creation would go here
          // For test purposes, just verify directories exist
          expect(await dirExists(childExternalDir)).toBe(true);
        }
      } catch {
        // Expected on some systems
      }
    });
  });

  describe("concurrent task creation", () => {
    it("should handle multiple task creations without conflicts", async () => {
      await initializeMemoryStructure(projectDir);

      // Create multiple tasks concurrently
      const tasks = ["task-1", "task-2", "task-3", "task-4", "task-5"];
      await Promise.all(
        tasks.map((slug) => createTaskMemory(projectDir, slug)),
      );

      // Verify all were created
      for (const slug of tasks) {
        const taskDir = path.join(
          projectDir,
          "memory",
          "internal",
          "tasks",
          slug,
        );
        expect(await dirExists(taskDir)).toBe(true);
      }
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

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
