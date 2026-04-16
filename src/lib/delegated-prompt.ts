/**
 * delegated-prompt.ts — Builds agent instruction packets for IDE model delegation.
 * When mode is "delegated", instead of calling the Anthropic API directly,
 * these helpers format the agent's system prompt + context as a response
 * that the IDE model can act on using its own capabilities.
 */

import type {
  AgentConfig,
  AgentName,
  SynaphexSettings,
} from "./settings-schema.js";
import { MODEL_CAPABILITIES } from "./settings-schema.js";

/** Agent display names for user-friendly output */
const AGENT_LABELS: Record<string, string> = {
  examiner: "Examiner",
  planner: "Planner",
  coder: "Coder",
  reviewer: "Reviewer",
  researcher: "Researcher",
  answerer: "Answerer",
};

/** Pipeline order for next-agent lookup */
const PIPELINE_ORDER: AgentName[] = [
  "examiner",
  "planner",
  "coder",
  "reviewer",
];

/**
 * Build a model-switch advisory if the next agent has different settings.
 */
function buildTransitionNote(
  currentAgent: AgentName,
  settings: SynaphexSettings,
): string {
  const currentIdx = PIPELINE_ORDER.indexOf(currentAgent);
  if (currentIdx === -1 || currentIdx >= PIPELINE_ORDER.length - 1) {
    return ""; // Last agent or not in pipeline
  }

  const nextAgentName = PIPELINE_ORDER[currentIdx + 1];
  const current = settings.agents[currentAgent];
  const next = settings.agents[nextAgentName];

  const sameModel = current.model === next.model;
  const sameThink = current.think === next.think;

  if (sameModel && sameThink) {
    return [
      "",
      `> ✅ Next agent (**${AGENT_LABELS[nextAgentName]}**) uses the same model — no switch needed.`,
    ].join("\n");
  }

  const nextLabel = MODEL_CAPABILITIES[next.model]?.label ?? next.model;
  const currentLabel =
    MODEL_CAPABILITIES[current.model]?.label ?? current.model;

  const thinkNote = next.think
    ? " with extended thinking enabled"
    : " with thinking disabled";

  return [
    "",
    `> ⚠️ **Model Switch Recommended**`,
    `> Next agent: **${AGENT_LABELS[nextAgentName]}** — configured for **${nextLabel}**${thinkNote}.`,
    `> Current model: ${currentLabel} (think: ${current.think}, effort: ${current.effort})`,
    `> Please switch your IDE model to **"${nextLabel}"** before calling the next pipeline step.`,
  ].join("\n");
}

/**
 * Format the next-step command hint for the IDE model.
 */
function buildNextStepHint(
  agentName: AgentName,
  project: string,
  slug: string,
  task: string,
  cwd: string,
): string {
  switch (agentName) {
    case "examiner":
      return [
        `## Next Step`,
        `Once your analysis is complete, pass the result to the Planner:`,
        "```",
        `task_plan(project: "${project}", slug: "${slug}",`,
        `  task: "${task}", cwd: "${cwd}",`,
        `  examiner_compact: "YOUR_COMPACT_ANALYSIS_OUTPUT")`,
        "```",
      ].join("\n");

    case "planner":
      return [
        `## Next Step`,
        `Once your plan is ready, pass it to the Coder:`,
        "```",
        `task_implement(project: "${project}", slug: "${slug}",`,
        `  task: "${task}", cwd: "${cwd}",`,
        `  plan: "YOUR_PLAN_OUTPUT",`,
        `  examiner_compact: "...", memory_digest: "...")`,
        "```",
      ].join("\n");

    case "coder":
      return [
        `## Next Step`,
        `Once implementation is complete, pass a summary to the Reviewer:`,
        "```",
        `task_review(project: "${project}", slug: "${slug}",`,
        `  task: "${task}", cwd: "${cwd}",`,
        `  plan: "...", implementation_summary: "YOUR_IMPLEMENTATION_SUMMARY",`,
        `  examiner_compact: "...")`,
        "```",
      ].join("\n");

    case "reviewer":
      return [
        `## Next Step`,
        `- If APPROVED → Pipeline complete! 🎉`,
        `- If NEEDS_CHANGES → Pass the feedback back to task_plan as reviewer_feedback.`,
      ].join("\n");

    default:
      return "";
  }
}

export interface DelegatedPromptOptions {
  agentName: AgentName;
  systemPrompt: string;
  userContext: string;
  project: string;
  slug: string;
  task: string;
  cwd: string;
  settings: SynaphexSettings;
  config: AgentConfig;
}

/**
 * Build the full delegated instruction packet that gets returned to the IDE model.
 */
export function buildDelegatedPrompt(opts: DelegatedPromptOptions): string {
  const label = AGENT_LABELS[opts.agentName] ?? opts.agentName;

  const transitionNote = buildTransitionNote(opts.agentName, opts.settings);
  const nextStep = buildNextStepHint(
    opts.agentName,
    opts.project,
    opts.slug,
    opts.task,
    opts.cwd,
  );

  return [
    `═══ SYNAPHEX AGENT: ${label.toUpperCase()} (Delegated Mode) ═══`,
    "",
    `## Your Role`,
    `Act according to the system prompt below. Use your available file tools`,
    `(view_file, grep_search, list_dir, write_to_file, replace_file_content, etc.)`,
    `to complete the task.`,
    "",
    `## System Prompt`,
    opts.systemPrompt,
    "",
    `## Context`,
    opts.userContext,
    "",
    nextStep,
    transitionNote,
  ].join("\n");
}
