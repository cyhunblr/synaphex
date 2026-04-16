import {
  projectExists,
  settingsPath,
  readJsonFile,
} from "../lib/project-store.js";
import {
  type SynaphexSettings,
  type AgentName,
  MODEL_CAPABILITIES,
  EFFORT_BUDGET_TOKENS,
} from "../lib/settings-schema.js";

const AGENT_ORDER: AgentName[] = [
  "examiner", "researcher", "planner", "coder", "answerer", "reviewer",
];

function capabilitiesLabel(model: string): string {
  const caps = MODEL_CAPABILITIES[model];
  if (!caps) return "unknown model";
  const parts: string[] = [];
  if (caps.thinking) parts.push("thinking");
  if (caps.adaptiveThinking) parts.push("adaptive-effort");
  else if (caps.thinking) parts.push("manual-budget only");
  return parts.join(", ") || "none";
}

export async function handleSettingsRead(project: string): Promise<string> {
  if (!(await projectExists(project))) {
    throw new Error(
      `Project '${project}' does not exist. ` +
        `Use /synaphex:create ${project} to create it first.`,
    );
  }

  const settings = await readJsonFile<SynaphexSettings>(settingsPath(project));

  const rows = AGENT_ORDER.map((name) => {
    const a = settings.agents[name];
    return `| ${name.padEnd(10)} | ${a.model.padEnd(18)} | ${(a.think ? "ON" : "off").padEnd(5)} | ${String(a.effort).padEnd(6)} | ${capabilitiesLabel(a.model).padEnd(31)} |`;
  });

  const modelRows = Object.entries(MODEL_CAPABILITIES).map(([id, caps]) => {
    const aliases = caps.aliases?.join(", ") ?? "";
    const adaptive = caps.adaptiveThinking ? "yes" : "no (manual)";
    return `| ${id.padEnd(18)} | ${(caps.thinking ? "yes" : "no").padEnd(8)} | ${adaptive.padEnd(15)} | ${aliases} |`;
  });

  return [
    `# Settings: ${project}`,
    "",
    "| Agent      | Model              | Think | Effort | Capabilities                    |",
    "|------------|--------------------|-------|--------|---------------------------------|",
    ...rows,
    "",
    "## Model Reference",
    "",
    "| Model              | Thinking | Adaptive Effort | Aliases                    |",
    "|--------------------|----------|-----------------|----------------------------|",
    ...modelRows,
    "",
    "## Effort Scale",
    "0=disabled, 1=low (5k tokens), 2=medium (15k), 3=high (25k), 4=max (32k)",
    "",
    "Notes:",
    "- If think=off, effort is ignored (effectively 0) at runtime.",
    "- Haiku 4.5 uses manual budget_tokens, not adaptive effort.",
  ].join("\n");
}
