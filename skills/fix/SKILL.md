---
name: fix
description: Run the synaphex bug-fix pipeline.
argument-hint: <project> <bug-description>
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

# Synaphex Bug-Fix Pipeline

Run a specialized pipeline to fix a bug in project `$ARGUMENTS`.

1. **Initialize**: Call `task` with `mode: "fix"`.
2. **Examine**: Use `examine` with the returned memory digest.
3. **Plan**: Use `plan` with the examiner output.
4. **Implement**: Use `implement`.
5. **Review**: Use `review` to confirm the fix.

Iterate until the bug is resolved and tests pass.
