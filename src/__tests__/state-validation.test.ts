/**
 * State validation tests for Phase 3 v2.0.0
 * Tests: 6.4-6.7 from Phase 3 refactoring tasks
 */

import { validateTaskSequence } from "../lib/project-store.js";

describe("State Validation (Section 6)", () => {
  describe("6.4 Test validation: Cannot run planner before examine", () => {
    it("should reject planner if examine not completed", () => {
      const completedSteps = ["create"];
      const result = validateTaskSequence("planner", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("examine");
      expect(result.error).toContain("not completed yet");
    });

    it("should allow planner after examine is completed", () => {
      const completedSteps = ["create", "examine"];
      const result = validateTaskSequence("planner", completedSteps);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe("6.5 Test validation: Can skip researcher", () => {
    it("should allow planner without researcher", () => {
      const completedSteps = ["create", "examine"];
      const result = validateTaskSequence("planner", completedSteps);

      expect(result.valid).toBe(true);
    });

    it("should allow coder without researcher", () => {
      const completedSteps = ["create", "examine", "planner"];
      const result = validateTaskSequence("coder", completedSteps);

      expect(result.valid).toBe(true);
    });

    it("should allow answerer without researcher", () => {
      const completedSteps = ["create", "examine", "planner", "coder"];
      const result = validateTaskSequence("answerer", completedSteps);

      expect(result.valid).toBe(true);
    });

    it("should allow reviewer without researcher", () => {
      const completedSteps = [
        "create",
        "examine",
        "planner",
        "coder",
        "answerer",
      ];
      const result = validateTaskSequence("reviewer", completedSteps);

      expect(result.valid).toBe(true);
    });
  });

  describe("6.6 Test validation: Cannot skip examine", () => {
    it("should reject planner if examine not completed", () => {
      const completedSteps = ["create"];
      const result = validateTaskSequence("planner", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("examine");
    });

    it("should reject coder if examine not completed", () => {
      const completedSteps = ["create", "planner"];
      const result = validateTaskSequence("coder", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("examine");
    });

    it("should reject answerer if examine not completed", () => {
      const completedSteps = ["create", "planner", "coder"];
      const result = validateTaskSequence("answerer", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("examine");
    });

    it("should reject reviewer if examine not completed", () => {
      const completedSteps = ["create", "planner", "coder"];
      const result = validateTaskSequence("reviewer", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("examine");
    });
  });

  describe("6.7 Test validation: Cannot run coder before planner", () => {
    it("should reject coder if planner not completed", () => {
      const completedSteps = ["create", "examine"];
      const result = validateTaskSequence("coder", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("planner");
      expect(result.error).toContain("not completed yet");
    });

    it("should allow coder after planner is completed", () => {
      const completedSteps = ["create", "examine", "planner"];
      const result = validateTaskSequence("coder", completedSteps);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should reject answerer if planner not completed", () => {
      const completedSteps = ["create", "examine", "coder"];
      const result = validateTaskSequence("answerer", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("planner");
    });

    it("should reject reviewer if planner not completed", () => {
      const completedSteps = ["create", "examine", "coder"];
      const result = validateTaskSequence("reviewer", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("planner");
    });
  });

  describe("Additional: Prevent duplicate steps", () => {
    it("should reject running the same step twice", () => {
      const completedSteps = ["create", "examine", "planner"];
      const result = validateTaskSequence("planner", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("already been completed");
    });

    it("should reject running create twice", () => {
      const completedSteps = ["create"];
      const result = validateTaskSequence("create", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("already been completed");
    });
  });

  describe("Additional: Full workflow validation", () => {
    it("should validate complete workflow sequence", () => {
      const steps = [
        "create",
        "examine",
        "planner",
        "coder",
        "answerer",
        "reviewer",
      ];

      for (let i = 0; i < steps.length; i++) {
        const completedSteps = steps.slice(0, i);
        const nextStep = steps[i];
        const result = validateTaskSequence(nextStep, completedSteps);

        expect(result.valid).toBe(true);
      }
    });

    it("should validate workflow with optional steps", () => {
      const steps = [
        "create",
        "remember",
        "examine",
        "researcher",
        "planner",
        "coder",
        "answerer",
        "reviewer",
      ];

      for (let i = 0; i < steps.length; i++) {
        const completedSteps = steps.slice(0, i);
        const nextStep = steps[i];
        const result = validateTaskSequence(nextStep, completedSteps);

        expect(result.valid).toBe(true);
      }
    });

    it("should reject out-of-order execution", () => {
      // Try to run reviewer before planner
      const completedSteps = ["create", "examine"];
      const result = validateTaskSequence("reviewer", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("planner");
    });
  });

  describe("Edge cases", () => {
    it("should handle empty completed steps", () => {
      const result = validateTaskSequence("create", []);
      expect(result.valid).toBe(true);
    });

    it("should reject unknown step", () => {
      const result = validateTaskSequence("unknown-step", ["create"]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Unknown step");
    });

    it("should provide helpful error message with required steps", () => {
      const completedSteps = ["create"];
      const result = validateTaskSequence("coder", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("'examine'");
      expect(result.error).toContain("'planner'");
    });
  });
});
