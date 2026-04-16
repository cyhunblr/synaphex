---
name: create
description: Create a new synaphex project with memory scaffold and default settings.
argument-hint: <project-name>
allowed-tools: ["mcp__synaphex__create", "create"]
disable-model-invocation: true
user-invocable: true
---

Create a new synaphex project.

Call the `create` MCP tool with the project name from `$ARGUMENTS`.

The tool will:

1. Create `~/.synaphex/<project>/` with `settings.json`, `meta.json`, and memory scaffold
2. Pre-populate topic-based memory files (overview, architecture, interfaces, build, conventions, security, glossary)
3. Create empty `memory/internal/packages/` and `memory/external/` directories

If the project already exists, the tool returns an error. Tell the user to delete the existing project directory manually if they want to start fresh.

After the tool returns, summarize what was created and guide them to the next step: `/memorize <project> <source-path>` to populate memory from a codebase.
