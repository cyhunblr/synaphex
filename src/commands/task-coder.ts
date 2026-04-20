/**
 * synaphex_task_implement — runs the Coder agent with tool-use loop (direct)
 * or returns the prompt for the IDE model (delegated).
 */

import { promises as fs } from "node:fs";
import {
  projectExists,
  taskSlugDir,
  readJsonFile,
  writeJsonFile,
  settingsPath,
  validateTaskSequence,
} from "../lib/project-store.js";
import { runAgent } from "../lib/agent-runtime.js";
import {
  readFile,
  writeFile,
  editFile,
  listFiles,
  searchCode,
} from "../agents/examiner.js";
import { handleReadMemory } from "./read-memory.js";
import { handleWriteMemory } from "./write-memory.js";
import {
  CODER_SYSTEM_PROMPT,
  CODER_TOOLS,
  buildCoderPrompt,
} from "../agents/coder.js";
import {
  buildTransitionNote,
  buildNextStepHint,
  buildDelegatedPrompt,
} from "../lib/delegated-prompt.js";
import {
  ANSWERER_SYSTEM_PROMPT,
  buildAnswererPrompt,
  parseAnswererResponse,
} from "../agents/answerer.js";
import type { SynaphexSettings, AgentName } from "../lib/settings-schema.js";
import type { TaskMeta } from "../lib/pipeline-types.js";
import { addUsage, emptyUsage } from "../lib/pipeline-types.js";

