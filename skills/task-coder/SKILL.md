---
name: task-coder
description: Run the Coder agent to implement the planned solution and make code changes.
argument-hint: <project> <slug> <task-description> <plan>
allowed-tools: ["mcp__synaphex__task_coder", "task_coder"]
disable-model-invocation: true
user-invocable: true
---

Run the Coder agent to implement the plan.

Call `task_coder` MCP tool with:

- project name
- task slug
- task description
- working directory
- plan from task_planner
- examiner analysis
- memory digest
- iteration number

The Coder will:

1. Follow the plan step-by-step
2. Make code changes to the codebase
3. Update memory with implementation progress
4. Ask Answerer for clarification if needed (escalation)
5. Return list of files changed, created, deleted

**Execution order**: Runs after task-planner, required before task-reviewer.

After implementation, proceed to `/synaphex:task-reviewer` to review the changes.
