/**
 * synaphex_task_review — runs the Reviewer agent to check implementation quality.
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
import { readFile, listFiles, searchCode } from "../lib/file-tools.js";
import { REVIEWER_SYSTEM_PROMPT, REVIEWER_TOOLS, buildReviewerPrompt, parseReviewerResponse } from "../agents/reviewer.js";
import type { SynaphexSettings, AgentName } from "../lib/settings-schema.js";
import type { TaskMeta } from "../lib/pipeline-types.js";

export async function handleTaskReview(
  project: string,
  slug: string,
  task: string,
  cwd: string,
  plan: string,
  implementationSummary: string,
  examinerCompact: string,
  iteration?: number,
): Promise<string> {
  if (!(await projectExists(project))) {
    throw new Error(`Project '${project}' does not exist.`);
  }

  const taskDir = taskSlugDir(project, slug);
  const settings = await readJsonFile<SynaphexSettings>(settingsPath(project));
  const config = settings.agents["reviewer" as AgentName];

  // Update task status
  const metaPath = `${taskDir}/task-meta.json`;
  const meta = await readJsonFile<TaskMeta>(metaPath);
  meta.status = "reviewing";
  meta.iteration = iteration ?? meta.iteration;
  await writeJsonFile(metaPath, meta);

  const iter = iteration ?? 1;

  // Tool call handler
  const onToolCall = async (name: string, input: Record<string, unknown>) => {
    try {
      switch (name) {
        case "read_file": {
          const content = await readFile(cwd, input.path as string);
          return { content };
        }
        case "list_files": {
          const files = await listFiles(cwd, input.pattern as string);
          return { content: files.join("\n") || "No files found." };
        }
        case "search_code": {
          const result = await searchCode(cwd, input.pattern as string, input.glob as string | undefined);
          return { content: result };
        }
        default:
          return { content: `Unknown tool: ${name}`, is_error: true };
      }
    } catch (err) {
      return { content: `Error: ${(err as Error).message}`, is_error: true };
    }
  };

  // Build user message
  const userMessage = buildReviewerPrompt(task, plan, implementationSummary, examinerCompact, cwd);

  // Run the Reviewer
  const result = await runAgent({
    config,
    systemPrompt: REVIEWER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    tools: REVIEWER_TOOLS,
    onToolCall,
    maxToolRounds: 15,
  });

  // Parse verdict
  const parsed = parseReviewerResponse(result.textOutput);

  // Save review
  await fs.writeFile(`${taskDir}/review-v${iter}.md`, result.textOutput, "utf-8");

  // If done, update task status
  if (parsed.verdict === "approved") {
    const updatedMeta = await readJsonFile<TaskMeta>(metaPath);
    updatedMeta.status = "done";
    await writeJsonFile(metaPath, updatedMeta);
  }

  const usage = result.usage;

  const parts = [
    `Review v${iter} complete.`,
    "",
    `- **Verdict**: ${parsed.verdict === "approved" ? "APPROVED" : "NEEDS CHANGES"}`,
    `- **Tool rounds**: ${result.toolRounds}`,
    `- **Tokens**: ${usage.inputTokens} in / ${usage.outputTokens} out`,
    "",
    `<review>`,
    parsed.reviewText,
    `</review>`,
  ];

  if (parsed.verdict === "needs_changes") {
    parts.push(
      "",
      `<feedback_for_planner>`,
      parsed.feedbackForPlanner,
      `</feedback_for_planner>`,
    );
  }

  return parts.join("\n");
}
