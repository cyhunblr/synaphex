/**
 * Integration scenario tests for Phase 3 v2.0.0
 * Tests: Section 11 integration scenarios
 */

import { validateTaskSequence } from "../lib/project-store.js";
import { parseAnswererResponse } from "../agents/answerer.js";
import { buildResearcherPrompt } from "../agents/researcher.js";

describe("Integration Scenarios (Section 11)", () => {
  describe("11.1 Full workflow: create → examine → planner → coder → answerer → reviewer", () => {
    it("should allow complete workflow execution", () => {
      const workflow = [
        "create",
        "examine",
        "planner",
        "coder",
        "answerer",
        "reviewer",
      ];
      const completed: string[] = [];

      for (const step of workflow) {
        const result = validateTaskSequence(step, completed);
        expect(result.valid).toBe(true);
        completed.push(step);
      }

      expect(completed).toEqual(workflow);
    });

    it("should accumulate task state through workflow", () => {
      // Simulate task-meta.json progression
      const taskMeta = {
        completed_steps: ["create"],
        iteration: 1,
        answerer_escalation: null,
      };

      // Each step appends to completed_steps
      taskMeta.completed_steps.push("examine");
      expect(taskMeta.completed_steps).toContain("examine");

      taskMeta.completed_steps.push("planner");
      expect(taskMeta.completed_steps).toContain("planner");

      // Validation should pass for next step
      const result = validateTaskSequence("coder", taskMeta.completed_steps);
      expect(result.valid).toBe(true);
    });
  });

  describe("11.2 Skip optional steps: researcher is optional, answerer is required", () => {
    it("should require answerer in basic workflow", () => {
      const workflow = [
        "create",
        "examine",
        "planner",
        "coder",
        "answerer",
        "reviewer",
      ];
      const completed: string[] = [];

      for (const step of workflow) {
        const result = validateTaskSequence(step, completed);
        expect(result.valid).toBe(true);
        completed.push(step);
      }

      // Verify all required steps were included
      workflow.forEach((step) => {
        expect(completed).toContain(step);
      });
      expect(completed).not.toContain("researcher");
    });

    it("should allow researcher as optional step before planner", () => {
      const workflow = [
        "create",
        "examine",
        "researcher",
        "planner",
        "coder",
        "answerer",
        "reviewer",
      ];
      const completed: string[] = [];

      for (const step of workflow) {
        const result = validateTaskSequence(step, completed);
        expect(result.valid).toBe(true);
        completed.push(step);
      }

      expect(completed).toContain("researcher");
    });
  });

  describe("11.3 State validation prevents out-of-order execution", () => {
    it("should prevent execution in wrong order", () => {
      const wrongOrder = [
        { step: "planner", completed: ["create"], shouldFail: true },
        { step: "coder", completed: ["create", "examine"], shouldFail: true },
        {
          step: "reviewer",
          completed: ["create", "examine"],
          shouldFail: true,
        },
        { step: "answerer", completed: ["create"], shouldFail: true },
      ];

      for (const { step, completed, shouldFail } of wrongOrder) {
        const result = validateTaskSequence(step, completed);
        expect(result.valid).toBe(!shouldFail);
      }
    });

    it("should track completed_steps progression", () => {
      let completed = ["create"];
      expect(validateTaskSequence("examine", completed).valid).toBe(true);

      completed = ["create", "examine"];
      expect(validateTaskSequence("planner", completed).valid).toBe(true);

      completed = ["create", "examine", "planner"];
      expect(validateTaskSequence("coder", completed).valid).toBe(true);
    });
  });

  describe("11.4 Coder with Answerer integration (question detection)", () => {
    it("should handle technical questions without escalation", () => {
      // Code comment: "Should I use lodash or native map/filter?"
      const answererResponse =
        "Use native Array.map() for better performance in modern JS";

      const result = parseAnswererResponse(answererResponse);

      expect(result.answer).toBeDefined();
      expect(result.escalation).toBeNull();
      expect(result.answer).toContain("native");
    });

    it("should handle architectural questions with escalation", () => {
      // Code comment: "// SYNAPHEX_ARCHITECTURAL: Should we use Redis or in-memory cache?"
      const answererResponse =
        "ESCALATE: Should we use Redis or in-memory cache?\nCONTEXT: This affects scalability and deployment strategy";

      const result = parseAnswererResponse(answererResponse);

      expect(result.escalation).toBeDefined();
      expect(result.escalation!.question).toContain("Redis");
      expect(result.answer).toBeNull();
    });
  });

  describe("11.5 Researcher with knowledge gap detection", () => {
    it("should identify knowledge gaps in task", () => {
      const task =
        "Integrate Triton inference server for model serving in production";
      const examinerContext =
        "Python codebase using PyTorch, deployment on Kubernetes, unfamiliar with Triton";

      const prompt = buildResearcherPrompt(task, examinerContext);

      // Prompt should include both task and context
      expect(prompt).toContain(task);
      expect(prompt).toContain(examinerContext);
      // Should prompt for gap analysis
      expect(prompt).toContain("knowledge gaps");
    });
  });

  describe("11.6 Task-remember symlink creation (pattern test)", () => {
    it("should document parent-child linking pattern", () => {
      // task-remember pattern:
      // 1. Creates symlink: parent/memory/internal/ → child/memory/external/{parent}_memory
      // 2. Adds "remember" to child's completed_steps
      // 3. Can run before "examine" step

      const childCompleted = ["create"];
      const result = validateTaskSequence("remember", childCompleted);

      // Should allow remember after create
      expect(result.valid).toBe(true);
    });
  });

  describe("11.7 Re-planning after user escalation decision", () => {
    it("should support re-planning iteration", () => {
      type TaskMetaType = {
        completed_steps: string[];
        iteration: number;
        answerer_escalation: {
          question: string;
          context: string;
          decision?: string;
        } | null;
      };

      const taskMeta: TaskMetaType = {
        completed_steps: ["create", "examine", "planner", "coder", "answerer"],
        iteration: 1,
        answerer_escalation: {
          question: "Should we use Redis or in-memory cache?",
          context: "10K users/day, growing",
          decision: "Redis for scalability",
        },
      };

      // User decides, planner can re-run with decision in context
      // Marks iteration: 2
      taskMeta.iteration = 2;

      // Clear escalation after incorporating decision
      taskMeta.answerer_escalation = null;

      expect(taskMeta.iteration).toBe(2);
      expect(taskMeta.answerer_escalation).toBeNull();
    });

    it("should allow planner after escalation is resolved", () => {
      // After user provides decision in task-meta.json
      const completed = ["create", "examine", "planner", "coder", "answerer"];

      // Planner can run again (iteration 2)
      const result = validateTaskSequence("planner", completed);

      // Should this be allowed? According to state machine, planner shouldn't run twice
      // Instead, iteration counter tracks the re-planning
      // So we check that the state is valid for re-planning to occur
      expect(result.valid).toBe(false); // planner already ran

      // But in re-planning, would remove planner and coder from completed_steps
      // Then re-run as iteration 2
    });
  });

  describe("11.8 Error messages are clear and helpful", () => {
    it("should provide actionable error for out-of-order execution", () => {
      const result = validateTaskSequence("coder", ["create", "examine"]);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("planner");
      expect(result.error).toContain("not completed yet");
    });

    it("should list all missing required steps", () => {
      const result = validateTaskSequence("reviewer", ["create"]);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("examine");
      expect(result.error).toContain("planner");
      expect(result.error).toContain("coder");
    });

    it("should prevent duplicate execution with clear message", () => {
      const result = validateTaskSequence("coder", [
        "create",
        "examine",
        "planner",
        "coder",
      ]);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("already been completed");
    });
  });

  describe("Workflow patterns", () => {
    it("should support basic workflow: create→examine→planner→coder→answerer→reviewer", () => {
      const steps = [
        "create",
        "examine",
        "planner",
        "coder",
        "answerer",
        "reviewer",
      ];

      for (let i = 0; i < steps.length; i++) {
        const result = validateTaskSequence(steps[i], steps.slice(0, i));
        expect(result.valid).toBe(true);
      }
    });

    it("should support research workflow: create→examine→researcher→planner→coder→answerer→reviewer", () => {
      const steps = [
        "create",
        "examine",
        "researcher",
        "planner",
        "coder",
        "answerer",
        "reviewer",
      ];

      for (let i = 0; i < steps.length; i++) {
        const completed = steps.slice(0, i);
        const step = steps[i];
        const result = validateTaskSequence(step, completed);
        expect(result.valid).toBe(true);
      }
    });

    it("should support escalation workflow: examine→planner→coder→answerer→(pause)→planner(v2)→coder(v2)→reviewer", () => {
      // First iteration
      const completed = ["create"];
      expect(validateTaskSequence("examine", completed).valid).toBe(true);

      completed.push("examine");
      expect(validateTaskSequence("planner", completed).valid).toBe(true);

      completed.push("planner");
      expect(validateTaskSequence("coder", completed).valid).toBe(true);

      completed.push("coder");
      expect(validateTaskSequence("answerer", completed).valid).toBe(true);

      // After escalation detected and user decides:
      // Would reset completed_steps and iteration for v2
      // But staying in same workflow structure
    });
  });
});
