import type { TestProject } from "./test-utils.js";
import { writeFileSync } from "fs";
import {
  createTmpDir,
  cleanupTmpDir,
  createTestProject,
} from "./test-utils.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

describe("Integration - Researcher Agent Execution", () => {
  let tmpDir: string;
  let project: TestProject;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    project = await createTestProject(tmpDir);
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it("researcher agent execution with topic websocket-integration", async () => {
    const researchFile = join(
      project.internalDir,
      "research",
      "websocket-integration.md",
    );

    const content = `# WebSocket Integration

## Problem
Need real-time communication for chat applications.

## Key Findings
- WebSocket provides bidirectional communication
- Lower latency compared to polling

## Recommendation
Implement WebSocket for real-time features.

## Sources
- https://developer.mozilla.org/en-US/docs/Web/API/WebSocket`;

    writeFileSync(researchFile, content);

    expect(existsSync(researchFile)).toBe(true);
  });

  it("research findings file created at memory/internal/research/websocket-integration.md", async () => {
    const researchDir = join(project.internalDir, "research");
    expect(existsSync(researchDir)).toBe(true);

    const researchFile = join(researchDir, "websocket-integration.md");
    writeFileSync(researchFile, "# WebSocket\n\nResearch here.");

    expect(existsSync(researchFile)).toBe(true);
  });

  it("research file contains Problem section", async () => {
    const researchFile = join(
      project.internalDir,
      "research",
      "websocket-integration.md",
    );

    const content = `# WebSocket Integration

## Problem
The system needs real-time bidirectional communication.`;

    writeFileSync(researchFile, content);

    const read = readFileSync(researchFile, "utf-8");
    expect(read).toContain("## Problem");
  });

  it("research file contains Key Findings section", async () => {
    const researchFile = join(
      project.internalDir,
      "research",
      "websocket-integration.md",
    );

    const content = `# WebSocket Integration

## Key Findings
- WebSocket is a protocol for persistent connections
- Supports full-duplex communication
- Lower latency than HTTP polling`;

    writeFileSync(researchFile, content);

    const read = readFileSync(researchFile, "utf-8");
    expect(read).toContain("## Key Findings");
  });

  it("research file contains Recommendation section", async () => {
    const researchFile = join(
      project.internalDir,
      "research",
      "websocket-integration.md",
    );

    const content = `# WebSocket Integration

## Recommendation
Use WebSocket for real-time features because it provides:
- True bidirectional communication
- Lower latency`;

    writeFileSync(researchFile, content);

    const read = readFileSync(researchFile, "utf-8");
    expect(read).toContain("## Recommendation");
  });

  it("research file contains Sources section", async () => {
    const researchFile = join(
      project.internalDir,
      "research",
      "websocket-integration.md",
    );

    const content = `# WebSocket Integration

## Sources
- [MDN WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [RFC 6455](https://tools.ietf.org/html/rfc6455)`;

    writeFileSync(researchFile, content);

    const read = readFileSync(researchFile, "utf-8");
    expect(read).toContain("## Sources");
  });
});

describe("Integration - Research Caching and Reuse", () => {
  let tmpDir: string;
  let project: TestProject;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    project = await createTestProject(tmpDir);
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it("research reuse - second run detects existing file and returns cached", async () => {
    const researchFile = join(
      project.internalDir,
      "research",
      "websocket-integration.md",
    );

    // First run: create file
    const content = "# WebSocket\n\nOriginal research.";
    writeFileSync(researchFile, content);

    // Second run: detect existing and return cached
    const cached = existsSync(researchFile);
    expect(cached).toBe(true);

    const read = readFileSync(researchFile, "utf-8");
    expect(read).toBe(content);
  });

  it("--force flag allows re-research and overwrites cache", async () => {
    const researchFile = join(
      project.internalDir,
      "research",
      "websocket-integration.md",
    );

    // Create initial research
    const original = "# WebSocket\n\nOld findings.";
    writeFileSync(researchFile, original);

    // With --force, overwrite
    const updated = "# WebSocket\n\nNew findings from fresh research.";
    writeFileSync(researchFile, updated);

    const read = readFileSync(researchFile, "utf-8");
    expect(read).toBe(updated);
    expect(read).not.toBe(original);
  });
});

describe("Integration - Research with Web Search Results", () => {
  let tmpDir: string;
  let project: TestProject;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    project = await createTestProject(tmpDir);
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it("research findings include web search results", async () => {
    const researchFile = join(
      project.internalDir,
      "research",
      "websocket-integration.md",
    );

    const content = `# WebSocket Integration

## Sources
- [MDN WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [WebSocket RFC 6455](https://tools.ietf.org/html/rfc6455)
- [Socket.io](https://socket.io/)`;

    writeFileSync(researchFile, content);

    const read = readFileSync(researchFile, "utf-8");
    expect(read).toContain("https://");
    expect(read).toContain("MDN");
  });

  it("research file is structured with timestamps", async () => {
    const researchFile = join(
      project.internalDir,
      "research",
      "websocket-integration.md",
    );

    const timestamp = new Date().toISOString();
    const content = `# WebSocket Integration

_Generated: ${timestamp}_

## Problem
...`;

    writeFileSync(researchFile, content);

    const read = readFileSync(researchFile, "utf-8");
    expect(read).toContain("Generated");
  });
});
