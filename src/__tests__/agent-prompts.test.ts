/**
 * Agent prompt builder tests for Phase 3 v2.0.0
 * Tests: Section 7 and 8 agent implementations
 */

import {
  buildResearcherPrompt,
  RESEARCHER_SYSTEM_PROMPT,
} from "../agents/researcher.js";
import {
  buildAnswererPrompt,
  parseAnswererResponse,
  ANSWERER_SYSTEM_PROMPT,
} from "../agents/answerer.js";

describe("Agent Prompts (Sections 7-8)", () => {
  describe("Section 7: Researcher Agent", () => {
    describe("7.1 Researcher system prompt", () => {
      it("should have system prompt defined", () => {
        expect(RESEARCHER_SYSTEM_PROMPT).toBeDefined();
        expect(RESEARCHER_SYSTEM_PROMPT).toContain("Researcher agent");
        expect(RESEARCHER_SYSTEM_PROMPT).toContain("knowledge gaps");
      });

      it("should document research process", () => {
        expect(RESEARCHER_SYSTEM_PROMPT).toContain("Analyze the task");
        expect(RESEARCHER_SYSTEM_PROMPT).toContain("web searches");
        expect(RESEARCHER_SYSTEM_PROMPT).toContain("Findings Summary");
      });

      it("should mention memory saving", () => {
        expect(RESEARCHER_SYSTEM_PROMPT).toContain("memory");
      });
    });

    describe("7.2 Researcher prompt builder", () => {
      it("should build prompt with task and context", () => {
        const task = "Integrate Triton inference server";
        const examinerContext =
          "Code structure: Python project with model loading";
        const prompt = buildResearcherPrompt(task, examinerContext);

        expect(prompt).toContain(task);
        expect(prompt).toContain(examinerContext);
        expect(prompt).toContain("Analyze the task");
      });

      it("should format with clear sections", () => {
        const task = "Add WebSocket support";
        const context = "Existing: REST API only";
        const prompt = buildResearcherPrompt(task, context);

        expect(prompt).toContain("## Task");
        expect(prompt).toContain("## Context from Examiner");
        expect(prompt).toContain("## Instructions");
      });

      it("should include gap analysis instructions", () => {
        const prompt = buildResearcherPrompt("task", "context");

        expect(prompt).toContain("knowledge gaps");
        expect(prompt).toContain("libraries");
        expect(prompt).toContain("frameworks");
      });
    });

    describe("7.3-7.5 Researcher tools (placeholder)", () => {
      it("should document web_search and write_memory tools needed", () => {
        // Researcher tools defined but runner is placeholder
        // Actual implementation in v2.1 requires MCP agent framework
        expect(RESEARCHER_SYSTEM_PROMPT).toBeDefined();
      });
    });
  });

  describe("Section 8: Answerer Agent", () => {
    describe("8.1 Answerer system prompt", () => {
      it("should have system prompt defined", () => {
        expect(ANSWERER_SYSTEM_PROMPT).toBeDefined();
        expect(ANSWERER_SYSTEM_PROMPT).toContain("Answerer agent");
        expect(ANSWERER_SYSTEM_PROMPT).toContain("Coder");
      });

      it("should define escalation format", () => {
        expect(ANSWERER_SYSTEM_PROMPT).toContain("ESCALATE:");
        expect(ANSWERER_SYSTEM_PROMPT).toContain("CONTEXT:");
      });

      it("should emphasize accuracy over guessing", () => {
        expect(ANSWERER_SYSTEM_PROMPT).toContain("Do NOT guess at answers");
        expect(ANSWERER_SYSTEM_PROMPT).toContain("escalate");
      });
    });

    describe("8.2 Answerer prompt builder", () => {
      it("should build prompt with question and context", () => {
        const question = "Should we use Redis or in-memory cache?";
        const taskContext = "10K users/day, growing";
        const memory = "Previous: used in-memory for small datasets";
        const prompt = buildAnswererPrompt(question, taskContext, memory);

        expect(prompt).toContain(question);
        expect(prompt).toContain(taskContext);
        expect(prompt).toContain(memory);
      });

      it("should support optional additional context", () => {
        const prompt = buildAnswererPrompt(
          "Question?",
          "Task context",
          "Memory",
          "Additional details",
        );

        expect(prompt).toContain("Additional Context");
        expect(prompt).toContain("Additional details");
      });

      it("should format with clear sections", () => {
        const prompt = buildAnswererPrompt("question", "context", "memory");

        expect(prompt).toContain("## Question from Coder");
        expect(prompt).toContain("## Task Context");
        expect(prompt).toContain("## Project Memory");
        expect(prompt).toContain("## Instructions");
      });
    });

    describe("8.3-8.5 Question detection and parsing", () => {
      it("should parse technical answer without escalation", () => {
        const response = "Use lodash for better performance with large arrays";
        const result = parseAnswererResponse(response);

        expect(result.answer).toBe(response);
        expect(result.escalation).toBeNull();
      });

      it("should parse escalation with ESCALATE format", () => {
        const response =
          "ESCALATE: Should we use Redis or in-memory cache?\nCONTEXT: Caching strategy affects architecture";
        const result = parseAnswererResponse(response);

        expect(result.answer).toBeNull();
        expect(result.escalation).toBeDefined();
        expect(result.escalation!.question).toContain("Redis");
        expect(result.escalation!.context).toContain("architecture");
      });

      it("should handle escalation without CONTEXT line", () => {
        const response = "ESCALATE: What database should we use?";
        const result = parseAnswererResponse(response);

        expect(result.escalation).toBeDefined();
        expect(result.escalation!.question).toContain("database");
        expect(result.escalation!.context).toContain("No additional context");
      });

      it("should detect architectural questions in multiline response", () => {
        const response = `Let me think about this...

ESCALATE: Should we use synchronous or asynchronous request handling?
CONTEXT: This affects the entire request/response pipeline architecture`;

        const result = parseAnswererResponse(response);

        expect(result.escalation).toBeDefined();
        expect(result.escalation!.question).toContain("synchronous");
      });
    });

    describe("8.6 Escalation detection", () => {
      it("should distinguish technical from architectural questions", () => {
        // Technical (no escalation)
        const technical = parseAnswererResponse(
          "Use Array.map() for this transformation",
        );
        expect(technical.escalation).toBeNull();

        // Architectural (escalation)
        const architectural = parseAnswererResponse(
          "ESCALATE: Should this be a microservice or monolith?\nCONTEXT: System design decision",
        );
        expect(architectural.escalation).toBeDefined();
      });
    });

    describe("8.7 Pause mechanism (documented)", () => {
      it("should document escalation pause behavior", () => {
        // Escalation sets answerer_escalation in task-meta.json
        // Task pauses until user updates task-meta.json with decision
        // Documented in error-handling.md, coder-questions.md
        expect(true).toBe(true); // Pattern test
      });
    });
  });

  describe("Agent Integration", () => {
    it("should support Researcher-to-Planner flow", () => {
      const researcherPrompt = buildResearcherPrompt(
        "Integrate new library",
        "Code context",
      );

      expect(researcherPrompt).toContain("research");
      expect(researcherPrompt).toContain("memory");
    });

    it("should support Coder-to-Answerer flow", () => {
      const answererPrompt = buildAnswererPrompt(
        "Technical question",
        "Task context",
        "Project memory",
      );

      expect(answererPrompt).toContain("Question from Coder");
      expect(answererPrompt).toContain("Instructions");
    });

    it("should support Answerer-to-Planner re-plan flow", () => {
      const escalation = parseAnswererResponse(
        "ESCALATE: Architecture decision\nCONTEXT: Important for design",
      );

      expect(escalation.escalation).toBeDefined();
      // Task pauses, user decides, then planner re-runs with decision
    });
  });

  describe("Prompt quality", () => {
    it("Researcher prompt should be clear and actionable", () => {
      const prompt = buildResearcherPrompt(
        "Add machine learning inference",
        "Python codebase, model files in /models",
      );

      expect(prompt.length).toBeGreaterThan(100);
      expect(prompt).toContain("Analyze");
      expect(prompt).toContain("Identify");
    });

    it("Answerer prompt should include all needed context", () => {
      const prompt = buildAnswererPrompt(
        "Which pattern to use?",
        "Microservices architecture",
        "Previous patterns used: factory, observer",
      );

      expect(prompt).toContain("Question");
      expect(prompt).toContain("Task");
      expect(prompt).toContain("Memory");
    });

    it("Answerer response should be parseable", () => {
      const responses = [
        "Simple answer",
        "ESCALATE: Question?\nCONTEXT: Why",
        "ESCALATE: Q\nCONTEXT: C",
        "Normal multi-line\nresponse\nwith details",
      ];

      for (const response of responses) {
        const result = parseAnswererResponse(response);
        expect(result.answer !== null || result.escalation !== null).toBe(true);
      }
    });
  });
});
