/**
 * settings.json schema and defaults. The agent block is scaffolding for
 * Phase 2 — Phase 1 writes it on `create` but does not interpret it.
 */

export const SETTINGS_VERSION = 1;

export type Provider = "claude" | "gemini" | "openai";

export type AgentMode = "direct" | "delegated";

export interface AgentConfig {
  provider: Provider;
  /** Anthropic Messages API model ID (e.g. claude-opus-4-6) */
  model: string;
  /** Whether extended thinking is enabled */
  think: boolean;
  /** 0=disabled, 1=low, 2=medium, 3=high, 4=max — interpreted by Phase 2 */
  effort: 0 | 1 | 2 | 3 | 4;
  /** "direct" = call Anthropic API internally, "delegated" = return prompt to IDE */
  mode: AgentMode;
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
    /** Human-readable label shown in the IDE model switcher */
    label?: string;
    /** alias for the canonical model ID, if any */
    aliases?: string[];
  }
> = {
  // ── Anthropic (Direct Mode) ──────────────────────────────────────────
  "claude-opus-4-6": {
    thinking: true,
    adaptiveThinking: true,
    label: "Claude Opus 4.6",
  },
  "claude-sonnet-4-6": {
    thinking: true,
    adaptiveThinking: true,
    label: "Claude Sonnet 4.6",
  },
  "claude-haiku-4-5": {
    thinking: true,
    adaptiveThinking: false,
    label: "Claude Haiku 4.5",
    aliases: ["claude-haiku-4-5-20251001"],
  },
  // ── Antigravity IDE models (Delegated Mode) ──────────────────────────
  "claude-opus-4-6-thinking": {
    thinking: true,
    adaptiveThinking: true,
    label: "Claude Opus 4.6 (Thinking)",
  },
  "claude-sonnet-4-6-thinking": {
    thinking: true,
    adaptiveThinking: true,
    label: "Claude Sonnet 4.6 (Thinking)",
  },
  "gemini-3.1-pro-high": {
    thinking: true,
    adaptiveThinking: true,
    label: "Gemini 3.1 Pro (high)",
  },
  "gemini-3.1-pro-low": {
    thinking: false,
    adaptiveThinking: false,
    label: "Gemini 3.1 Pro (low)",
  },
  "gemini-3-flash": {
    thinking: false,
    adaptiveThinking: false,
    label: "Gemini 3 Flash",
  },
  "gpt-oss-120b": {
    thinking: false,
    adaptiveThinking: false,
    label: "GPT-OSS-120b",
  },
  // ── VSCode: Claude Code Extension ───────────────────────────────
  // Switch via /model command inside the extension
  "claude-opus-4-6-vscode": {
    thinking: true,
    adaptiveThinking: true,
    label: "Claude Opus 4.6 (Claude Code)",
  },
  "claude-sonnet-4-6-vscode": {
    thinking: true,
    adaptiveThinking: true,
    label: "Claude Sonnet 4.6 (Claude Code)",
  },
  "claude-haiku-4-5-vscode": {
    thinking: false,
    adaptiveThinking: false,
    label: "Claude Haiku 4.5 (Claude Code)",
  },
  // ── VSCode: GitHub Copilot Chat ─────────────────────────────────────
  // Switch via the model picker in the Copilot Chat panel
  "copilot-claude-haiku-4-5": {
    thinking: false,
    adaptiveThinking: false,
    label: "Claude Haiku 4.5 (Copilot)",
  },
  "copilot-gemini-3-flash": {
    thinking: false,
    adaptiveThinking: false,
    label: "Gemini 3 Flash Preview (Copilot)",
  },
  "copilot-gemini-3.1-pro": {
    thinking: true,
    adaptiveThinking: false,
    label: "Gemini 3.1 Pro Preview (Copilot)",
  },
  "copilot-gpt-4o": {
    thinking: false,
    adaptiveThinking: false,
    label: "GPT-4o (Copilot)",
  },
  "copilot-gpt-5-mini": {
    thinking: false,
    adaptiveThinking: false,
    label: "GPT-5 mini (Copilot)",
  },
  "copilot-gpt-5.2": {
    thinking: true,
    adaptiveThinking: false,
    label: "GPT-5.2 (Copilot)",
  },
  "copilot-gpt-5.2-codex": {
    thinking: false,
    adaptiveThinking: false,
    label: "GPT-5.2-Codex (Copilot)",
  },
  "copilot-gpt-5.3-codex": {
    thinking: false,
    adaptiveThinking: false,
    label: "GPT-5.3-Codex (Copilot)",
  },
  "copilot-gpt-5.4-mini": {
    thinking: false,
    adaptiveThinking: false,
    label: "GPT-5.4 mini (Copilot)",
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

export function createDefaultSettings(
  now: Date = new Date(),
): SynaphexSettings {
  return {
    version: SETTINGS_VERSION,
    createdAt: now.toISOString(),
    agents: {
      // Fast scan — Sonnet-level, no extended thinking needed
      examiner: {
        provider: "claude",
        model: "claude-sonnet-4-6-thinking",
        think: false,
        effort: 2,
        mode: "delegated",
      },
      // Deep research — Sonnet with thinking
      researcher: {
        provider: "claude",
        model: "claude-sonnet-4-6-thinking",
        think: true,
        effort: 3,
        mode: "delegated",
      },
      // Architecture planning — Opus with thinking for best reasoning
      planner: {
        provider: "claude",
        model: "claude-opus-4-6-thinking",
        think: true,
        effort: 3,
        mode: "delegated",
      },
      // Fast code generation — Sonnet, no thinking overhead
      coder: {
        provider: "claude",
        model: "claude-sonnet-4-6-thinking",
        think: false,
        effort: 2,
        mode: "delegated",
      },
      // Quick Q&A — Flash is sufficient
      answerer: {
        provider: "gemini",
        model: "gemini-3-flash",
        think: false,
        effort: 1,
        mode: "delegated",
      },
      // Review quality — Opus with thinking for thorough critique
      reviewer: {
        provider: "claude",
        model: "claude-opus-4-6-thinking",
        think: true,
        effort: 3,
        mode: "delegated",
      },
    },
  };
}

/** Short one-line summary of the agent block for `load` digest. */
export function summarizeAgents(settings: SynaphexSettings): string {
  return (Object.keys(settings.agents) as AgentName[])
    .map((name) => {
      const a = settings.agents[name];
      const flags = [a.think ? "think" : null, `e${a.effort}`]
        .filter(Boolean)
        .join("/");
      return `${name}=${a.model}[${flags}]`;
    })
    .join(", ");
}
