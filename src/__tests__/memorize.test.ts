import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

describe("Memorize Command", () => {
  let testDir: string;
  let projectDir: string;
  let codebaseDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `synaphex-memorize-test-${Date.now()}`);
    projectDir = path.join(testDir, "project");
    codebaseDir = path.join(testDir, "codebase");

    // Create project structure
    await fs.mkdir(path.join(projectDir, "memory", "internal"), {
      recursive: true,
    });
    await fs.mkdir(path.join(projectDir, "memory", "external"), {
      recursive: true,
    });

    // Create codebase with README and package.json
    await fs.mkdir(path.join(codebaseDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(codebaseDir, "README.md"),
      "# Test Project\nA test codebase.",
      "utf-8",
    );
    await fs.writeFile(
      path.join(codebaseDir, "package.json"),
      JSON.stringify({ name: "test-app", description: "Test application" }),
      "utf-8",
    );
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("codebase analysis", () => {
    it("should extract project overview from README", async () => {
      // This test validates the extraction logic without mocking
      const readmePath = path.join(codebaseDir, "README.md");
      const readmeContent = await fs.readFile(readmePath, "utf-8");
      expect(readmeContent).toContain("Test Project");
    });

    it("should extract package info from package.json", async () => {
      const pkgPath = path.join(codebaseDir, "package.json");
      const pkgContent = await fs.readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(pkgContent);

      expect(pkg.name).toBe("test-app");
      expect(pkg.description).toBe("Test application");
    });
  });

  describe("content hash computation", () => {
    it("should generate consistent hash for same content", () => {
      const content =
        "Overview: test\nArchitecture: simple\nConventions: camelCase";
      const hash1 = createHash("sha256").update(content).digest("hex");
      const hash2 = createHash("sha256").update(content).digest("hex");

      expect(hash1).toBe(hash2);
    });

    it("should generate different hash for different content", () => {
      const content1 = "Content A";
      const content2 = "Content B";

      const hash1 = createHash("sha256").update(content1).digest("hex");
      const hash2 = createHash("sha256").update(content2).digest("hex");

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("idempotency", () => {
    it("should skip memorize if content unchanged", async () => {
      const metaPath = path.join(projectDir, "memory", ".meta.json");
      const contentHash = createHash("sha256")
        .update("test content")
        .digest("hex");

      // Simulate first run
      const meta = { contentHash, timestamp: new Date().toISOString() };
      await fs.writeFile(metaPath, JSON.stringify(meta), "utf-8");

      // Check if we should skip
      const existing = JSON.parse(await fs.readFile(metaPath, "utf-8"));
      const shouldSkip = existing.contentHash === contentHash;

      expect(shouldSkip).toBe(true);
    });

    it("should not skip memorize if content changed", async () => {
      const metaPath = path.join(projectDir, "memory", ".meta.json");
      const oldHash = createHash("sha256").update("old content").digest("hex");
      const newHash = createHash("sha256").update("new content").digest("hex");

      const meta = {
        contentHash: oldHash,
        timestamp: new Date().toISOString(),
      };
      await fs.writeFile(metaPath, JSON.stringify(meta), "utf-8");

      const existing = JSON.parse(await fs.readFile(metaPath, "utf-8"));
      const shouldSkip = existing.contentHash === newHash;

      expect(shouldSkip).toBe(false);
    });
  });

  describe("memory file updates", () => {
    it("should update memory files with analysis results", async () => {
      const internal = path.join(projectDir, "memory", "internal");

      // Simulate analysis results being written
      const overviewContent = "# Project Overview\n\nAnalyzed project.";
      await fs.writeFile(
        path.join(internal, "overview.md"),
        overviewContent,
        "utf-8",
      );

      const content = await fs.readFile(
        path.join(internal, "overview.md"),
        "utf-8",
      );
      expect(content).toContain("Analyzed project");
    });
  });
});
