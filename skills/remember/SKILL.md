---
name: remember
description: Link one project's memory into another project's external memory.
argument-hint: <source-project> <target-project>
allowed-tools: ["mcp__synaphex__remember", "remember"]
user-invocable: true
---

Link the memory of `<source-project>` into the external memory directory of `<target-project>`.

Call the `remember` tool with `parent_project` and `child_project`. This allows the agents working on the child project to access and utilize knowledge documented in the parent project.
