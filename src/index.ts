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
import { handleTaskStart } from "./commands/task-start.js";
import { handleTaskExamine } from "./commands/task-examine.js";
import { handleTaskPlan } from "./commands/task-plan.js";
import { handleTaskImplement } from "./commands/task-implement.js";
import { handleTaskReview } from "./commands/task-review.js";
import { handleWriteMemory } from "./commands/write-memory.js";

// === Server setup ===

const server = new McpServer({
  name: "synaphex",
  version: "0.1.0",
});

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

// === Tool: synaphex_write_memory ===

server.registerTool(
  "write_memory",
  {
    description:
      "Write content to a synaphex project's internal memory file. " +
      "Use this instead of the Write tool to save memory files — it handles path resolution automatically.",
    inputSchema: z.object({
      project: z.string().min(1).max(64).describe("Project name"),
      filename: z
        .string()
        .min(1)
        .describe(
          "Relative filename within memory/internal/ (e.g. 'overview.md', 'packages/my_pkg.md')",
        ),
      content: z.string().describe("Full markdown content to write"),
    }),
  },
  async ({ project, filename, content }) => {
    try {
      const result = await handleWriteMemory(project, filename, content);
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
  "task",
  {
    description:
      "Initialize a new synaphex task pipeline. Creates task directory, returns memory digest and settings.",
    inputSchema: z.object({
      project: z.string().min(1).max(64).describe("Project name"),
      task: z.string().min(1).describe("Task description sentence"),
      cwd: z.string().min(1).describe("Absolute path to the working directory"),
      mode: z.enum(["task", "fix"]).describe("Pipeline mode"),
    }),
  },
  async ({ project, task, cwd, mode }) => {
    try {
      const result = await handleTaskStart(project, task, cwd, mode);
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
  "examine",
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
  "plan",
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
      const result = await handleTaskPlan(
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
  "implement",
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
      const result = await handleTaskImplement(
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
  "review",
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
      const result = await handleTaskReview(
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

// === Start server ===

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[synaphex] MCP server started on stdio");
}

main().catch((err) => {
  console.error("[synaphex] Fatal error:", err);
  process.exit(1);
});
