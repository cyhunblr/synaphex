---
name: task-planner
description: Run the Planner agent to create an implementation plan from examiner analysis.
argument-hint: <project> <slug> <task-description> <examiner-output>
allowed-tools: ["mcp__synaphex__task_planner", "task_planner"]
disable-model-invocation: true
user-invocable: true
---

Run the Planner agent to create an implementation strategy.

Call `task_planner` MCP tool with:

- project name
- task slug
- task description
- working directory
- compact analysis from task_examine
- optional reviewer feedback (for iteration)
- iteration number

The Planner will:

1. Analyze the examiner's findings
2. Break down the task into implementation steps
3. Create a detailed plan for the Coder to follow
4. Return structured plan for implementation

**Execution order**: Runs after task-examine, required before task-coder.

After planning, proceed to `/synaphex:task-coder` with the plan.
