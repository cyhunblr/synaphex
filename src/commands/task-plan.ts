/**
 * synaphex_task_plan — runs the Planner agent (single call, no tools).
 */

import { promises as fs } from "node:fs";
import {
  projectExists,
  taskSlugDir,
  readJsonFile,
  writeJsonFile,
  settingsPath,
} from "../lib/project-store.js";
import { runAgent } from "../lib/agent-runtime.js";
import {
  PLANNER_SYSTEM_PROMPT,
  buildPlannerPrompt,
} from "../agents/planner.js";
import type { SynaphexSettings, AgentName } from "../lib/settings-schema.js";
import type { TaskMeta } from "../lib/pipeline-types.js";

export async function handleTaskPlan(
  project: string,
  slug: string,
  task: string,
  cwd: string,
  examinerCompact: string,
  reviewerFeedback?: string,
  iteration?: number,
): Promise<string> {
  if (!(await projectExists(project))) {
    throw new Error(`Project '${project}' does not exist.`);
  }

  const taskDir = taskSlugDir(project, slug);
  const settings = await readJsonFile<SynaphexSettings>(settingsPath(project));
  const config = settings.agents["planner" as AgentName];

  // Update task status
  const metaPath = `${taskDir}/task-meta.json`;
  const meta = await readJsonFile<TaskMeta>(metaPath);
  meta.status = "planning";
  meta.iteration = iteration ?? meta.iteration;
  await writeJsonFile(metaPath, meta);

  const iter = iteration ?? 1;

  // Build user message
  const userMessage = buildPlannerPrompt(
    task,
    examinerCompact,
    reviewerFeedback,
    iter,
  );

  // Run the Planner (no tools)
  const result = await runAgent({
    config,
    systemPrompt: PLANNER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const plan = result.textOutput.trim();

  // Save plan
  await fs.writeFile(`${taskDir}/plan-v${iter}.md`, plan, "utf-8");

  const usage = result.usage;

  return [
    `Plan v${iter} generated.`,
    "",
    `- **Tokens**: ${usage.inputTokens} in / ${usage.outputTokens} out`,
    "",
    `<plan>`,
    plan,
    `</plan>`,
  ].join("\n");
}
