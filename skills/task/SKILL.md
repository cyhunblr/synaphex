---
name: task
description: Run the full synaphex multi-agent task pipeline.
argument-hint: <project> <task-description>
allowed-tools:
  [
    "mcp__synaphex__task",
    "mcp__synaphex__examine",
    "mcp__synaphex__plan",
    "mcp__synaphex__implement",
    "mcp__synaphex__review",
    "mcp__synaphex__write_memory",
    "task",
    "examine",
    "plan",
    "implement",
    "review",
    "write_memory",
  ]
user-invocable: true
---

# Synaphex Multi-Agent Pipeline

Run a full agentic pipeline to solve a task using the memory of project `$ARGUMENTS`.

1. **Initialize**: Call `task` with `mode: "task"`.
2. **Examine**: Use `examine` with the returned memory digest.
3. **Plan**: Use `plan` with the examiner output.
4. **Implement**: Use `implement` once the plan is solid. Coder will use `write_memory` and normal file tools.
5. **Review**: Use `review` to confirm quality.

Iterate on Plan/Implement/Review as needed until the task is complete.
