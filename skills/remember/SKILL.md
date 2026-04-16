---
name: remember
description: Link one project's memory into another project's external memory.
argument-hint: <parent-project> <child-project>
allowed-tools: ["mcp__synaphex__synaphex_remember"]
disable-model-invocation: true
user-invocable: true
---

Link one project's memory into another.

Parse the arguments: the first token is the parent project (source), the second token is the child project (target).

Call the `remember` MCP tool with `parent_project` = first arg and `child_project` = second arg.

The tool will:

1. Create a symlink (or copy as fallback) from the parent's `memory/internal/` into the child's `memory/external/<parent>_memory`
2. If a link already exists from a previous run, replace it
3. Return a summary of what was linked

Report the result to the user.

**Error cases**:

- Either project does not exist → the tool returns an error
- Trying to link a project to itself → the tool returns an error

After linking, the child project can access the parent's memory via `/load <child>` or by running `/task` / `/fix` on the child (Phase 2).
