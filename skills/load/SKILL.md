---
name: load
description: Load a synaphex project and return its memory + settings digest.
argument-hint: <project>
allowed-tools: ["mcp__synaphex__load", "load"]
user-invocable: true
---

Load the memory and settings for project `$ARGUMENTS`.

Call the `load` tool to retrieve a compact digest of the project's internal and external memory, along with current agent settings. This is usually the first step when starting a new conversation about an existing project.
