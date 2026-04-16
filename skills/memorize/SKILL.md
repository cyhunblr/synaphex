---
name: memorize
description: Analyze a source directory and populate or update a synaphex project's memory files.
argument-hint: <project-name> <source-path>
allowed-tools: mcp__synaphex__synaphex_memorize mcp__synaphex__synaphex_write_memory Read Glob Grep
disable-model-invocation: true
---

Memorize a source directory into a synaphex project's memory.

Parse the arguments: the first token is the project name, the remainder is the absolute source path.

Call the `synaphex_memorize` MCP tool with `project` = first arg and `path` = second arg.

The tool returns:

1. A file listing of the source directory (respecting .gitignore)
2. The current state of each memory file (empty or populated)
3. Change detection info (if this is an update run)
4. Detailed instructions for which memory file should contain what

Your job after receiving the tool response:

1. **Analyze the source code** — Use Read, Glob, and Grep to explore `<source-path>`. Understand the project structure, architecture, build system, conventions, and security model.
2. **Populate memory files** — For each topic-based memory file (overview.md, architecture.md, interfaces.md, build.md, conventions.md, security.md, glossary.md), write comprehensive content based on your analysis.
3. **Create package files** — For each ROS catkin package found (directory with package.xml), create `packages/<pkg>.md` documenting the package's purpose, nodes, topics, services, and dependencies.
4. **Write all files** — Use the `synaphex_write_memory` MCP tool (NOT the Write tool) to save each file. It takes `project`, `filename` (e.g., `overview.md` or `packages/my_pkg.md`), and `content`. The server resolves paths automatically.

On **UPDATE runs** (second and later runs):

- Preserve existing structure and accurate information
- Update facts that have changed (new files, new nodes, etc.)
- Remove references to deleted components
- Don't remove information that is still accurate

Be thorough. Read actual source files, not just directory names. The memory files become the project's persistent knowledge base for the 6-agent pipeline in Phase 2.