export async function handleTaskImplement(
  project: string,
  slug: string,
  task: string,
  cwd: string,
  plan: string,
  examinerCompact: string,
  memoryDigest: string,
  iteration?: number,
): Promise<string> {
  if (!(await projectExists(project))) {
    throw new Error(`Project '${project}' does not exist.`);
  }

  const taskDir = taskSlugDir(project, slug);
  const settings = await readJsonFile<SynaphexSettings>(settingsPath(project));
  const coderConfig = settings.agents["coder" as AgentName];
  const answererConfig = settings.agents["answerer" as AgentName];

  // Validate state
  const metaPath = `${taskDir}/task-meta.json`;
  const meta = await readJsonFile<TaskMeta>(metaPath);

  const validation = validateTaskSequence("implement", meta.completed_steps);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Update task status
  meta.status = "implementing";
  meta.iteration = iteration ?? meta.iteration;
  await writeJsonFile(metaPath, meta);

  const iter = iteration ?? 1;

  // Build user message
  const userMessage = buildCoderPrompt(
    task,
    plan,
    examinerCompact,
    memoryDigest,
    cwd,
  );

  // === DELEGATED MODE ===
  if (coderConfig.mode === "delegated") {
    return buildDelegatedPrompt({
      agentName: "coder",
      systemPrompt: CODER_SYSTEM_PROMPT,
      userContext: userMessage,
      project,
      slug,
      task,
      cwd,
      settings,
      config: coderConfig,
    });
  }

  // === DIRECT MODE (existing behavior) ===
  const filesCreated: Set<string> = new Set();
  const filesModified: Set<string> = new Set();
  let answererUsage = emptyUsage();
  let escalation: { question: string; context: string } | null = null as {
    question: string;
    context: string;
  } | null;

  const onToolCall = async (name: string, input: Record<string, unknown>) => {
    try {
      switch (name) {
        case "read_file": {
          const content = await readFile(cwd, input.path as string);
          return { content };
        }
        case "write_file": {
          const filePath = input.path as string;
          try {
            await fs.access(`${cwd}/${filePath}`);
            filesModified.add(filePath);
          } catch {
            filesCreated.add(filePath);
          }
          await writeFile(cwd, filePath, input.content as string);
          return { content: `File written: ${filePath}` };
        }
        case "edit_file": {
          const filePath = input.path as string;
          await editFile(
            cwd,
            filePath,
            input.old_text as string,
            input.new_text as string,
          );
          filesModified.add(filePath);
          return { content: `File edited: ${filePath}` };
        }
        case "list_files": {
          const files = await listFiles(cwd, input.pattern as string);
          return { content: files.join("\n") || "No files found." };
        }
        case "search_code": {
          const result = await searchCode(
            cwd,
            input.pattern as string,
            input.glob as string | undefined,
          );
          return { content: result };
        }
        case "read_memory": {
          const content = await handleReadMemory(
            project,
            input.filename as string,
          );
          return { content };
        }
        case "write_memory": {
          const result = await handleWriteMemory(
            project,
            input.filename as string,
            input.content as string,
          );
          return {
            content: result.success
              ? result.message
              : `Error: ${result.message}`,
          };
        }
        case "ask_answerer": {
          const question = input.question as string;
          const ctx = input.context as string | undefined;

          const answererMessage = buildAnswererPrompt(
            question,
            task,
            memoryDigest,
            ctx,
          );
          const answererResult = await runAgent({
            config: answererConfig,
            systemPrompt: ANSWERER_SYSTEM_PROMPT,
            messages: [{ role: "user", content: answererMessage }],
          });

          answererUsage = addUsage(answererUsage, answererResult.usage);

          const parsed = parseAnswererResponse(answererResult.textOutput);
          if (parsed.escalation) {
            escalation = parsed.escalation;
            return {
              content: `ESCALATION: The Answerer could not answer this question and is escalating to the user.\nQuestion: ${parsed.escalation.question}\nContext: ${parsed.escalation.context}\n\nYou should STOP implementation and include this escalation in your response.`,
            };
          }

          return { content: parsed.answer! };
        }
        default:
          return { content: `Unknown tool: ${name}`, is_error: true };
      }
    } catch (err) {
      return { content: `Error: ${(err as Error).message}`, is_error: true };
    }
  };

  const result = await runAgent({
    config: coderConfig,
    systemPrompt: CODER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    tools: CODER_TOOLS,
    onToolCall,
    maxToolRounds: 25,
  });

  const totalUsage = addUsage(result.usage, answererUsage);

  const log = [
    `# Implementation Log v${iter}`,
    "",
    `## Files Created`,
    ...(filesCreated.size > 0
      ? [...filesCreated].map((f) => `- ${f}`)
      : ["(none)"]),
    "",
    `## Files Modified`,
    ...(filesModified.size > 0
      ? [...filesModified].map((f) => `- ${f}`)
      : ["(none)"]),
    "",
    `## Coder Output`,
    result.textOutput,
    "",
    `## Token Usage`,
    `- Coder: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out (${result.toolRounds} tool rounds)`,
    `- Answerer: ${answererUsage.inputTokens} in / ${answererUsage.outputTokens} out`,
  ].join("\n");

  await fs.writeFile(`${taskDir}/implementation-log-v${iter}.md`, log, "utf-8");

  // Update completed steps
  meta.status = "implemented";
  if (!meta.completed_steps.includes("implement")) {
    meta.completed_steps.push("implement");
  }
  await writeJsonFile(metaPath, meta);

  const parts = [
    `Implementation v${iter} complete.`,
    "",
    `- **Files created**: ${filesCreated.size > 0 ? [...filesCreated].join(", ") : "none"}`,
    `- **Files modified**: ${filesModified.size > 0 ? [...filesModified].join(", ") : "none"}`,
    `- **Tool rounds**: ${result.toolRounds}`,
    `- **Tokens**: ${totalUsage.inputTokens} in / ${totalUsage.outputTokens} out`,
  ];

  if (escalation) {
    parts.push(
      "",
      `<escalation>`,
      `**Question**: ${escalation.question}`,
      `**Context**: ${escalation.context}`,
      `</escalation>`,
    );
  }

  parts.push(
    "",
    `<implementation_summary>`,
    result.textOutput,
    `</implementation_summary>`,
    "",
    buildNextStepHint("coder", project, slug, task, cwd),
    buildTransitionNote("coder", settings),
  );

  return parts.join("\n");
}
