---
name: set-planner
description: Configure the planner agent for a synaphex project with guided questions.
argument-hint: <project>
allowed-tools: ["mcp__synaphex__update_settings", "update_settings"]
user-invocable: true
---

# Configure Planner Agent

Configure the planner agent for project `$ARGUMENTS` interactively.

Ask the user three questions about planner configuration:

1. **Model selection**: Which Claude model should the planner use?
   - Options: Claude Opus 4.7, Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5

2. **Thinking mode**: Should extended thinking be enabled for detailed planning?
   - Options: Yes (ON), No (off)

3. **Effort level**: How much thinking budget should the planner use?
   - Options: Low (5k tokens), Medium (15k tokens), High (25k tokens), Max (32k tokens)

After collecting answers:

- Map Effort labels to numeric values: Low=1, Medium=2, High=3, Max=4
- Call `update_settings` with planner configuration
- Show confirmation of changes

Note: If thinking is OFF, effort will be automatically forced to 0 at runtime.
