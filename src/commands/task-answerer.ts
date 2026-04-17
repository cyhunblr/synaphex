/**
 * Task Answerer command: Answer Coder questions and escalate architectural decisions.
 */

import * as path from "node:path";

import {
  projectExists,
  taskSlugDir,
  readJsonFile,
  writeJsonFile,
  settingsPath,
} from "../lib/project-store.js";
import { runAgent } from "../lib/agent-runtime.js";
import {
  ANSWERER_SYSTEM_PROMPT,
  buildAnswererPrompt,
  parseAnswererResponse,
} from "../agents/answerer.js";
import type { SynaphexSettings, AgentName } from "../lib/settings-schema.js";
import type { TaskMeta } from "../lib/pipeline-types.js";

export async function handleTaskAnswerer(
  project: string,
  slug: string,
  task: string,
  cwd: string,
  implementation_summary: string,
  memoryDigest?: string,
): Promise<string> {
  if (!(await projectExists(project))) {
    throw new Error(`Project '${project}' does not exist.`);
  }

  const taskDir = taskSlugDir(project, slug);
  const settings = await readJsonFile<SynaphexSettings>(settingsPath(project));
  const config = settings.agents["answerer" as AgentName];

  // Load task meta
  const metaPath = path.join(taskDir, "task-meta.json");
  const meta = await readJsonFile<TaskMeta>(metaPath);

  // Extract questions from implementation summary (look for SYNAPHEX_QUESTION markers)
  const questionRegex =
    /\/\/\s*SYNAPHEX_(?:QUESTION|ARCHITECTURAL):\s*(.+?)(?=\n|$)/g;
  const matches = Array.from(implementation_summary.matchAll(questionRegex));
  const questions = matches.map((m) => m[1].trim());

  if (questions.length === 0) {
    // No questions asked — return success
    if (!meta.completed_steps.includes("answerer")) {
      meta.completed_steps.push("answerer");
    }
    await writeJsonFile(metaPath, meta);

    return [
      `Answerer reviewed implementation for task: ${task}`,
      "",
      `- **Result**: No questions detected`,
      `- **Status**: No escalation needed`,
    ].join("\n");
  }

  // === DELEGATED MODE ===
  if (config.mode === "delegated") {
    return [
      "Answerer (delegated mode)",
      "",
      `Task: ${task}`,
      `Questions found: ${questions.length}`,
      "",
      "This command requires IDE model integration. Run in direct mode or configure your IDE to support question answering.",
    ].join("\n");
  }

  // === DIRECT MODE ===
  // Answer each question
  const questionAnswers: string[] = [];
  let hasEscalation = false;
  let escalationQuestion = "";
  let escalationContext = "";

  for (const question of questions) {
    const prompt = buildAnswererPrompt(
      question,
      task,
      memoryDigest || "",
      implementation_summary,
    );

    const result = await runAgent({
      config,
      systemPrompt: ANSWERER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const parsed = parseAnswererResponse(result.textOutput);

    if (parsed.escalation) {
      hasEscalation = true;
      escalationQuestion = parsed.escalation.question;
      escalationContext = parsed.escalation.context;
      questionAnswers.push(`❌ ESCALATED: ${question}`);
    } else if (parsed.answer) {
      questionAnswers.push(`✓ ANSWERED: ${question}\n${parsed.answer}`);
    }
  }

  // Update task meta
  meta.status = "answering";
  if (!meta.completed_steps.includes("answerer")) {
    meta.completed_steps.push("answerer");
  }

  if (hasEscalation) {
    meta.answerer_escalation = {
      question: escalationQuestion,
      context: escalationContext,
      options: ["Yes", "No"],
    };
    meta.status = "answered";
  }

  await writeJsonFile(metaPath, meta);

  const result = [
    `Answerer reviewed ${questions.length} question(s) for task: ${task}`,
    "",
    `<questions>`,
    ...questionAnswers,
    `</questions>`,
  ];

  if (hasEscalation) {
    result.push("");
    result.push("⚠️  **ESCALATION DETECTED**");
    result.push("");
    result.push(`Question: ${escalationQuestion}`);
    result.push(`Context: ${escalationContext}`);
    result.push("");
    result.push("Update task-meta.json with your decision, then re-plan:");
    result.push(
      '```json\n{"answerer_escalation": {"question": "...", "context": "...", "options": [...], "decision": "your decision here"}}\n```',
    );
  }

  return result.join("\n");
}
