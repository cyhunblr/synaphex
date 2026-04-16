---
name: load
description: Load a synaphex project and return its memory + settings digest.
argument-hint: <project-name>
allowed-tools: ["mcp__synaphex__synaphex_load"]
disable-model-invocation: true
user-invocable: true
---

Load a synaphex project into the current session.

Call the `load` MCP tool with the project name from `$ARGUMENTS`.

The tool returns a markdown digest containing:

- Project settings summary (agent configuration)
- All internal memory files with status (empty or populated)
- All external memory files (linked from other projects)

Present the full digest to the user. This context is now available for the rest of the session.

If the project does not exist, the tool returns an error. Tell the user to create it first with `/create <project-name>`.
