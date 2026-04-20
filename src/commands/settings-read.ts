import {
  projectExists,
  settingsPath,
  readJsonFile,
} from "../lib/project-store.js";
import {
  type SynaphexSettings,
  type AgentName,
} from "../lib/settings-schema.js";

const AGENT_ORDER: AgentName[] = [
  "examiner",
  "researcher",
  "planner",
  "coder",
  "answerer",
  "reviewer",
];

export async function handleSettingsRead(project: string): Promise<string> {
  if (!(await projectExists(project))) {
    throw new Error(
      `Project '${project}' does not exist. ` +
        `Use the 'create' tool ${project} to create it first.`,
    );
  }

  const settings = await readJsonFile<SynaphexSettings>(settingsPath(project));

  const rows = AGENT_ORDER.map((name) => {
    const a = settings.agents[name];
    return `| ${name.padEnd(10)} | ${a.model.padEnd(26)} | ${(a.think ? "ON" : "off").padEnd(5)} | ${String(a.effort).padEnd(6)} |`;
  });

  return [
    `# Settings: ${project}`,
    "",
    "| Agent      | Model                      | Think | Effort |",
    "|------------|----------------------------|-------|--------|",
    ...rows,
  ].join("\n");
}
