/**
 * State validation tests for Phase 3 v2.0.0 discrete commands
 * Tests validateTaskSequence with new step names: examine, plan, implement, review
 */

import { validateTaskSequence } from "../lib/project-store.js";

describe("State Validation (Section 6)", () => {
  describe("6.1 Test validation: Cannot run plan before examine", () => {
    it("should reject plan if examine not completed", () => {
      const completedSteps = ["create"];
      const result = validateTaskSequence("plan", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("examine");
      expect(result.error).toContain("not completed yet");
    });

    it("should allow plan after examine is completed", () => {
      const completedSteps = ["create", "examine"];
      const result = validateTaskSequence("plan", completedSteps);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe("6.2 Test validation: Can skip researcher", () => {
    it("should allow plan without researcher", () => {
      const completedSteps = ["create", "examine"];
      const result = validateTaskSequence("plan", completedSteps);

      expect(result.valid).toBe(true);
    });

    it("should allow implement without researcher", () => {
      const completedSteps = ["create", "examine", "plan"];
      const result = validateTaskSequence("implement", completedSteps);

      expect(result.valid).toBe(true);
    });

    it("should allow answerer without researcher", () => {
      const completedSteps = ["create", "examine", "plan", "implement"];
      const result = validateTaskSequence("answerer", completedSteps);

      expect(result.valid).toBe(true);
    });

    it("should allow review without researcher", () => {
      const completedSteps = ["create", "examine", "plan", "implement"];
      const result = validateTaskSequence("review", completedSteps);

      expect(result.valid).toBe(true);
    });
  });

  describe("6.3 Test validation: Cannot skip examine", () => {
    it("should reject plan if examine not completed", () => {
      const completedSteps = ["create"];
      const result = validateTaskSequence("plan", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("examine");
    });

    it("should reject implement if examine not completed", () => {
      const completedSteps = ["create", "plan"];
      const result = validateTaskSequence("implement", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("examine");
    });

    it("should allow answerer without examine completed", () => {
      // answerer has no hard dependencies, can be called anytime
      const completedSteps = ["create"];
      const result = validateTaskSequence("answerer", completedSteps);

      expect(result.valid).toBe(true);
    });

    it("should reject review if examine not completed", () => {
      const completedSteps = ["create", "plan", "implement"];
      const result = validateTaskSequence("review", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("examine");
    });
  });

  describe("6.4 Test validation: Cannot run implement before plan", () => {
    it("should reject implement if plan not completed", () => {
      const completedSteps = ["create", "examine"];
      const result = validateTaskSequence("implement", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("plan");
      expect(result.error).toContain("not completed yet");
    });

    it("should allow implement after plan is completed", () => {
      const completedSteps = ["create", "examine", "plan"];
      const result = validateTaskSequence("implement", completedSteps);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should allow answerer without plan completed", () => {
      // answerer is optional with no hard dependencies
      const completedSteps = ["create", "examine"];
      const result = validateTaskSequence("answerer", completedSteps);

      expect(result.valid).toBe(true);
    });

    it("should reject review if plan not completed", () => {
      const completedSteps = ["create", "examine", "implement"];
      const result = validateTaskSequence("review", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("plan");
    });
  });

  describe("6.5 Test validation: Phase reruns allowed", () => {
    it("should initially reject phase rerun", () => {
      const completedSteps = ["create", "examine"];
      const result = validateTaskSequence("examine", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("already been completed");
    });

    it("should reject plan rerun after completion", () => {
      const completedSteps = ["create", "examine", "plan"];
      const result = validateTaskSequence("plan", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("already been completed");
    });
  });

  describe("Additional: Full workflow validation", () => {
    it("should validate complete workflow sequence", () => {
      const steps = ["create", "examine", "plan", "implement", "review"];

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
        "plan",
        "implement",
        "answerer",
        "review",
      ];

      for (let i = 0; i < steps.length; i++) {
        const completedSteps = steps.slice(0, i);
        const nextStep = steps[i];
        const result = validateTaskSequence(nextStep, completedSteps);

        expect(result.valid).toBe(true);
      }
    });

    it("should reject out-of-order execution", () => {
      // Try to run review before plan
      const completedSteps = ["create", "examine"];
      const result = validateTaskSequence("review", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("plan");
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
      const result = validateTaskSequence("implement", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("'examine'");
      expect(result.error).toContain("'plan'");
    });

    it("should reject review without implement", () => {
      const completedSteps = ["create", "examine", "plan"];
      const result = validateTaskSequence("review", completedSteps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("implement");
    });
  });
});
