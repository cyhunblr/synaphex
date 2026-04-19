---
name: task-examine
description: Run the Examiner agent to analyze codebase and project memory for context.
argument-hint: <project> <slug> <working-directory> <task-description>
allowed-tools: ["mcp__synaphex__task_examine", "task_examine"]
disable-model-invocation: true
user-invocable: true
---

Run the Examiner agent to analyze codebase and memory.

Call `task_examine` MCP tool with:

- project name
- task slug (from task_create)
- working directory path
- task description
- memory digest (from task_create)

The Examiner will:

1. Read and analyze the codebase structure
2. Review project memory from memory/internal/
3. Understand prior context from external memory (if multi-project)
4. Return compact analysis for downstream agents

**Required step**: Must run after task-create before task-planner.

After examination completes, proceed to `/synaphex:task-planner` with the examiner output.
