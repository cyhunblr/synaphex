---
name: task-reviewer
description: Run the Reviewer agent to evaluate implementation quality and approve or request changes.
argument-hint: <project> <slug> <task-description> <implementation>
allowed-tools: ["mcp__synaphex__task_reviewer", "task_reviewer"]
disable-model-invocation: true
user-invocable: true
---

Run the Reviewer agent to evaluate the implementation.

Call `task_reviewer` MCP tool with:

- project name
- task slug
- task description
- working directory
- implementation summary from task_coder

The Reviewer will:

1. Check if implementation meets task requirements
2. Verify code quality and best practices
3. Test if changes work correctly
4. Either approve (verdict: "approved") or request changes
5. Provide feedback for Planner if iteration needed

**Execution order**: Runs after task-coder, required as final step of core pipeline.

**Optional iteration**: If reviewer requests changes:

- Run `/synaphex:task-planner` again with feedback
- Then `/synaphex:task-coder` again
- Then return to `/synaphex:task-reviewer`

After approval, task is complete. Optional: run `/synaphex:task-answerer` for clarifications or `/synaphex:task-researcher` for documentation.
