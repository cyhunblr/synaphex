---
name: task-answerer
description: Run the Answerer agent to clarify questions from Coder or provide escalation answers.
argument-hint: <project> <slug> <question> <context>
allowed-tools: ["mcp__synaphex__task_answerer", "task_answerer"]
disable-model-invocation: true
user-invocable: true
---

Run the Answerer agent to provide clarification or answer escalation questions.

Call `task_answerer` MCP tool with:

- project name
- task slug
- escalation question from Coder
- context for the question

The Answerer will:

1. Review the escalation question and context
2. Analyze task description and memory
3. Provide clear answer or guidance
4. Return answer for Coder to continue implementation

**Optional step**: Only needed if Coder has escalation questions.

**Usage**: If Coder encounters ambiguity:

1. Coder escalates with question in task-meta.json
2. Run `/synaphex:task-answerer` with the question
3. Answerer provides response
4. Return to `/synaphex:task-coder` to continue with answer

After answer is provided, typically return to Coder for continued implementation.
