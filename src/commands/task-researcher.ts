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

interface ResearcherOptions {
  force?: boolean;
}

export async function handleTaskResearcher(
  project: string,
  slug: string,
  task: string,
  cwd: string,
  examiner_compact: string,
  options: ResearcherOptions = {},
): Promise<string> {
  if (!(await projectExists(project))) {
    throw new Error(`Project '${project}' does not exist.`);
  }

  try {
    const taskDir = taskSlugDir(project, slug);
    const settings = await readJsonFile<SynaphexSettings>(
      settingsPath(project),
    );
    const config = settings.agents["researcher" as AgentName];

    const metaPath = path.join(taskDir, "task-meta.json");
    const meta = await readJsonFile<TaskMeta>(metaPath);

    // Extract research topic from task or SYNAPHEX_QUESTION marker
    const topic = extractResearchTopic(task, examiner_compact);
    const topicName = sanitizeTopicToFilename(topic);
    const researchDir = path.join(internalMemoryDir(project), "research");
    const researchPath = path.join(researchDir, `${topicName}.md`);

    // Check if research already exists (unless --force)
    if (!options.force && (await fileExists(researchPath))) {
      const existing = await fs.readFile(researchPath, "utf-8");
      return [
        `Research already exists for topic: ${topic}`,
        "",
        `**Saved at**: memory/internal/research/${topicName}.md`,
        "",
        `Use --force flag to re-research.`,
        "",
        `<research>`,
        existing,
        `</research>`,
      ].join("\n");
    }

    // === DELEGATED MODE ===
    if (config.mode === "delegated") {
      return [
        "Researcher (delegated mode)",
        "",
        `Task: ${task}`,
        `Topic: ${topic}`,
        "",
        "This command requires IDE model integration. Run in direct mode or configure your IDE to support research queries.",
      ].join("\n");
    }

    // === DIRECT MODE ===
    const userMessage = buildResearcherPrompt(task, examiner_compact);

    const onToolCall = async (
      name: string,
      input: Record<string, unknown>,
    ): Promise<{ content: string; is_error?: boolean }> => {
      switch (name) {
        case "web_search": {
          const query = input.query as string;
          return {
            content: `[Web search: "${query}" - MCP web_search integration in v2.1+]`,
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

    // Write research findings to memory with structure
    await fs.mkdir(researchDir, { recursive: true });
    const findings = formatResearchFindings(research, topic);
    await fs.writeFile(researchPath, findings, "utf-8");

    // Update task meta
    if (!meta.completed_steps.includes("researcher")) {
      meta.completed_steps.push("researcher");
    }
    await writeJsonFile(metaPath, meta);

    const usage = result.usage;

    return [
      `✓ Research completed for topic: ${topic}`,
      "",
      `- **Saved to**: memory/internal/research/${topicName}.md`,
      `- **Tokens**: ${usage.inputTokens} in / ${usage.outputTokens} out`,
      "",
      `<research>`,
      findings,
      `</research>`,
    ].join("\n");
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    throw new Error(`Research failed: ${error}`, { cause: err });
  }
}

function extractResearchTopic(task: string, examinerOutput: string): string {
  // Look for SYNAPHEX_QUESTION marker in examiner output
  const questionMatch = examinerOutput.match(
    /<!--\s*SYNAPHEX_QUESTION\s*\n(.*?)\n\s*\/SYNAPHEX_QUESTION\s*-->/s,
  );
  if (questionMatch) {
    return questionMatch[1].trim();
  }

  // Fallback: derive from first 5 significant words of task
  const words = task
    .split(/\s+/)
    .filter(
      (w) => w.length > 3 && !["the", "and", "for"].includes(w.toLowerCase()),
    )
    .slice(0, 5);

  return words.length > 0 ? words.join(" ") : task.substring(0, 50);
}

function sanitizeTopicToFilename(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "-")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatResearchFindings(research: string, topic: string): string {
  const timestamp = new Date().toISOString();
  return [
    `# Research: ${topic}`,
    ``,
    `**Last researched**: ${timestamp}`,
    ``,
    `## Problem`,
    topic,
    ``,
    `## Key Findings`,
    research,
    ``,
    `## Recommendation`,
    `Integrate findings above into implementation.`,
    ``,
    `## Sources`,
    `See findings above for source references.`,
    ``,
  ].join("\n");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
