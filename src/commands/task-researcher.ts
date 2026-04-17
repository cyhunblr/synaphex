/**
 * Task Researcher command: Perform internet research on unknown topics.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  projectExists,
  taskSlugDir,
  readJsonFile,
  writeJsonFile,
  internalMemoryDir,
  settingsPath,
} from "../lib/project-store.js";
import { handleReadMemory } from "./read-memory.js";
import { runAgent } from "../lib/agent-runtime.js";
import {
  RESEARCHER_SYSTEM_PROMPT,
  buildResearcherPrompt,
  RESEARCHER_TOOLS,
} from "../agents/researcher.js";
import type { SynaphexSettings, AgentName } from "../lib/settings-schema.js";
import type { TaskMeta } from "../lib/pipeline-types.js";

export async function handleTaskResearcher(
  project: string,
  slug: string,
  task: string,
  cwd: string,
  examiner_compact: string,
): Promise<string> {
  if (!(await projectExists(project))) {
    throw new Error(`Project '${project}' does not exist.`);
  }

  const taskDir = taskSlugDir(project, slug);
  const settings = await readJsonFile<SynaphexSettings>(settingsPath(project));
  const config = settings.agents["researcher" as AgentName];

  // Load task meta to update status
  const metaPath = path.join(taskDir, "task-meta.json");
  const meta = await readJsonFile<TaskMeta>(metaPath);

  // Build researcher prompt
  const userMessage = buildResearcherPrompt(task, examiner_compact);

  // === DELEGATED MODE ===
  if (config.mode === "delegated") {
    return [
      "Researcher (delegated mode)",
      "",
      `Task: ${task}`,
      "",
      "This command requires IDE model integration. Run in direct mode or configure your IDE to support research queries.",
    ].join("\n");
  }

  // === DIRECT MODE ===
  // Tools available but web_search requires external integration (v2.1)
  // For now, allow tool-use calls and provide fallback responses
  const onToolCall = async (
    name: string,
    input: Record<string, unknown>,
  ): Promise<{ content: string; is_error?: boolean }> => {
    switch (name) {
      case "web_search": {
        const query = input.query as string;
        // Placeholder: would integrate with actual web search API in v2.1
        return {
          content: `[Web search placeholder: "${query}" - integration available in v2.1 with MCP tools]`,
        };
      }
      case "read_memory": {
        const filename = input.filename as string;
        try {
          const content = await handleReadMemory(project, filename);
          return { content };
        } catch {
          return {
            content: `Memory file not found: ${filename}`,
            is_error: true,
          };
        }
      }
      case "write_memory": {
        const filename = input.filename as string;
        const content = input.content as string;
        try {
          const researchDir = path.join(internalMemoryDir(project), "research");
          await fs.mkdir(researchDir, { recursive: true });
          const filePath = path.join(researchDir, filename);
          await fs.writeFile(filePath, content, "utf-8");
          return { content: `Memory saved: research/${filename}` };
        } catch (err) {
          return {
            content: `Error saving memory: ${(err as Error).message}`,
            is_error: true,
          };
        }
      }
      default:
        return { content: `Unknown tool: ${name}`, is_error: true };
    }
  };

  const result = await runAgent({
    config,
    systemPrompt: RESEARCHER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    tools: RESEARCHER_TOOLS,
    onToolCall,
    maxToolRounds: 10,
  });

  const research = result.textOutput.trim();

  // Save research findings
  const researchDir = path.join(internalMemoryDir(project), "research");
  await fs.mkdir(researchDir, { recursive: true });

  const topicName = slug.replace(/[^a-z0-9]/g, "-").toLowerCase();
  const researchPath = path.join(researchDir, `${topicName}.md`);

  await fs.writeFile(researchPath, research, "utf-8");

  // Update task meta
  if (!meta.completed_steps.includes("researcher")) {
    meta.completed_steps.push("researcher");
  }
  await writeJsonFile(metaPath, meta);

  const usage = result.usage;

  return [
    `Research completed for task: ${task}`,
    "",
    `- **Saved to**: memory/internal/research/${topicName}.md`,
    `- **Tokens**: ${usage.inputTokens} in / ${usage.outputTokens} out`,
    "",
    `<research>`,
    research,
    `</research>`,
  ].join("\n");
}
