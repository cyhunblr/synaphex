---
name: settings
description: View or edit agent settings for a Synaphex project.
argument-hint: <project>
allowed-tools:
  [
    "mcp__synaphex__settings",
    "mcp__synaphex__update_settings",
    "settings",
    "update_settings",
  ]
user-invocable: true
---

View or edit agent configuration for project `$ARGUMENTS`.

1. Call `settings` to view the current configuration (model, thinking, effort).
2. To update settings, call `update_settings` with the project name and the map of updates.

Example change:
`update_settings(project: "my-proj", updates: { coder: { model: "claude-3-7-sonnet-latest", think: true, effort: 1 } })`
