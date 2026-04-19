---
name: task-create
description: Initialize a new task in a synaphex project and create task-meta.json with memory digest.
argument-hint: <project> <task-description>
allowed-tools: ["mcp__synaphex__task_create", "task_create"]
disable-model-invocation: true
user-invocable: true
---

Initialize a new task in project `$ARGUMENTS`.

Call the `task_create` MCP tool with:

- project name
- task description
- working directory
- mode: "task"

The tool will:

1. Create task directory under `memory/internal/tasks/<slug>/`
2. Generate task-meta.json with initial state "created"
3. Return memory digest for the project
4. Return task slug for subsequent commands

After successful creation, the next step is to run `/synaphex:task-examine` to analyze the codebase and memory.
