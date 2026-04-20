/**
 * synaphex_task — Pipeline wrapper that orchestrates examine → plan → implement → review
 * Calls discrete handlers internally and returns final review output.
 */

import {
  projectExists,
  taskSlugDir,
  readJsonFile,
} from "../lib/project-store.js";
import { handleTaskExamine } from "./task-examine.js";
import { handleTaskPlan } from "./task-planner.js";
import { handleTaskImplement } from "./task-coder.js";
import { handleTaskReview } from "./task-reviewer.js";
import type { TaskMeta } from "../lib/pipeline-types.js";

/**
 * Extract content between XML-like tags (e.g., <examiner_compact>...</examiner_compact>)
 */
function extractTagContent(output: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "m");
  const match = output.match(pattern);
  return match ? match[1].trim() : null;
}

export async function handleTask(
  project: string,
  slug: string,
  task: string,
  cwd: string,
  memoryDigest: string,
): Promise<string> {
  if (!(await projectExists(project))) {
    throw new Error(`Project '${project}' does not exist.`);
  }

  const taskDir = taskSlugDir(project, slug);
  const metaPath = `${taskDir}/task-meta.json`;
  const meta = await readJsonFile<TaskMeta>(metaPath);

  // Phase 1: Examine
  let examinerOutput: string;
  if (!meta.completed_steps.includes("examine")) {
    examinerOutput = await handleTaskExamine(
      project,
      slug,
      cwd,
      task,
      memoryDigest,
    );
  } else {
    return `Task already examined. To retry, use discrete commands: task_plan, task_implement, task_review.`;
  }

  const examinerCompact = extractTagContent(examinerOutput, "examiner_compact");
  if (!examinerCompact) {
    throw new Error("Examiner did not produce compact analysis output.");
  }

  // Phase 2: Plan
  const plannerOutput = await handleTaskPlan(
    project,
    slug,
    task,
    cwd,
    examinerCompact,
  );

  const plan = extractTagContent(plannerOutput, "plan");
  if (!plan) {
    throw new Error("Planner did not produce plan output.");
  }

  // Phase 3: Implement
  const coderOutput = await handleTaskImplement(
    project,
    slug,
    task,
    cwd,
    plan,
    examinerCompact,
    memoryDigest,
  );

  const implementationSummary = extractTagContent(
    coderOutput,
    "implementation_summary",
  );
  if (!implementationSummary) {
    throw new Error("Coder did not produce implementation summary output.");
  }

  // Phase 4: Review
  const reviewOutput = await handleTaskReview(
    project,
    slug,
    task,
    cwd,
    plan,
    implementationSummary,
    examinerCompact,
  );

  return [
    `## Pipeline Complete`,
    ``,
    `All four phases executed successfully:`,
    `- ✅ Examined codebase`,
    `- ✅ Generated plan`,
    `- ✅ Implemented changes`,
    `- ✅ Reviewed implementation`,
    ``,
    `## Final Review Result`,
    ``,
    reviewOutput,
  ].join("\n");
}
