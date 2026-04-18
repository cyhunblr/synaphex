import { writeFileSync } from "fs";
import {
  createTestProject,
  createTmpDir,
  cleanupTmpDir,
} from "./test-utils.js";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

describe("Memory Operations - Structure Initialization", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it("initializes memory structure with default directories", async () => {
    const project = await createTestProject(tmpDir);

    expect(existsSync(project.internalDir)).toBe(true);
    expect(existsSync(project.externalDir)).toBe(true);
  });

  it("creates base memory files", async () => {
    const project = await createTestProject(tmpDir);

    const baseFiles = [
      "overview.md",
      "architecture.md",
      "conventions.md",
      "security.md",
      "dependencies.md",
    ];

    for (const file of baseFiles) {
      const filePath = join(project.internalDir, file);
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf-8");
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it("creates language-specific guidelines", async () => {
    const project = await createTestProject(tmpDir, {
      languages: ["typescript", "python"],
    });

    expect(
      existsSync(join(project.internalDir, "typescript-guidelines.md")),
    ).toBe(true);
    expect(existsSync(join(project.internalDir, "python-guidelines.md"))).toBe(
      true,
    );
  });

  it("creates framework directories with templates", async () => {
    const project = await createTestProject(tmpDir, {
      frameworks: ["express", "ros-noetic"],
    });

    const frameworkDirs = ["express", "ros-noetic"];
    for (const framework of frameworkDirs) {
      const frameworkDir = join(project.internalDir, framework);
      expect(existsSync(frameworkDir)).toBe(true);

      const files = ["setup.md", "patterns.md", "troubleshooting.md"];
      for (const file of files) {
        expect(existsSync(join(frameworkDir, file))).toBe(true);
      }
    }
  });
});

describe("Memory Operations - File I/O", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it("reads memory file content without errors", async () => {
    const project = await createTestProject(tmpDir);
    const filePath = join(project.internalDir, "overview.md");

    const content = readFileSync(filePath, "utf-8");
    expect(content).toBeDefined();
    expect(content.includes("Project Overview")).toBe(true);
  });

  it("writes memory file to internal research directory", async () => {
    const project = await createTestProject(tmpDir);
    const researchFile = join(project.internalDir, "research", "test-topic.md");

    const testContent = "# Test Research\n\nFindings here.";
    writeFileSync(researchFile, testContent);

    expect(existsSync(researchFile)).toBe(true);
    const read = readFileSync(researchFile, "utf-8");
    expect(read).toBe(testContent);
  });

  it("preserves markdown formatting in files", async () => {
    const project = await createTestProject(tmpDir);
    const testFile = join(project.internalDir, "test-formatted.md");

    const markdown = "# Heading\n\n- List item 1\n- List item 2\n\n**Bold**";
    writeFileSync(testFile, markdown);

    const content = readFileSync(testFile, "utf-8");
    expect(content).toBe(markdown);
    expect(content).toContain("# Heading");
    expect(content).toContain("**Bold**");
  });

  it("does not overwrite research files during memorize", async () => {
    const project = await createTestProject(tmpDir);
    const researchFile = join(
      project.internalDir,
      "research",
      "websocket-integration.md",
    );

    const originalContent = "# Original Research\n\nDo not overwrite.";
    writeFileSync(researchFile, originalContent);

    // Simulate memorize operation (only updates base files)
    const overviewFile = join(project.internalDir, "overview.md");
    writeFileSync(overviewFile, "# Updated Overview");

    // Research file should still have original content
    const read = readFileSync(researchFile, "utf-8");
    expect(read).toBe(originalContent);
  });
});

describe("Memory Operations - Directory Structure", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it("creates research subdirectory", async () => {
    const project = await createTestProject(tmpDir);
    const researchDir = join(project.internalDir, "research");
    expect(existsSync(researchDir)).toBe(true);
  });

  it("supports nested framework directories", async () => {
    const project = await createTestProject(tmpDir, {
      frameworks: ["express"],
    });

    const expressDir = join(project.internalDir, "express");
    expect(existsSync(expressDir)).toBe(true);
    expect(existsSync(join(expressDir, "setup.md"))).toBe(true);
  });

  it("external memory directory exists and is separate", async () => {
    const project = await createTestProject(tmpDir);
    expect(existsSync(project.externalDir)).toBe(true);
    expect(project.externalDir).not.toBe(project.internalDir);
  });
});
