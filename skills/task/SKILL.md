---
name: task
description: Run the full synaphex multi-agent task pipeline.
argument-hint: <project> <task-description>
allowed-tools:
  [
    "mcp__synaphex__task_start",
    "mcp__synaphex__task_examine",
    "mcp__synaphex__task_plan",
    "mcp__synaphex__task_implement",
    "mcp__synaphex__task_review",
    "mcp__synaphex__write_memory",
    "task_start",
    "task_examine",
    "task_plan",
    "task_implement",
    "task_review",
    "write_memory",
  ]
user-invocable: true
---

# Synaphex Multi-Agent Pipeline

Run a full agentic pipeline to solve a task using the memory of project `$ARGUMENTS`.

1. **Initialize**: Call `task_start` with `mode: "task"`.
2. **Examine**: Use `task_examine` with the returned memory digest.
3. **Plan**: Use `task_plan` with the examiner output.
4. **Implement**: Use `task_implement` once the plan is solid. Coder will use `write_memory` and normal file tools.
5. **Review**: Use `task_review` to confirm quality.

Iterate on Plan/Implement/Review as needed until the task is complete.
