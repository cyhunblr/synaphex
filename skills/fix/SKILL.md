---
name: fix
description: Run the synaphex bug-fix pipeline.
argument-hint: <project> <bug-description>
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

# Synaphex Bug-Fix Pipeline

Run a specialized pipeline to fix a bug in project `$ARGUMENTS`.

1. **Initialize**: Call `task_start` with `mode: "fix"`.
2. **Examine**: Use `task_examine` with the returned memory digest.
3. **Plan**: Use `task_plan` with the examiner output.
4. **Implement**: Use `task_implement`.
5. **Review**: Use `task_review` to confirm the fix.

Iterate until the bug is resolved and tests pass.
