import { describe, it, expect } from "@jest/globals";
import {
  validateSettings,
  normalizeSettings,
  SUPPORTED_MODELS,
} from "../lib/settings-schema.js";

describe("Settings Schema Validation", () => {
  describe("Model validation", () => {
    it("should accept valid Anthropic models", () => {
      const config = { provider: "anthropic", model: "claude-opus-4-7" };
      const result = validateSettings(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject unsupported models", () => {
      const config = { provider: "anthropic", model: "unknown-model" };
      const result = validateSettings(config);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should reject non-anthropic provider", () => {
      const config = { provider: "openai", model: "gpt-4" };
      const result = validateSettings(config);
      expect(result.valid).toBe(false);
    });
  });

  describe("Think field validation", () => {
    it("should allow think: true for Opus", () => {
      const config = {
        provider: "anthropic",
        model: "claude-opus-4-7",
        think: true,
      };
      const result = validateSettings(config);
      expect(result.valid).toBe(true);
    });

    it("should allow think: true for Sonnet", () => {
      const config = {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        think: true,
      };
      const result = validateSettings(config);
      expect(result.valid).toBe(true);
    });

    it("should reject think: true for Haiku", () => {
      const config = {
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        think: true,
      };
      const result = validateSettings(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e: string) => e.includes("thinking"))).toBe(
        true,
      );
    });

    it("should allow think: false for all models", () => {
      for (const model of SUPPORTED_MODELS) {
        const config = { provider: "anthropic", model, think: false };
        const result = validateSettings(config);
        expect(result.valid).toBe(true);
      }
    });
  });

  describe("Effort field validation", () => {
    it("should accept effort 0-4 for Opus", () => {
      for (let effort = 0; effort <= 4; effort++) {
        const config = {
          provider: "anthropic",
          model: "claude-opus-4-7",
          think: effort > 0 ? true : false,
          effort,
        };
        const result = validateSettings(config);
        expect(result.valid).toBe(true);
      }
    });

    it("should accept effort 0-4 for Sonnet", () => {
      for (let effort = 0; effort <= 4; effort++) {
        const config = {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          think: effort > 0 ? true : false,
          effort,
        };
        const result = validateSettings(config);
        expect(result.valid).toBe(true);
      }
    });

    it("should only allow effort 0 for Haiku", () => {
      const config = {
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        effort: 1,
      };
      const result = validateSettings(config);
      expect(result.valid).toBe(false);
    });

    it("should reject effort > 4", () => {
      const config = {
        provider: "anthropic",
        model: "claude-opus-4-7",
        think: true,
        effort: 5,
      };
      const result = validateSettings(config);
      expect(result.valid).toBe(false);
    });

    it("should reject negative effort", () => {
      const config = {
        provider: "anthropic",
        model: "claude-opus-4-7",
        think: true,
        effort: -1,
      };
      const result = validateSettings(config);
      expect(result.valid).toBe(false);
    });
  });

  describe("Effort constraint validation", () => {
    it("should require think: true when effort > 0", () => {
      const config = {
        provider: "anthropic",
        model: "claude-opus-4-7",
        think: false,
        effort: 2,
      };
      const result = validateSettings(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Effort > 0"))).toBe(true);
    });

    it("should allow effort > 0 with think: true", () => {
      const config = {
        provider: "anthropic",
        model: "claude-opus-4-7",
        think: true,
        effort: 3,
      };
      const result = validateSettings(config);
      expect(result.valid).toBe(true);
    });
  });

  describe("normalizeSettings", () => {
    it("should provide defaults for partial config", () => {
      const partial = { model: "claude-sonnet-4-6" };
      const normalized = normalizeSettings(partial);

      expect(normalized.provider).toBe("anthropic");
      expect(normalized.model).toBe("claude-sonnet-4-6");
      expect(normalized.think).toBe(true);
      expect(normalized.effort).toBe(0);
    });

    it("should use model-specific defaults", () => {
      const partial = { model: "claude-haiku-4-5-20251001" };
      const normalized = normalizeSettings(partial);

      expect(normalized.think).toBe(false);
      expect(normalized.effort).toBe(0);
    });

    it("should preserve explicit values", () => {
      const config = {
        provider: "anthropic",
        model: "claude-opus-4-7",
        think: true,
        effort: 2,
      };
      const normalized = normalizeSettings(config);

      expect(normalized.think).toBe(true);
      expect(normalized.effort).toBe(2);
    });
  });

  describe("Error messages", () => {
    it("should provide clear error messages for validation failures", () => {
      const config = {
        provider: "wrong-provider",
        model: "wrong-model",
        think: true,
        effort: 5,
      };
      const result = validateSettings(config);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(
        result.errors.some(
          (e: string) => e.includes("provider") || e.includes("Provider"),
        ),
      ).toBe(true);
      expect(
        result.errors.some(
          (e: string) => e.includes("model") || e.includes("Model"),
        ),
      ).toBe(true);
    });
  });
});
