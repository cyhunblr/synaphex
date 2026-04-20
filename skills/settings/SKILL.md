---
name: settings
description: View agent settings for a Synaphex project in a compact table.
argument-hint: <project>
allowed-tools: ["mcp__synaphex__settings", "settings"]
user-invocable: true
---

View the current agent configuration for project `$ARGUMENTS`.

Call `settings` with the project name to see a compact table showing:

- Agent name (examiner, researcher, planner, coder, answerer, reviewer)
- Current model
- Thinking enabled (ON/off)
- Effort level (0-4)

To configure an agent interactively, use one of the set-\* commands:

- `/synaphex:set-examiner <project>`
- `/synaphex:set-researcher <project>`
- `/synaphex:set-planner <project>`
- `/synaphex:set-coder <project>`
- `/synaphex:set-answerer <project>`
- `/synaphex:set-reviewer <project>`

Each command will ask 3 questions:

1. Which model? (Opus 4.7, Opus 4.6, Sonnet 4.6, Haiku 4.5)
2. Enable thinking? (Yes/No)
3. Effort level? (Low, Medium, High, Max)
