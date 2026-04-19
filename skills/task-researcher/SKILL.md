---
name: task-researcher
description: Run the Researcher agent to gather external knowledge and document findings in memory.
argument-hint: <project> <slug> <topic>
allowed-tools: ["mcp__synaphex__task_researcher", "task_researcher"]
disable-model-invocation: true
user-invocable: true
---

Run the Researcher agent to gather and document external knowledge.

Call `task_researcher` MCP tool with:

- project name
- task slug
- research topic or question
- optional: existing findings to extend

The Researcher will:

1. Search for relevant information (web search, documentation)
2. Analyze findings and extract key insights
3. Write structured research document to memory
4. Cache findings for future reference
5. Return research summary

**Optional step**: Can be run during any phase to gather knowledge.

**Use cases**:

- Gather domain knowledge before planning
- Research libraries or frameworks during implementation
- Document best practices for architecture decisions
- Find examples or reference implementations

**Output**: Research findings saved to `memory/internal/research/<topic>.md`

After research completes, return to relevant step (examine, planner, coder) with newfound knowledge.
