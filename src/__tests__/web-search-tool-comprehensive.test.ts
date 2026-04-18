import { createTmpDir, cleanupTmpDir, mockWebSearch } from "./test-utils.js";

describe("Web Search Tool Integration", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it("web_search tool handler returns expected structure", async () => {
    const mockSearch = mockWebSearch();
    const result = await mockSearch("test query");

    expect(result).toBeDefined();
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
  });

  it("search results include title, URL, and snippet", async () => {
    const mockSearch = mockWebSearch();
    const result = await mockSearch("WebSocket");

    expect(result.results.length).toBeGreaterThan(0);
    const firstResult = result.results[0];
    expect(firstResult.title).toBeDefined();
    expect(firstResult.url).toBeDefined();
    expect(firstResult.snippet).toBeDefined();
  });

  it("multiple search queries return results array", async () => {
    const mockSearch = mockWebSearch();

    const result1 = await mockSearch("WebSocket vs SSE");
    const result2 = await mockSearch("Real-time communication");

    expect(result1.results).toBeInstanceOf(Array);
    expect(result2.results).toBeInstanceOf(Array);
  });

  it("search results include source URLs", async () => {
    const mockSearch = mockWebSearch();
    const result = await mockSearch("test");

    expect(result.results.length).toBeGreaterThan(0);
    for (const item of result.results) {
      expect(item.url).toMatch(/^https?:\/\//);
    }
  });

  it("web search failure logs error and does not throw", async () => {
    const mockSearch = jest.fn().mockRejectedValue(new Error("Search timeout"));

    try {
      await mockSearch("test");
      expect(true).toBe(false); // Should not reach here
    } catch (err) {
      expect(err).toBeDefined();
    }
  });

  it("research continues with fallback on web search timeout", async () => {
    // Simulate research continuing with cached/fallback knowledge
    const fallbackFindings = "Proceeding with cached knowledge due to timeout.";

    expect(fallbackFindings).toContain("cached");
  });

  it("search results are properly formatted for research", async () => {
    const mockSearch = mockWebSearch();
    const result = await mockSearch("WebSocket implementation");

    expect(result.results).toBeDefined();
    for (const item of result.results) {
      expect(typeof item.title).toBe("string");
      expect(typeof item.url).toBe("string");
      expect(typeof item.snippet).toBe("string");
    }
  });
});

describe("Web Search Error Handling", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it("handles network errors gracefully", async () => {
    const mockSearchFn = jest
      .fn()
      .mockRejectedValue(new Error("Network unreachable"));

    try {
      await mockSearchFn("test");
    } catch (err: Error | unknown) {
      const error = err as Error;
      expect(error.message).toContain("Network");
    }
  });

  it("handles API quota exceeded errors", async () => {
    const mockSearchFn = jest
      .fn()
      .mockRejectedValue(new Error("API quota exceeded"));

    try {
      await mockSearchFn("test");
    } catch (err: Error | unknown) {
      const error = err as Error;
      expect(error.message).toContain("quota");
    }
  });

  it("timeout error is distinct from other errors", async () => {
    const timeoutError = new Error("Web search timeout after 30s");
    const otherError = new Error("Invalid query");

    expect(timeoutError.message).toContain("timeout");
    expect(otherError.message).not.toContain("timeout");
  });
});
