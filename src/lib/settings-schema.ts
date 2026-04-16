/**
 * settings.json schema and defaults. The agent block is scaffolding for
 * Phase 2 — Phase 1 writes it on `create` but does not interpret it.
 */

export const SETTINGS_VERSION = 1;

export type Provider = "claude";

export interface AgentConfig {
  provider: Provider;
  /** Anthropic Messages API model ID (e.g. claude-opus-4-6) */
  model: string;
  /** Whether extended thinking is enabled */
  think: boolean;
  /** 0=disabled, 1=low, 2=medium, 3=high, 4=max — interpreted by Phase 2 */
  effort: 0 | 1 | 2 | 3 | 4;
}

export type AgentName =
  | "examiner"
  | "researcher"
  | "planner"
  | "coder"
  | "answerer"
  | "reviewer";

export interface SynaphexSettings {
  version: number;
  createdAt: string;
  agents: Record<AgentName, AgentConfig>;
}

/**
 * Per-model capability table. Phase 2 settings validation will use this to
 * reject invalid combos (e.g. think=true for a model that doesn't support it).
 *
 * - `adaptiveThinking` is true for models that support `thinking: {type: "adaptive"}`
 *   with the native `effort` parameter (Opus 4.6, Sonnet 4.6).
 * - Models with `thinking: true` but `adaptiveThinking: false` only support
 *   manual `budget_tokens` mode (Haiku 4.5).
 * - `effortBudget` maps the synaphex 0-4 scale to `budget_tokens` for manual mode.
 */
export const MODEL_CAPABILITIES: Record<
  string,
  {
    thinking: boolean;
    adaptiveThinking: boolean;
    /** alias for the canonical model ID, if any */
    aliases?: string[];
  }
> = {
  "claude-opus-4-6": { thinking: true, adaptiveThinking: true },
  "claude-sonnet-4-6": { thinking: true, adaptiveThinking: true },
  "claude-haiku-4-5": {
    thinking: true,
    adaptiveThinking: false,
    aliases: ["claude-haiku-4-5-20251001"],
  },
};

/** Synaphex 0..4 effort tier → Anthropic `thinking.budget_tokens` */
export const EFFORT_BUDGET_TOKENS: Record<0 | 1 | 2 | 3 | 4, number> = {
  0: 0,
  1: 5_000,
  2: 15_000,
  3: 25_000,
  4: 32_000,
};

/**
 * Resolve a model string to its canonical ID.
 * Accepts canonical IDs ("claude-opus-4-6") or aliases ("claude-haiku-4-5-20251001").
 * Returns the canonical ID, or null if the model is unknown.
 */
export function resolveModelId(input: string): string | null {
  if (MODEL_CAPABILITIES[input]) return input;
  for (const [canonical, caps] of Object.entries(MODEL_CAPABILITIES)) {
    if (caps.aliases?.includes(input)) return canonical;
  }
  return null;
}

export function createDefaultSettings(now: Date = new Date()): SynaphexSettings {
  return {
    version: SETTINGS_VERSION,
    createdAt: now.toISOString(),
    agents: {
      examiner: { provider: "claude", model: "claude-sonnet-4-6", think: false, effort: 2 },
      researcher: { provider: "claude", model: "claude-sonnet-4-6", think: true, effort: 3 },
      planner: { provider: "claude", model: "claude-opus-4-6", think: true, effort: 3 },
      coder: { provider: "claude", model: "claude-sonnet-4-6", think: false, effort: 2 },
      answerer: { provider: "claude", model: "claude-sonnet-4-6", think: false, effort: 1 },
      reviewer: { provider: "claude", model: "claude-opus-4-6", think: true, effort: 3 },
    },
  };
}

/** Short one-line summary of the agent block for `load` digest. */
export function summarizeAgents(settings: SynaphexSettings): string {
  return (Object.keys(settings.agents) as AgentName[])
    .map((name) => {
      const a = settings.agents[name];
      const flags = [a.think ? "think" : null, `e${a.effort}`].filter(Boolean).join("/");
      return `${name}=${a.model}[${flags}]`;
    })
    .join(", ");
}
