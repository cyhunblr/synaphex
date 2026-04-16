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

  const sameConfig =
    current.model === next.model &&
    current.think === next.think &&
    current.effort === next.effort;

  if (sameConfig) {
    return [
      "",
      `> ✅ Sıradaki agent (**${AGENT_LABELS[nextAgentName]}**) aynı model ayarlarını kullanıyor. Devam edebilirsin.`,
    ].join("\n");
  }

  return [
    "",
    `> ⚠️ **Model Değişikliği Önerisi**`,
    `> Sıradaki agent (**${AGENT_LABELS[nextAgentName]}**) farklı ayarlar kullanıyor:`,
    `> - Şu an: \`${current.model}\` (think: ${current.think}, effort: ${current.effort})`,
    `> - Sonraki: \`${next.model}\` (think: ${next.think}, effort: ${next.effort})`,
    `> Geçiş yapmadan önce IDE'de model değiştirmeyi düşünebilirsin.`,
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
        `## Sonraki Adım`,
        `Analizini tamamladığında sonucunu şu komutla ilerlet:`,
        "```",
        `synaphex_task_plan(project: "${project}", slug: "${slug}",`,
        `  task: "${task}", cwd: "${cwd}",`,
        `  examiner_compact: "SENIN_KOMPAKTanaliz_ÇIKTIN")`,
        "```",
      ].join("\n");

    case "planner":
      return [
        `## Sonraki Adım`,
        `Planını tamamladığında sonucunu şu komutla ilerlet:`,
        "```",
        `synaphex_task_implement(project: "${project}", slug: "${slug}",`,
        `  task: "${task}", cwd: "${cwd}",`,
        `  plan: "SENIN_PLAN_ÇIKTIN",`,
        `  examiner_compact: "...", memory_digest: "...")`,
        "```",
      ].join("\n");

    case "coder":
      return [
        `## Sonraki Adım`,
        `Implementasyonu tamamladığında sonucunu şu komutla ilerlet:`,
        "```",
        `synaphex_task_review(project: "${project}", slug: "${slug}",`,
        `  task: "${task}", cwd: "${cwd}",`,
        `  plan: "...", implementation_summary: "SENIN_IMPLEMENTASYON_ÖZETIN",`,
        `  examiner_compact: "...")`,
        "```",
      ].join("\n");

    case "reviewer":
      return [
        `## Sonraki Adım`,
        `- Eğer APPROVED → Pipeline tamamlandı! 🎉`,
        `- Eğer NEEDS_CHANGES → Feedback'i synaphex_task_plan'a reviewer_feedback olarak aktar.`,
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
    `## Senin Rolün`,
    `Aşağıdaki system prompt'a uygun şekilde davran. Kendi dosya araçlarını`,
    `(view_file, grep_search, list_dir, write_to_file, replace_file_content vb.)`,
    `kullanarak görevi gerçekleştir.`,
    "",
    `## System Prompt`,
    opts.systemPrompt,
    "",
    `## Bağlam`,
    opts.userContext,
    "",
    nextStep,
    transitionNote,
  ].join("\n");
}
