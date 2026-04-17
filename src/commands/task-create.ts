/**
 * synaphex_task_start — creates task dir, returns memory digest + settings summary.
 */

import { promises as fs } from "node:fs";
import {
  projectExists,
  tasksDir,
  taskSlugDir,
  readJsonFile,
  writeJsonFile,
  settingsPath,
} from "../lib/project-store.js";
import { generateTaskSlug } from "../lib/task-slug.js";
import { handleLoad } from "./load.js";
import type { TaskMeta, TaskStartResult } from "../lib/pipeline-types.js";
import type { SynaphexSettings } from "../lib/settings-schema.js";
import { summarizeAgents } from "../lib/settings-schema.js";

export async function handleTaskStart(
  project: string,
  task: string,
  cwd: string,
  mode: "task" | "fix",
): Promise<string> {
  if (!(await projectExists(project))) {
    throw new Error(
      `Project '${project}' does not exist. Use the 'create' tool ${project} to create it first.`,
    );
  }

  // Generate slug and create task directory
  const slug = generateTaskSlug(task);
  const taskDir = taskSlugDir(project, slug);

  await fs.mkdir(tasksDir(project), { recursive: true });

  // Handle existing task dir (append timestamp)
  let finalSlug = slug;
  let finalTaskDir = taskDir;
  try {
    await fs.access(taskDir);
    // Dir exists — append timestamp
    finalSlug = `${slug}-${Date.now()}`;
    finalTaskDir = taskSlugDir(project, finalSlug);
  } catch {
    // Doesn't exist — use as-is
  }

  await fs.mkdir(finalTaskDir, { recursive: true });

  // Write task metadata
  const meta: TaskMeta = {
    project,
    slug: finalSlug,
    task,
    cwd,
    mode,
    createdAt: new Date().toISOString(),
    iteration: 1,
    status: "created",
    completed_steps: ["create"],
    answerer_escalation: null,
  };
  await writeJsonFile(`${finalTaskDir}/task-meta.json`, meta);

  // Get memory digest (reuse load logic)
  const memoryDigest = await handleLoad(project);

  // Get settings summary
  const settings = await readJsonFile<SynaphexSettings>(settingsPath(project));
  const settingsSummary = summarizeAgents(settings);

  const result: TaskStartResult = {
    slug: finalSlug,
    taskDir: finalTaskDir,
    memoryDigest,
    settingsSummary,
  };

  return [
    `Task initialized.`,
    "",
    `- **Slug**: ${result.slug}`,
    `- **Mode**: ${mode}`,
    `- **Task dir**: ${result.taskDir}`,
    `- **Settings**: ${result.settingsSummary}`,
    "",
    `<memory_digest>`,
    result.memoryDigest,
    `</memory_digest>`,
    "",
    `<task_meta>`,
    JSON.stringify(meta, null, 2),
    `</task_meta>`,
  ].join("\n");
}
