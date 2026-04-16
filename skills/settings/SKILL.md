---
name: settings
description: Read or update a synaphex project's agent settings.
argument-hint: <project-name>
allowed-tools:
  [
    "mcp__synaphex__synaphex_settings",
    "mcp__synaphex__synaphex_update_settings",
  ]
disable-model-invocation: true
user-invocable: true
---

View and edit synaphex agent settings interactively.

## Step 1: Read current settings

Call the `settings` MCP tool with the project name from `$ARGUMENTS`.

Present the returned table to the user exactly as received. It shows all six agents (examiner, researcher, planner, coder, answerer, reviewer) with their current model, think, and effort settings, plus a model reference section.

## Step 2: Ask what to change

Ask the user which agent(s) they want to configure. Accept any of these interaction styles:

- A specific agent name: "change planner"
- Multiple agents: "set examiner and coder to opus"
- All agents: "set all agents to sonnet"
- A specific field: "enable thinking for answerer"
- Bulk changes: "set effort to 4 for all thinking agents"

## Step 3: Collect field values

For each agent being changed, determine which fields to update. Guide the user with these rules:

- **model**: Must be one of the models listed in the Model Reference table. Accept shorthand ("opus" -> "claude-opus-4-6", "sonnet" -> "claude-sonnet-4-6", "haiku" -> "claude-haiku-4-5").
- **think**: true or false. Can only be true if the model supports thinking (see Capabilities column).
- **effort**: 0-4. If think is being set to false (or is already false), effort must be 0 — set it automatically and inform the user.
- **provider**: Always "claude" for now. Do not ask about this field.

If the user's request would create an invalid combination (e.g., enabling thinking on a model that doesn't support it), explain why it is invalid and ask for an alternative.

## Step 4: Apply changes

Call the `update_settings` MCP tool with:

- `project`: the project name
- `updates`: an object mapping each agent name to the fields being changed

Example call for changing planner to sonnet with thinking off:

```json
{
  "project": "my-project",
  "updates": {
    "planner": {
      "model": "claude-sonnet-4-6",
      "think": false,
      "effort": 0
    }
  }
}
```

When resolving shorthand model names, always pass the full canonical ID to the tool:

- "opus" or "opus 4.6" -> `claude-opus-4-6`
- "sonnet" or "sonnet 4.6" -> `claude-sonnet-4-6`
- "haiku" or "haiku 4.5" -> `claude-haiku-4-5`

## Step 5: Confirm

Show the changes returned by the tool. If the tool reports that effort was auto-corrected (forced to 0 because think=off), mention this to the user.

If the tool returns a validation error, explain the issue clearly and ask the user to pick a valid option.

## Step 6: Continue or finish

Ask: "Would you like to change anything else?" If yes, repeat from Step 2. If no, end with a brief summary of the final state.
