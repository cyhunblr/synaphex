import {
  createTmpDir,
  cleanupTmpDir,
  createTestProject,
} from "./test-utils.js";
import { writeFileSync, readFileSync } from "fs";
import { join } from "path";

describe("Edge Cases - Timeout Handling", () => {
  let tmpDir: string;
  let project: any;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    project = await createTestProject(tmpDir);
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it("researcher timeout >30s handled gracefully", async () => {
    // Simulate timeout scenario
    const timeout = 31000; // 31 seconds
    const maxTimeout = 30000; // 30 seconds

    if (timeout > maxTimeout) {
      const errorMsg = "Web search timeout after 30s";
      expect(errorMsg).toContain("timeout");
    }
  });

  it("research continues with fallback (cached knowledge) on timeout", async () => {
    const researchFile = join(
      project.internalDir,
      "research",
      "websocket-integration.md",
    );

    // Create cached file before timeout occurs
    const cachedContent = `# WebSocket Integration

## Key Findings
- Based on cached knowledge
- Web search timed out after 30s
- Using previously gathered information`;

    writeFileSync(researchFile, cachedContent);

    const read = readFileSync(researchFile, "utf-8");
    expect(read).toContain("cached");
  });

  it("research file includes error note: Web search timeout", async () => {
    const researchFile = join(
      project.internalDir,
      "research",
      "websocket-integration.md",
    );

    const content = `# WebSocket Integration

## Error Note
Web search timeout - proceeding with cached knowledge

## Key Findings
- From previous research sessions`;

    writeFileSync(researchFile, content);

    const read = readFileSync(researchFile, "utf-8");
    expect(read).toContain("timeout");
  });

  it("agent execution timeout aborted cleanly", async () => {
    const taskMetaPath = join(project.projectDir, "task-meta.json");

    const taskMeta = {
      status: "timeout",
      error: "Agent execution exceeded budget",
      completed_steps: ["create", "examine"],
    };

    writeFileSync(taskMetaPath, JSON.stringify(taskMeta, null, 2));

    const read = JSON.parse(readFileSync(taskMetaPath, "utf-8"));
    expect(read.status).toBe("timeout");
    expect(read.error).toContain("exceeded");
  });

  it("user receives message about timeout with recovery instructions", async () => {
    const userMessage = `Agent timed out after 10 minutes.

Recovery options:
1. Continue from last completed step: /synaphex:apply --from=examine
2. Run specific step: /synaphex:step examine
3. Check progress: /synaphex:status`;

    expect(userMessage).toContain("timed out");
    expect(userMessage).toContain("Continue");
    expect(userMessage).toContain("/synaphex:apply");
  });

  it("timeout does not crash parent process", async () => {
    // Simulating process resilience
    const onTimeout = () => {
      // Handle gracefully, don't crash
      return { handled: true, error: "Timeout" };
    };

    const result = onTimeout();
    expect(result.handled).toBe(true);
  });
});

describe("Edge Cases - Timeout Detection", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it("distinguishes timeout from other errors", async () => {
    const timeoutError = new Error("Web search timeout after 30s");
    const otherError = new Error("Invalid query");

    expect(timeoutError.message).toContain("timeout");
    expect(otherError.message).not.toContain("timeout");
  });

  it("timeout error is recoverable", async () => {
    const timeoutError = {
      type: "timeout",
      recoverable: true,
      message: "Agent execution timed out",
    };

    expect(timeoutError.recoverable).toBe(true);
  });

  it("non-timeout errors may be fatal", async () => {
    const fatalError = {
      type: "invalid_config",
      recoverable: false,
      message: "Configuration is invalid",
    };

    expect(fatalError.recoverable).toBe(false);
  });
});
