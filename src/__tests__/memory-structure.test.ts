import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  initializeMemoryStructure,
  createTaskMemory,
  MEMORY_TOPICS,
} from "../memory/structure.js";

describe("Memory Structure", () => {
  let testDir: string;
  let projectDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `synaphex-struct-test-${Date.now()}`);
    projectDir = path.join(testDir, "test-project");
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("initializeMemoryStructure", () => {
    it("should create base directories", async () => {
      await initializeMemoryStructure(projectDir);

      const internal = path.join(projectDir, "memory", "internal");
      const external = path.join(projectDir, "memory", "external");
      const tasks = path.join(internal, "tasks");
      const research = path.join(internal, "research");

      const internalExists = await dirExists(internal);
      const externalExists = await dirExists(external);
      const tasksExists = await dirExists(tasks);
      const researchExists = await dirExists(research);

      expect(internalExists).toBe(true);
      expect(externalExists).toBe(true);
      expect(tasksExists).toBe(true);
      expect(researchExists).toBe(true);
    });

    it("should create default template files for all core topics", async () => {
      await initializeMemoryStructure(projectDir);

      const internal = path.join(projectDir, "memory", "internal");

      // Verify all MEMORY_TOPICS are created
      for (const topic of MEMORY_TOPICS) {
        const filePath = path.join(internal, `${topic}.md`);
        const exists = await fileExists(filePath);
        expect(exists).toBe(true);
      }
    });

    it("should ensure allowlist (MEMORY_TOPICS) matches scaffold templates", () => {
      // This test ensures that when new topics are added to the scaffold,
      // the MEMORY_TOPICS constant is also updated, so write_memory tool
      // allowlist stays in sync.
      const expectedTopics = [
        "overview",
        "architecture",
        "interfaces",
        "build",
        "conventions",
        "security",
        "glossary",
      ];

      expect(MEMORY_TOPICS.length).toBe(expectedTopics.length);

      for (const topic of expectedTopics) {
        expect(MEMORY_TOPICS).toContain(topic);
      }
    });

    it("should create language-specific templates", async () => {
      await initializeMemoryStructure(projectDir, {
        languages: ["cpp", "python"],
      });

      const internal = path.join(projectDir, "memory", "internal");
      const cppFile = path.join(internal, "cpp-guidelines.md");
      const pythonFile = path.join(internal, "python-guidelines.md");

      expect(await fileExists(cppFile)).toBe(true);
      expect(await fileExists(pythonFile)).toBe(true);
    });

    it("should create framework-specific subdirectories", async () => {
      await initializeMemoryStructure(projectDir, {
        frameworks: ["ros-noetic", "express"],
      });

      const internal = path.join(projectDir, "memory", "internal");
      const rosDir = path.join(internal, "ros-noetic");
      const expressDir = path.join(internal, "express");

      expect(await dirExists(rosDir)).toBe(true);
      expect(await dirExists(expressDir)).toBe(true);

      // Check for framework templates
      expect(await fileExists(path.join(rosDir, "setup.md"))).toBe(true);
      expect(await fileExists(path.join(rosDir, "patterns.md"))).toBe(true);
      expect(await fileExists(path.join(rosDir, "troubleshooting.md"))).toBe(
        true,
      );
    });
  });

  describe("createTaskMemory", () => {
    it("should create task directory with metadata", async () => {
      await initializeMemoryStructure(projectDir);
      await createTaskMemory(projectDir, "test-task");

      const taskDir = path.join(
        projectDir,
        "memory",
        "internal",
        "tasks",
        "test-task",
      );
      expect(await dirExists(taskDir)).toBe(true);
    });

    it("should create task files (plan, implementation, meta)", async () => {
      await initializeMemoryStructure(projectDir);
      await createTaskMemory(projectDir, "test-task");

      const taskDir = path.join(
        projectDir,
        "memory",
        "internal",
        "tasks",
        "test-task",
      );
      expect(await fileExists(path.join(taskDir, "plan.md"))).toBe(true);
      expect(await fileExists(path.join(taskDir, "implementation.md"))).toBe(
        true,
      );
      expect(await fileExists(path.join(taskDir, "task-meta.json"))).toBe(true);
    });

    it("should not overwrite existing task files", async () => {
      await initializeMemoryStructure(projectDir);
      await createTaskMemory(projectDir, "test-task");

      const metaPath = path.join(
        projectDir,
        "memory",
        "internal",
        "tasks",
        "test-task",
        "task-meta.json",
      );
      const originalContent = await fs.readFile(metaPath, "utf-8");

      // Create again
      await createTaskMemory(projectDir, "test-task");

      const newContent = await fs.readFile(metaPath, "utf-8");
      expect(newContent).toBe(originalContent);
    });

    it("should initialize task-meta.json with correct structure", async () => {
      await initializeMemoryStructure(projectDir);
      await createTaskMemory(projectDir, "test-task");

      const metaPath = path.join(
        projectDir,
        "memory",
        "internal",
        "tasks",
        "test-task",
        "task-meta.json",
      );
      const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));

      expect(meta.slug).toBe("test-task");
      expect(meta.created_at).toBeDefined();
      expect(meta.status).toBe("pending");
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
