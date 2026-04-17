#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { handleCreate } from "./commands/create.js";
import { handleLoad } from "./commands/load.js";
import { handleMemorize } from "./commands/memorize.js";
import { handleRemember } from "./commands/remember.js";
import { handleSettingsRead } from "./commands/settings-read.js";
import { handleSettingsUpdate } from "./commands/settings-update.js";
import { handleTaskStart as handleTaskCreate } from "./commands/task-create.js";
import { handleTaskExamine } from "./commands/task-examine.js";
import { handleTaskPlan as handleTaskPlanner } from "./commands/task-planner.js";
import { handleTaskImplement as handleTaskCoder } from "./commands/task-coder.js";
import { handleTaskReview as handleTaskReviewer } from "./commands/task-reviewer.js";
import { handleTaskResearcher } from "./commands/task-researcher.js";
import { handleTaskAnswerer } from "./commands/task-answerer.js";
import { handleTaskRemember } from "./commands/task-remember.js";

// === Server setup ===

const server = new McpServer(
  {
    name: "synaphex",
    version: "2.0.0",
  },
  {
    capabilities: {
      prompts: {},
      resources: {},
    },
  },
);

// === Tool: synaphex_create ===

server.registerTool(
  "create",
  {
    description:
      "Create a new synaphex project with memory scaffold and default settings",
    inputSchema: z.object({
      project: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9][a-z0-9_-]*$/)
        .describe(
          "Project name (lowercase alphanumeric, hyphens, underscores)",
        ),
    }),
  },
  async ({ project }) => {
    try {
      const result = await handleCreate(project);
      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// === Tool: synaphex_load ===

server.registerTool(
  "load",
  {
    description:
      "Load a synaphex project and return its memory + settings digest",
    inputSchema: z.object({
      project: z.string().min(1).max(64).describe("Project name to load"),
    }),
  },
  async ({ project }) => {
    try {
      const result = await handleLoad(project);
      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// === Tool: synaphex_memorize ===

server.registerTool(
  "memorize",
  {
    description:
      "Analyze a source path and return structured memory update instructions for a project",
    inputSchema: z.object({
      project: z.string().min(1).max(64).describe("Project name"),
      path: z
        .string()
        .min(1)
        .describe("Absolute path to source directory to analyze"),
    }),
  },
  async ({ project, path }) => {
    try {
      const result = await handleMemorize(project, path);
      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// === Tool: synaphex_remember ===

server.registerTool(
  "remember",
  {
    description:
      "Link one project's memory into another project's external memory",
    inputSchema: z.object({
      parent_project: z
        .string()
        .min(1)
        .max(64)
        .describe("Source project whose memory will be linked"),
      child_project: z
        .string()
        .min(1)
        .max(64)
        .describe("Target project that will receive the link"),
    }),
  },
  async ({ parent_project, child_project }) => {
    try {
      const result = await handleRemember(parent_project, child_project);
      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// === Tool: synaphex_settings ===

server.registerTool(
  "settings",
  {
    description:
      "Read a synaphex project's agent settings and return a formatted table " +
      "with model, think, effort config and model capabilities",
    inputSchema: z.object({
      project: z.string().min(1).max(64).describe("Project name"),
    }),
  },
  async ({ project }) => {
    try {
      const result = await handleSettingsRead(project);
      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// === Tool: synaphex_update_settings ===

server.registerTool(
  "update_settings",
  {
    description:
      "Update one or more agent configs in a synaphex project's settings.json. " +
      "Validates model capabilities, think support, and effort constraints.",
    inputSchema: z.object({
      project: z.string().min(1).max(64).describe("Project name"),
      updates: z
        .record(
          z.enum([
            "examiner",
            "researcher",
            "planner",
            "coder",
            "answerer",
            "reviewer",
          ]),
          z
            .object({
              model: z.string().optional().describe("Model ID or alias"),
              think: z
                .boolean()
                .optional()
                .describe("Enable extended thinking"),
              effort: z
                .number()
                .int()
                .min(0)
                .max(4)
                .optional()
                .describe("Effort tier 0-4"),
              provider: z
                .literal("claude")
                .optional()
                .describe("Provider (claude only)"),
              mode: z
                .enum(["direct", "delegated"])
                .optional()
                .describe(
                  "Agent mode: direct (API call) or delegated (IDE model)",
                ),
            })
            .strict(),
        )
        .describe("Map of agent name to partial config update"),
    }),
  },
  async ({ project, updates }) => {
    try {
      const result = await handleSettingsUpdate(project, updates);
      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// === Tool: synaphex_task_start ===

server.registerTool(
  "task_create",
  {
    description:
      "Initialize a new synaphex task. Creates task directory, returns memory digest and settings.",
    inputSchema: z.object({
      project: z.string().min(1).max(64).describe("Project name"),
      task: z.string().min(1).describe("Task description sentence"),
      cwd: z.string().min(1).describe("Absolute path to the working directory"),
      mode: z.enum(["task", "fix"]).describe("Pipeline mode"),
    }),
  },
  async ({ project, task, cwd, mode }) => {
    try {
      const result = await handleTaskCreate(project, task, cwd, mode);
      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// === Tool: synaphex_task_examine ===

server.registerTool(
  "task_examine",
  {
    description:
      "Run the Examiner agent to analyze codebase and memory for a task. " +
      "Returns compact analysis for downstream agents.",
    inputSchema: z.object({
      project: z.string().min(1).max(64).describe("Project name"),
      slug: z.string().min(1).describe("Task slug from task_start"),
      cwd: z.string().min(1).describe("Absolute path to the working directory"),
      task: z.string().min(1).describe("Task description"),
      memory_digest: z.string().describe("Memory digest from task_start"),
    }),
  },
  async ({ project, slug, cwd, task, memory_digest }) => {
    try {
      const result = await handleTaskExamine(
        project,
        slug,
        cwd,
        task,
        memory_digest,
      );
      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// === Tool: synaphex_task_plan ===

server.registerTool(
  "task_planner",
  {
    description:
      "Run the Planner agent to create an implementation plan from examiner output.",
    inputSchema: z.object({
      project: z.string().min(1).max(64).describe("Project name"),
      slug: z.string().min(1).describe("Task slug"),
      task: z.string().min(1).describe("Task description"),
      cwd: z.string().min(1).describe("Absolute path to the working directory"),
      examiner_compact: z.string().describe("Compact analysis from Examiner"),
      reviewer_feedback: z
        .string()
        .optional()
        .describe("Feedback from previous review iteration"),
      iteration: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Plan iteration number"),
    }),
  },
  async ({
    project,
    slug,
    task,
    cwd,
    examiner_compact,
    reviewer_feedback,
    iteration,
  }) => {
    try {
      const result = await handleTaskPlanner(
        project,
        slug,
        task,
        cwd,
        examiner_compact,
        reviewer_feedback,
        iteration,
      );
      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// === Tool: synaphex_task_implement ===

server.registerTool(
  "task_coder",
  {
    description:
      "Run the Coder agent to implement the plan. " +
      "Coder uses file tools and can ask the Answerer agent questions.",
    inputSchema: z.object({
      project: z.string().min(1).max(64).describe("Project name"),
      slug: z.string().min(1).describe("Task slug"),
      task: z.string().min(1).describe("Task description"),
      cwd: z.string().min(1).describe("Absolute path to the working directory"),
      plan: z.string().describe("Implementation plan from Planner"),
      examiner_compact: z.string().describe("Compact analysis from Examiner"),
      memory_digest: z.string().describe("Memory digest"),
      iteration: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Implementation iteration"),
    }),
  },
  async ({
    project,
    slug,
    task,
    cwd,
    plan,
    examiner_compact,
    memory_digest,
    iteration,
  }) => {
    try {
      const result = await handleTaskCoder(
        project,
        slug,
        task,
        cwd,
        plan,
        examiner_compact,
        memory_digest,
        iteration,
      );
      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// === Tool: synaphex_task_review ===

server.registerTool(
  "task_reviewer",
  {
    description:
      "Run the Reviewer agent to check implementation quality. " +
      "Returns verdict (approved/needs_changes) and feedback.",
    inputSchema: z.object({
      project: z.string().min(1).max(64).describe("Project name"),
      slug: z.string().min(1).describe("Task slug"),
      task: z.string().min(1).describe("Task description"),
      cwd: z.string().min(1).describe("Absolute path to the working directory"),
      plan: z.string().describe("Implementation plan"),
      implementation_summary: z
        .string()
        .describe("Coder's implementation summary"),
      examiner_compact: z.string().describe("Compact analysis from Examiner"),
      iteration: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Review iteration"),
    }),
  },
  async ({
    project,
    slug,
    task,
    cwd,
    plan,
    implementation_summary,
    examiner_compact,
    iteration,
  }) => {
    try {
      const result = await handleTaskReviewer(
        project,
        slug,
        task,
        cwd,
        plan,
        implementation_summary,
        examiner_compact,
        iteration,
      );
      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// === Tool: synaphex_task_researcher ===

server.registerTool(
  "task_researcher",
  {
    description:
      "Run the Researcher agent to perform internet research on unknown topics and update project memory.",
    inputSchema: z.object({
      project: z.string().min(1).max(64).describe("Project name"),
      slug: z.string().min(1).describe("Task slug"),
      task: z.string().min(1).describe("Task description"),
      cwd: z.string().min(1).describe("Absolute path to the working directory"),
      examiner_compact: z.string().describe("Compact analysis from Examiner"),
    }),
  },
  async ({ project, slug, task, cwd, examiner_compact }) => {
    try {
      const result = await handleTaskResearcher(
        project,
        slug,
        task,
        cwd,
        examiner_compact,
      );
      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// === Tool: synaphex_task_answerer ===

server.registerTool(
  "task_answerer",
  {
    description:
      "Run the Answerer agent to answer Coder questions and escalate architectural decisions.",
    inputSchema: z.object({
      project: z.string().min(1).max(64).describe("Project name"),
      slug: z.string().min(1).describe("Task slug"),
      task: z.string().min(1).describe("Task description"),
      cwd: z.string().min(1).describe("Absolute path to the working directory"),
      implementation_summary: z
        .string()
        .describe("Coder's implementation summary"),
    }),
  },
  async ({ project, slug, task, cwd, implementation_summary }) => {
    try {
      const result = await handleTaskAnswerer(
        project,
        slug,
        task,
        cwd,
        implementation_summary,
      );
      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// === Tool: synaphex_task_remember ===

server.registerTool(
  "task_remember",
  {
    description:
      "Link parent project's internal memory into child project's task before running task-examine.",
    inputSchema: z.object({
      parent_project: z.string().min(1).max(64).describe("Parent project name"),
      project: z.string().min(1).max(64).describe("Child project name"),
      slug: z.string().min(1).describe("Task slug"),
    }),
  },
  async ({ parent_project, project, slug }) => {
    try {
      const result = await handleTaskRemember(parent_project, project, slug);
      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// === Start server ===

import { handleSetup } from "./commands/setup.js";

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg === "setup") {
    const platform = process.argv[3];
    await handleSetup(platform);
    process.exit(0);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[synaphex] MCP server started on stdio");
}

main().catch((err) => {
  console.error("[synaphex] Fatal error:", err);
  process.exit(1);
});
