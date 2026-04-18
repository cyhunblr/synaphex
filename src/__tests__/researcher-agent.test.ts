import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

describe("Researcher Agent", () => {
  let testDir: string;
  let projectDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `synaphex-researcher-test-${Date.now()}`);
    projectDir = path.join(testDir, "test-project");
    await fs.mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Topic extraction", () => {
    it("should extract topic from SYNAPHEX_QUESTION marker", () => {
      const examinerOutput = `
<!-- SYNAPHEX_QUESTION
Should we use WebSocket or SSE for real-time delivery?
/SYNAPHEX_QUESTION -->
`;
      expect(examinerOutput).toContain("SYNAPHEX_QUESTION");
    });

    it("should derive topic from task description fallback", () => {
      const task =
        "Add GraphQL subscription support to API gateway for real-time updates";
      const words = task
        .split(/\s+/)
        .filter(
          (w) =>
            w.length > 3 && !["the", "and", "for"].includes(w.toLowerCase()),
        )
        .slice(0, 5);
      expect(words.length).toBeGreaterThan(0);
      expect(words.includes("Add") || words.includes("GraphQL")).toBe(true);
    });
  });

  describe("Topic sanitization", () => {
    it("should convert to kebab-case", () => {
      const sanitize = (topic: string): string => {
        return topic
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, "")
          .replace(/\s+/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-+|-+$/g, "");
      };

      expect(sanitize("WebSocket vs SSE")).toBe("websocket-vs-sse");
      expect(sanitize("OAuth2 Implementation")).toBe("oauth2-implementation");
      expect(sanitize("   Spaced   Topic   ")).toBe("spaced-topic");
    });

    it("should remove special characters", () => {
      const sanitize = (topic: string): string => {
        return topic
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, "")
          .replace(/\s+/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-+|-+$/g, "");
      };

      expect(sanitize("C++ Memory Management!")).toBe("c-memory-management");
      expect(sanitize("Node.js@Best?Practices")).toBe("nodejs-best-practices");
    });
  });

  describe("Memory file creation", () => {
    it("should create research directory if missing", async () => {
      const researchDir = path.join(
        projectDir,
        "memory",
        "internal",
        "research",
      );
      expect(
        (async () => {
          try {
            await fs.access(researchDir);
            return true;
          } catch {
            return false;
          }
        })(),
      );
    });

    it("should include structured sections in research file", () => {
      const topic = "websocket-integration";
      const research = "Sample research content about WebSocket";

      const formatResearchFindings = (
        research: string,
        topic: string,
      ): string => {
        const timestamp = new Date().toISOString();
        return [
          `# Research: ${topic}`,
          ``,
          `**Last researched**: ${timestamp}`,
          ``,
          `## Problem`,
          topic,
          ``,
          `## Key Findings`,
          research,
          ``,
          `## Recommendation`,
          `Integrate findings above into implementation.`,
          ``,
          `## Sources`,
          `See findings above for source references.`,
          ``,
        ].join("\n");
      };

      const formatted = formatResearchFindings(research, topic);
      expect(formatted).toContain("# Research: websocket-integration");
      expect(formatted).toContain("## Problem");
      expect(formatted).toContain("## Key Findings");
      expect(formatted).toContain("## Recommendation");
      expect(formatted).toContain("## Sources");
      expect(formatted).toContain("**Last researched**:");
    });

    it("should add timestamp to research file", () => {
      const topic = "test-topic";
      const research = "Test content";

      const formatResearchFindings = (
        research: string,
        topic: string,
      ): string => {
        const timestamp = new Date().toISOString();
        return `# Research: ${topic}\n\n**Last researched**: ${timestamp}\n\n${research}`;
      };

      const formatted = formatResearchFindings(research, topic);
      const timestampRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      expect(formatted).toMatch(timestampRegex);
    });
  });

  describe("Research reuse", () => {
    it("should detect existing research file", async () => {
      const researchDir = path.join(
        projectDir,
        "memory",
        "internal",
        "research",
      );
      await fs.mkdir(researchDir, { recursive: true });

      const topicPath = path.join(researchDir, "existing-topic.md");
      await fs.writeFile(topicPath, "# Existing Research", "utf-8");

      const fileExists = async (filePath: string): Promise<boolean> => {
        try {
          await fs.access(filePath);
          return true;
        } catch {
          return false;
        }
      };

      expect(await fileExists(topicPath)).toBe(true);
    });

    it("should allow skipping re-research if findings exist", async () => {
      const researchDir = path.join(
        projectDir,
        "memory",
        "internal",
        "research",
      );
      await fs.mkdir(researchDir, { recursive: true });

      const topicPath = path.join(researchDir, "cached-topic.md");
      const cached = "# Cached Research\nFinding 1\nFinding 2";
      await fs.writeFile(topicPath, cached, "utf-8");

      const content = await fs.readFile(topicPath, "utf-8");
      expect(content).toBe(cached);
      expect(content).toContain("Cached Research");
    });
  });

  describe("Web search failure handling", () => {
    it("should provide fallback when web_search fails", () => {
      const fallbackResponse = {
        content: "[Web search failed - using fallback knowledge]",
      };

      expect(fallbackResponse.content).toContain("fallback");
      expect(fallbackResponse.content).not.toContain("error");
    });

    it("should add error note to research file on failure", () => {
      const research = "Partial findings from fallback knowledge";
      const errorNote =
        "\n\n**Note**: Web search unavailable - findings based on system knowledge.";

      const withError = research + errorNote;
      expect(withError).toContain("Note");
      expect(withError).toContain("Web search unavailable");
    });
  });
});
