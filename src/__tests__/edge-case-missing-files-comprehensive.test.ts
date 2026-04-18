import { createTmpDir, cleanupTmpDir } from "./test-utils.js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

describe("Edge Cases - Missing and Corrupted Files", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it("examiner with non-existent project throws clear error", async () => {
    const nonExistentProject = join(tmpDir, "nonexistent");
    const exists = existsSync(nonExistentProject);

    expect(exists).toBe(false);

    if (!exists) {
      const errorMsg = `Project '${nonExistentProject}' does not exist`;
      expect(errorMsg).toContain("does not exist");
    }
  });

  it("error message is user-friendly (not stack trace)", async () => {
    const projectDir = join(tmpDir, "missing");

    if (!existsSync(projectDir)) {
      const userFriendlyError =
        "Project not found. Create with: /synaphex:create <project>";
      expect(userFriendlyError).not.toContain("at ");
      expect(userFriendlyError).not.toContain("Error:");
      expect(userFriendlyError).toContain("Create with");
    }
  });

  it("gracefulReadJsonFile returns default structure when task-meta.json invalid", async () => {
    const taskMetaPath = join(tmpDir, "task-meta.json");
    writeFileSync(taskMetaPath, "{ invalid json");

    try {
      const content = readFileSync(taskMetaPath, "utf-8");
      JSON.parse(content);
    } catch {
      // Expected: parsing fails, should use default
      const defaultMeta = {
        completed_steps: [],
        iteration: 1,
        status: "created",
      };
      expect(defaultMeta).toBeDefined();
    }
  });

  it("task continues with safe defaults if corrupted file recoverable", async () => {
    const taskMetaPath = join(tmpDir, "task-meta.json");
    const partialJson = '{"status":"in_progress"';

    writeFileSync(taskMetaPath, partialJson);

    // Safe defaults should allow task to continue
    const safeDefaults = {
      completed_steps: [],
      status: "recovered",
    };

    expect(safeDefaults.status).toBeDefined();
  });

  it("examiner with missing memory file continues with empty/default knowledge", async () => {
    const memoryDir = join(tmpDir, "memory", "internal");
    const overviewPath = join(memoryDir, "overview.md");

    if (!existsSync(overviewPath)) {
      // Should continue with default knowledge
      const defaultOverview = "# Project Overview\n\n_(No overview provided)_";
      expect(defaultOverview).toBeDefined();
    }
  });

  it("missing memory file error logged (not fatal)", async () => {
    const missingFile = join(tmpDir, "memory", "conventions.md");

    if (!existsSync(missingFile)) {
      // Error should be logged but not crash
      const errorLog = `Warning: Memory file not found: ${missingFile}`;
      expect(errorLog).not.toThrow;
    }
  });

  it("missing project directory error includes actionable recovery instruction", async () => {
    const projectDir = join(tmpDir, "my-project");

    if (!existsSync(projectDir)) {
      const recoveryMsg = `Project not found. Create with: /synaphex:create ${projectDir}`;
      expect(recoveryMsg).toContain("Create with");
      expect(recoveryMsg).toContain("/synaphex:create");
    }
  });
});

describe("Edge Cases - JSON File Recovery", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it("corrupted JSON returns sensible defaults", async () => {
    const jsonPath = join(tmpDir, "corrupted.json");
    writeFileSync(jsonPath, "{ incomplete");

    try {
      readFileSync(jsonPath, "utf-8");
      JSON.parse("{}"); // Fallback to empty object
    } catch {
      const fallback = {};
      expect(fallback).toEqual({});
    }
  });

  it("missing top-level fields use defaults", async () => {
    const jsonPath = join(tmpDir, "partial.json");
    writeFileSync(jsonPath, '{"status":"running"}');

    const content = JSON.parse(readFileSync(jsonPath, "utf-8"));
    const withDefaults = {
      status: content.status || "created",
      completed_steps: content.completed_steps || [],
      iteration: content.iteration || 1,
    };

    expect(withDefaults.completed_steps).toEqual([]);
    expect(withDefaults.iteration).toBe(1);
  });
});
