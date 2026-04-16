/**
 * Core Anthropic API caller for the synaphex agent pipeline.
 * Handles think/effort mapping, tool-use loops, and rate-limit retry.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AgentConfig } from "./settings-schema.js";
import { EFFORT_BUDGET_TOKENS } from "./settings-schema.js";
import type {
  AgentRunOptions,
  AgentRunResult,
  AgentToolDef,
  TokenUsage,
} from "./pipeline-types.js";
import { emptyUsage, addUsage } from "./pipeline-types.js";

// Singleton client — lazily initialized
let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable is not set. " +
          "Set it before using synaphex pipeline commands.",
      );
    }
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

/** Map AgentConfig → Anthropic API thinking parameter */
function buildThinkingParam(
  config: AgentConfig,
): { type: "enabled"; budget_tokens: number } | { type: "disabled" } {
  if (!config.think || config.effort === 0) {
    return { type: "disabled" };
  }
  const budget = EFFORT_BUDGET_TOKENS[config.effort];
  return { type: "enabled", budget_tokens: budget };
}

/** Map our tool defs to Anthropic's format */
function toAnthropicTools(tools: AgentToolDef[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
  }));
}

/** Extract token usage from API response */
function extractUsage(response: Anthropic.Message): TokenUsage {
  const u = response.usage;
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    // cache_creation_input_tokens and cache_read_input_tokens are included in input_tokens
    thinkingTokens: 0, // Anthropic doesn't separate thinking tokens in usage
  };
}

/** Sleep helper */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run an agent with the Anthropic Messages API.
 * Handles tool-use loops, thinking configuration, and rate-limit retries.
 */
export async function runAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  const client = getClient();
  const { config, systemPrompt, tools, onToolCall, maxToolRounds = 25 } = opts;

  const thinking = buildThinkingParam(config);
  const anthropicTools =
    tools && tools.length > 0 ? toAnthropicTools(tools) : undefined;

  // Build initial messages in Anthropic format
  const messages: Anthropic.MessageParam[] = opts.messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    // Convert our content blocks to Anthropic format
    const blocks: Anthropic.ContentBlockParam[] = m.content.map((b) => {
      if (b.type === "text") return { type: "text" as const, text: b.text };
      if (b.type === "tool_use") {
        return {
          type: "tool_use" as const,
          id: b.id,
          name: b.name,
          input: b.input,
        };
      }
      if (b.type === "tool_result") {
        return {
          type: "tool_result" as const,
          tool_use_id: b.tool_use_id,
          content: b.content,
          is_error: b.is_error,
        };
      }
      // thinking blocks are not sent back
      return { type: "text" as const, text: "" };
    });
    return { role: m.role, content: blocks };
  });

  let totalUsage = emptyUsage();
  let textOutput = "";
  let thinkingOutput = "";
  let toolRounds = 0;
  let stopReason = "end_turn";

  for (let round = 0; round <= maxToolRounds; round++) {
    const response = await callWithRetry(client, {
      model: config.model,
      max_tokens: thinking.type === "enabled" ? 16000 : 8192,
      system: systemPrompt,
      messages,
      thinking,
      tools: anthropicTools,
    });

    totalUsage = addUsage(totalUsage, extractUsage(response));
    stopReason = response.stop_reason ?? "end_turn";

    // Process content blocks
    const toolUseBlocks: Anthropic.ToolUseBlock[] = [];
    for (const block of response.content) {
      if (block.type === "text") {
        textOutput += block.text;
      } else if (block.type === "thinking") {
        thinkingOutput += block.thinking;
      } else if (block.type === "tool_use") {
        toolUseBlocks.push(block);
      }
    }

    // If no tool calls or no handler, we're done
    if (toolUseBlocks.length === 0 || !onToolCall) {
      break;
    }

    // Handle tool calls
    toolRounds++;

    // Add assistant message with all content blocks
    messages.push({
      role: "assistant",
      content: response.content as Anthropic.ContentBlockParam[],
    });

    // Execute tool calls and build results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolBlock of toolUseBlocks) {
      const result = await onToolCall(
        toolBlock.name,
        toolBlock.input as Record<string, unknown>,
      );
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolBlock.id,
        content: result.content,
        is_error: result.is_error,
      });
    }

    // Add tool results as user message
    messages.push({
      role: "user",
      content: toolResults,
    });

    // If stop reason wasn't tool_use, we're done
    if (stopReason !== "tool_use") {
      break;
    }
  }

  return {
    textOutput,
    thinkingOutput,
    usage: totalUsage,
    toolRounds,
    stopReason,
  };
}

/** Call the API with basic rate-limit retry (429 → 30s, 529 → 60s) */
async function callWithRetry(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  try {
    return await client.messages.create(params);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 429) {
      console.error("[synaphex] Rate limited (429), retrying in 30s...");
      await sleep(30_000);
      return await client.messages.create(params);
    }
    if (status === 529) {
      console.error("[synaphex] Overloaded (529), retrying in 60s...");
      await sleep(60_000);
      return await client.messages.create(params);
    }
    throw err;
  }
}
