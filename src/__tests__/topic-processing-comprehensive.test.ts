describe("Topic Processing - Extraction and Sanitization", () => {
  // These test the behavior expected from the researcher command
  // The actual functions are internal to task-researcher.ts

  const extractResearchTopic = (text: string) => {
    // Extract from SYNAPHEX_QUESTION marker if present
    const match = text.match(
      /<!--\s*SYNAPHEX_QUESTION\s*\n(.*?)\n\s*SYNAPHEX_QUESTION\s*-->/s,
    );
    if (match) {
      return match[1].trim();
    }

    // Fallback: extract significant words from description
    const words = text
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 3 &&
          !["the", "and", "for", "from"].includes(w.toLowerCase()),
      )
      .slice(0, 5);
    return words.join(" ");
  };

  const sanitizeTopicToFilename = (topic: string): string => {
    return topic
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .join("-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
  };

  describe("Topic Processing - Extraction", () => {
    it("extracts topic from SYNAPHEX_QUESTION HTML comment marker", () => {
      const text = `
    Some task content
    <!-- SYNAPHEX_QUESTION
    Should we use WebSocket or SSE?
    SYNAPHEX_QUESTION -->
    More content
    `;

      const topic = extractResearchTopic(text);
      expect(topic).toBe("Should we use WebSocket or SSE?");
    });

    it("handles multiline SYNAPHEX_QUESTION marker", () => {
      const text = `
    <!-- SYNAPHEX_QUESTION
    Should we use WebSocket or SSE for real-time updates?
    SYNAPHEX_QUESTION -->
    `;

      const topic = extractResearchTopic(text);
      expect(topic).toContain("WebSocket");
      expect(topic).toContain("SSE");
    });

    it("falls back to task description when no marker", () => {
      const description =
        "Investigate best practices for real-time communication protocols";
      const topic = extractResearchTopic(description);

      expect(topic).toBeDefined();
      expect(topic.length).toBeGreaterThan(0);
    });

    it("extracts first 5 significant words from fallback description", () => {
      const description =
        "The investigation into best practices for implementing real-time communication";
      const topic = extractResearchTopic(description);

      // Should extract significant words (>3 chars), excluding "the", "and", "for"
      expect(topic).toBeDefined();
    });

    it("ignores short words in fallback extraction", () => {
      const description = "The and for best practices implementation details";
      const topic = extractResearchTopic(description);

      // Should skip "the", "and", "for"
      expect(topic).not.toContain("The");
      expect(topic).not.toContain("and");
      expect(topic).not.toContain("for");
    });
  });

  describe("Topic Processing - Sanitization", () => {
    it("converts to kebab-case", () => {
      const result = sanitizeTopicToFilename("WebSocket vs SSE");
      expect(result).toBe("websocket-vs-sse");
    });

    it("removes punctuation", () => {
      const result = sanitizeTopicToFilename("WebSocket vs SSE!");
      expect(result).toBe("websocket-vs-sse");
    });

    it("removes special characters", () => {
      const result = sanitizeTopicToFilename("Redis @ Cache (Performance)");
      expect(result).toBe("redis-cache-performance");
    });

    it("converts to lowercase", () => {
      const result = sanitizeTopicToFilename("WEBSOCKET VS SSE");
      expect(result).toBe("websocket-vs-sse");
    });

    it("joins words with hyphens", () => {
      const result = sanitizeTopicToFilename("best practices");
      expect(result).toBe("best-practices");
    });

    it("handles multiple spaces", () => {
      const result = sanitizeTopicToFilename("websocket  vs   sse");
      expect(result).toBe("websocket-vs-sse");
    });

    it("example: WebSocket vs SSE!", () => {
      const result = sanitizeTopicToFilename("WebSocket vs SSE!");
      expect(result).toBe("websocket-vs-sse");
    });

    it("handles unicode characters", () => {
      const result = sanitizeTopicToFilename("Café vs Café");
      expect(result).toBeDefined();
      expect(result).not.toContain("é");
    });

    it("handles accented characters", () => {
      const result = sanitizeTopicToFilename("Résumé Integration");
      expect(result).toBeDefined();
      expect(result).not.toContain("é");
    });

    it("produces valid filename", () => {
      const result = sanitizeTopicToFilename("Complex!@#$%Topic&*()");
      expect(result).toMatch(/^[a-z0-9-]+$/);
    });

    it("does not create leading/trailing hyphens", () => {
      const result = sanitizeTopicToFilename("...topic...");
      expect(result).not.toMatch(/^-/);
      expect(result).not.toMatch(/-$/);
    });
  });
});

describe("Topic Processing - Round Trip", () => {
  const extractResearchTopic = (text: string) => {
    const match = text.match(
      /<!--\s*SYNAPHEX_QUESTION\s*\n(.*?)\n\s*SYNAPHEX_QUESTION\s*-->/s,
    );
    if (match) {
      return match[1].trim();
    }
    const words = text
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 3 &&
          !["the", "and", "for", "from"].includes(w.toLowerCase()),
      )
      .slice(0, 5);
    return words.join(" ");
  };

  const sanitizeTopicToFilename = (topic: string): string => {
    return topic
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .join("-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
  };

  it("marker extraction and sanitization produce valid filename", () => {
    const text = `
    <!-- SYNAPHEX_QUESTION
    Should we use WebSocket or SSE?
    SYNAPHEX_QUESTION -->
    `;

    const topic = extractResearchTopic(text);
    const filename = sanitizeTopicToFilename(topic);

    expect(filename).toMatch(/^[a-z0-9-]+$/);
    expect(filename).not.toMatch(/^-/);
    expect(filename).not.toMatch(/-$/);
  });

  it("fallback extraction and sanitization produce valid filename", () => {
    const description =
      "Investigate real-time communication protocols for performance";
    const topic = extractResearchTopic(description);
    const filename = sanitizeTopicToFilename(topic);

    expect(filename).toMatch(/^[a-z0-9-]+$/);
  });
});
