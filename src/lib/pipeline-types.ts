/**
 * Shared types for the synaphex agent pipeline.
 */

import type { AgentConfig } from "./settings-schema.js";

// === Task metadata ===

export interface TaskMeta {
  project: string;
  slug: string;
  task: string;
  cwd: string;
  mode: "task" | "fix";
  createdAt: string;
  reviewMode?: "agent" | "user" | "ask" | "skip";
  iteration: number;
  status:
    | "created"
    | "examining"
    | "planning"
    | "implementing"
    | "reviewing"
    | "done"
    | "cancelled";
}

// === Token accounting ===

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
}

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    thinkingTokens: a.thinkingTokens + b.thinkingTokens,
  };
}

// === Agent runtime ===

export interface AgentMessage {
  role: "user" | "assistant";
  content: string | AgentContentBlock[];
}

export type AgentContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

export interface AgentToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ToolCallHandler = (
  name: string,
  input: Record<string, unknown>,
) => Promise<{ content: string; is_error?: boolean }>;

export interface AgentRunOptions {
  config: AgentConfig;
  systemPrompt: string;
  messages: AgentMessage[];
  tools?: AgentToolDef[];
  onToolCall?: ToolCallHandler;
  maxToolRounds?: number;
}

export interface AgentRunResult {
  textOutput: string;
  thinkingOutput: string;
  usage: TokenUsage;
  toolRounds: number;
  stopReason: string;
}

// === Pipeline step results ===

export interface TaskStartResult {
  slug: string;
  taskDir: string;
  memoryDigest: string;
  settingsSummary: string;
}

export interface ExamineResult {
  compactOutput: string;
  rawOutput: string;
  usage: TokenUsage;
}

export interface PlanResult {
  plan: string;
  usage: TokenUsage;
}

export interface ImplementResult {
  filesCreated: string[];
  filesModified: string[];
  filesDeleted: string[];
  summary: string;
  escalation: { question: string; context: string } | null;
  usage: TokenUsage;
}

export interface ReviewResult {
  verdict: "approved" | "needs_changes";
  reviewText: string;
  feedbackForPlanner: string;
  usage: TokenUsage;
}
