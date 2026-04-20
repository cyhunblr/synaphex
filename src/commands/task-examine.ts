/**
 * synaphex_task_examine — runs the Examiner agent via Anthropic API (direct)
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
import { readFile, listFiles, searchCode } from "../agents/examiner.js";
import { handleReadMemory } from "./read-memory.js";
import { handleWriteMemory } from "./write-memory.js";
import {
  EXAMINER_SYSTEM_PROMPT,
  EXAMINER_TOOLS,
  buildExaminerPrompt,
} from "../agents/examiner.js";
import type { SynaphexSettings, AgentName } from "../lib/settings-schema.js";
import type { TaskMeta } from "../lib/pipeline-types.js";
import {
  buildDelegatedPrompt,
  buildNextStepHint,
} from "../lib/delegated-prompt.js";

export async function handleTaskExamine(
  project: string,
  slug: string,
  cwd: string,
  task: string,
  memoryDigest: string,
): Promise<string> {
  if (!(await projectExists(project))) {
    throw new Error(`Project '${project}' does not exist.`);
  }

  const taskDir = taskSlugDir(project, slug);
  const settings = await readJsonFile<SynaphexSettings>(settingsPath(project));
  const config = settings.agents["examiner" as AgentName];

  // Validate state
  const metaPath = `${taskDir}/task-meta.json`;
  const meta = await readJsonFile<TaskMeta>(metaPath);

  const validation = validateTaskSequence("examine", meta.completed_steps);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Update task status
  meta.status = "examining";
  await writeJsonFile(metaPath, meta);

  // Build user message
  const userMessage = buildExaminerPrompt(task, memoryDigest, cwd);

  // === DELEGATED MODE ===
  if (config.mode === "delegated") {
    return buildDelegatedPrompt({
      agentName: "examiner",
      systemPrompt: EXAMINER_SYSTEM_PROMPT,
      userContext: userMessage,
      project,
      slug,
      task,
      cwd,
      settings,
      config,
    });
  }

  // === DIRECT MODE (existing behavior) ===
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
          const result = await searchCode(
            cwd,
            input.pattern as string,
            input.glob as string | undefined,
          );
          return { content: result };
        }
        case "read_memory": {
          const result = await handleReadMemory(
            project,
            input.filename as string,
          );
          return { content: result };
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
        default:
          return { content: `Unknown tool: ${name}`, is_error: true };
      }
    } catch (err) {
      return { content: `Error: ${(err as Error).message}`, is_error: true };
    }
  };

  const result = await runAgent({
    config,
    systemPrompt: EXAMINER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    tools: EXAMINER_TOOLS,
    onToolCall,
    maxToolRounds: 25,
  });

  const fullOutput = result.textOutput;
  const compactMarker = "=== COMPACT ANALYSIS ===";
  const rawMarker = "=== RAW ANALYSIS ===";

  let rawOutput = fullOutput;
  let compactOutput = fullOutput;

  const compactIdx = fullOutput.indexOf(compactMarker);
  const rawIdx = fullOutput.indexOf(rawMarker);

  if (compactIdx !== -1) {
    compactOutput = fullOutput.slice(compactIdx + compactMarker.length).trim();
    if (rawIdx !== -1 && rawIdx < compactIdx) {
      rawOutput = fullOutput
        .slice(rawIdx + rawMarker.length, compactIdx)
        .trim();
    }
  } else if (rawIdx !== -1) {
    rawOutput = fullOutput.slice(rawIdx + rawMarker.length).trim();
  }

  await fs.writeFile(`${taskDir}/examiner-raw.md`, rawOutput, "utf-8");
  await fs.writeFile(`${taskDir}/examiner-compact.md`, compactOutput, "utf-8");

  // Update completed steps
  meta.status = "examined";
  meta.completed_steps.push("examine");
  await writeJsonFile(metaPath, meta);

  const usage = result.usage;

  return [
    `Examiner analysis complete.`,
    "",
    `- **Tool rounds**: ${result.toolRounds}`,
    `- **Tokens**: ${usage.inputTokens} in / ${usage.outputTokens} out`,
    "",
    `<examiner_compact>`,
    compactOutput,
    `</examiner_compact>`,
    "",
    buildNextStepHint("examiner", project, slug, task, cwd),
  ].join("\n");
}
