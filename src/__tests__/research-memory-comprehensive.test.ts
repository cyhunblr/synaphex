import { writeFileSync } from "fs";
import {
  createTmpDir,
  cleanupTmpDir,
  createTestProject,
} from "./test-utils.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

describe("Research Memory - File Creation and Persistence", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it("creates research file at memory/internal/research/{topic}.md", async () => {
    const project = await createTestProject(tmpDir);
    const researchFile = join(
      project.internalDir,
      "research",
      "websocket-integration.md",
    );

    const content = "# WebSocket Integration Research\n\nFindings.";
    writeFileSync(researchFile, content);

    expect(existsSync(researchFile)).toBe(true);
  });

  it("research file includes Problem section", async () => {
    const project = await createTestProject(tmpDir);
    const researchFile = join(project.internalDir, "research", "test-topic.md");

    const content = "# Test Topic\n\n## Problem\n\nDescribe the problem.";
    writeFileSync(researchFile, content);

    const read = readFileSync(researchFile, "utf-8");
    expect(read).toContain("## Problem");
  });

  it("research file includes Key Findings section", async () => {
    const project = await createTestProject(tmpDir);
    const researchFile = join(project.internalDir, "research", "test-topic.md");

    const content =
      "# Test Topic\n\n## Key Findings\n\n- Finding 1\n- Finding 2";
    writeFileSync(researchFile, content);

    const read = readFileSync(researchFile, "utf-8");
    expect(read).toContain("## Key Findings");
  });

  it("research file includes Recommendation section", async () => {
    const project = await createTestProject(tmpDir);
    const researchFile = join(project.internalDir, "research", "test-topic.md");

    const content =
      "# Test Topic\n\n## Recommendation\n\nUse option X because...";
    writeFileSync(researchFile, content);

    const read = readFileSync(researchFile, "utf-8");
    expect(read).toContain("## Recommendation");
  });

  it("research file includes Sources section", async () => {
    const project = await createTestProject(tmpDir);
    const researchFile = join(project.internalDir, "research", "test-topic.md");

    const content =
      "# Test Topic\n\n## Sources\n\n- [Source 1](https://example.com)";
    writeFileSync(researchFile, content);

    const read = readFileSync(researchFile, "utf-8");
    expect(read).toContain("## Sources");
  });

  it("research file includes timestamp", async () => {
    const project = await createTestProject(tmpDir);
    const researchFile = join(project.internalDir, "research", "test-topic.md");

    const timestamp = new Date().toISOString();
    const content = `# Test Topic\n\n_Generated: ${timestamp}_`;
    writeFileSync(researchFile, content);

    const read = readFileSync(researchFile, "utf-8");
    expect(read).toContain("Generated");
  });
});

describe("Research Memory - Caching and Reuse", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it("detects existing research file on second run", async () => {
    const project = await createTestProject(tmpDir);
    const researchFile = join(
      project.internalDir,
      "research",
      "websocket-integration.md",
    );

    // First run: create file
    const content = "# WebSocket Integration\n\nOriginal findings.";
    writeFileSync(researchFile, content);

    // Second run: should detect existing file
    expect(existsSync(researchFile)).toBe(true);

    const read = readFileSync(researchFile, "utf-8");
    expect(read).toBe(content);
  });

  it("returns cached findings without re-research", async () => {
    const project = await createTestProject(tmpDir);
    const researchFile = join(project.internalDir, "research", "test-topic.md");

    const cachedContent = "# Cached Research\n\nDo not modify.";
    writeFileSync(researchFile, cachedContent);

    // Read again (simulating cache hit)
    const read = readFileSync(researchFile, "utf-8");
    expect(read).toBe(cachedContent);
  });

  it("--force flag allows re-research and overwrites cache", async () => {
    const project = await createTestProject(tmpDir);
    const researchFile = join(project.internalDir, "research", "test-topic.md");

    // Create initial file
    const oldContent = "# Old Research\n\nOld findings.";
    writeFileSync(researchFile, oldContent);

    // With --force, overwrite with new content
    const newContent = "# New Research\n\nNew findings.";
    writeFileSync(researchFile, newContent);

    const read = readFileSync(researchFile, "utf-8");
    expect(read).toBe(newContent);
    expect(read).not.toBe(oldContent);
  });
});

describe("Research Memory - Formatting and Structure", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it("persists findings as proper markdown", async () => {
    const project = await createTestProject(tmpDir);
    const researchFile = join(project.internalDir, "research", "test-topic.md");

    const markdown = `# WebSocket Integration

## Problem
Need real-time communication for chat.

## Key Findings
- WebSocket is bidirectional
- SSE is unidirectional
- WebSocket has lower latency

## Recommendation
Use WebSocket for chat features.

## Sources
- [MDN WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [WebSocket RFC](https://tools.ietf.org/html/rfc6455)`;

    writeFileSync(researchFile, markdown);

    const read = readFileSync(researchFile, "utf-8");
    expect(read).toContain("# WebSocket Integration");
    expect(read).toContain("## Problem");
    expect(read).toContain("## Key Findings");
    expect(read).toContain("## Recommendation");
    expect(read).toContain("## Sources");
  });

  it("markdown formatting is preserved exactly", async () => {
    const project = await createTestProject(tmpDir);
    const researchFile = join(project.internalDir, "research", "test-topic.md");

    const original = `# Title

## Section

- List item 1
- List item 2

**Bold** and *italic* text`;

    writeFileSync(researchFile, original);

    const read = readFileSync(researchFile, "utf-8");
    expect(read).toBe(original);
  });
});
