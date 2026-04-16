---
name: memorize
description: Analyze a codebase and update project memory files.
argument-hint: <project> <source-path>
allowed-tools: ["mcp__synaphex__memorize", "memorize"]
user-invocable: true
---

Analyze the codebase at `<source-path>` and update the memory files for project `$ARGUMENTS`.

Call the `memorize` tool. It will return a set of instructions/summaries that should be applied to the project's internal memory files.
Note: You may need to call `write_memory` multiple times to apply the updates suggested by `memorize`.
