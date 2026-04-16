# VSCode Integration (Claude Code / Copilot)

Synaphex can be integrated into **VSCode** via the **Claude Code extension**, **GitHub Copilot Chat**, or any other MCP-compatible client. Since Synaphex defaults to **Delegated Mode**, no API keys are required — the IDE's own model handles all agent tasks.

> **TODO: Direct Mode API Keys**
> Per-provider API key support (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, etc.) for `"mode": "direct"` is planned but not yet implemented. When available, these will be injected via the `env` field in your `mcp.json`. For now, all pipelines run in `delegated` mode leveraging the IDE model.

---

## 1. MCP Server Setup

### Option A: Using NPX (Recommended)

```json
{
  "mcpServers": {
    "synaphex": {
      "command": "npx",
      "args": ["-y", "synaphex@latest"]
    }
  }
}
```

### Option B: Using a Local Build

```json
{
  "mcpServers": {
    "synaphex": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/synaphex/dist/index.js"]
    }
  }
}
```

---

## 2. Claude Code Extension

### Slash Commands

The Claude Code extension registers all Synaphex skills as clean slash commands (no prefix):

| Command                        | Description                           |
| ------------------------------ | ------------------------------------- |
| `/create <project>`            | Create a new Synaphex project         |
| `/memorize <project> <path>`   | Populate memory from a codebase       |
| `/task <project> <task>`       | Run the full agent pipeline           |
| `/load <project>`              | Load project memory + settings digest |
| `/settings <project>`          | View agent configuration              |
| `/fix <project> <description>` | Run a bug-fix pipeline                |

_Note: Ensure your `node` on `PATH` is Node.js 18+. If you use `fnm` or `nvm`, wrap the launch: `eval "$(fnm env)" && claude`_

### Model Configuration for Claude Code

Configure each agent in `~/.synaphex/<project>/settings.json` using Claude Code model IDs:

| ID                         | Label                           | Recommended For   |
| -------------------------- | ------------------------------- | ----------------- |
| `claude-opus-4-6-vscode`   | Claude Opus 4.6 (Claude Code)   | Planner, Reviewer |
| `claude-sonnet-4-6-vscode` | Claude Sonnet 4.6 (Claude Code) | Coder, Examiner   |
| `claude-haiku-4-5-vscode`  | Claude Haiku 4.5 (Claude Code)  | Answerer          |

**How to switch models:** Type `/model` in the Claude Code chat panel to open the model selector.

### Model Transition Hints

When the pipeline moves from one agent to the next, Synaphex checks if the configured model changes and shows a notification:

```
⚠️ Model Switch Recommended
Next agent: Reviewer — configured for Claude Opus 4.6 (Claude Code).
Current model: Claude Sonnet 4.6 (Claude Code).
Please switch your IDE model to "Claude Opus 4.6 (Claude Code)" via /model before calling the next step.
```

Since Claude Code does not support automated model switching, you must change the model manually using `/model` before calling the next pipeline tool.

---

## 3. GitHub Copilot Chat

### Using Synaphex Tools

In the Copilot Chat panel (`Ctrl+Alt+I`), you can invoke Synaphex tools via natural language or by referencing the MCP tool name directly:

1. _"Run the `create` tool to create a synaphex project called `webapp`."_
2. _"Use the `memorize` tool to analyze `/path/to/webapp` for the `webapp` project."_
3. _"Run `task_start` on the `webapp` project for the task 'Add authentication middleware'."_

The pipeline will step through `task_examine` → `task_plan` → `task_implement` → `task_review` automatically.

### Model Configuration for GitHub Copilot

Configure each agent in `~/.synaphex/<project>/settings.json` using Copilot model IDs:

| ID                          | Label                       | Recommended For   |
| --------------------------- | --------------------------- | ----------------- |
| `copilot-claude-opus-4-6`   | Claude Opus 4.6 (Copilot)   | Planner, Reviewer |
| `copilot-claude-sonnet-4-6` | Claude Sonnet 4.6 (Copilot) | Coder, Examiner   |
| `copilot-gpt-4.1`           | GPT-4.1 (Copilot)           | General purpose   |
| `copilot-gpt-4o`            | GPT-4o (Copilot)            | Fast tasks        |
| `copilot-gemini-2.5-pro`    | Gemini 2.5 Pro (Copilot)    | Complex reasoning |
| `copilot-gemini-2.0-flash`  | Gemini 2.0 Flash (Copilot)  | Answerer          |

**How to switch models:** Use the model picker dropdown at the top of the Copilot Chat panel.

### Model Transition Hints

When an agent transition requires a different model, Synaphex shows an advisory in the chat:

```
⚠️ Model Switch Recommended
Next agent: Reviewer — configured for Claude Opus 4.6 (Copilot) with extended thinking enabled.
Current model: GPT-4o (Copilot).
Please switch your IDE model to "Claude Opus 4.6 (Copilot)" using the model picker before calling the next step.
```

Copilot does not support automated model switching via MCP — switch manually using the model picker before calling the next tool.

---

## 4. Troubleshooting: Cleaning Up Legacy Commands

If you still see old `/synaphex:*` commands in your autocomplete list after an update:

1. **Clear Global Cache:**

   ```bash
   rm -rf ~/.claude/skills
   rm -rf ~/.npm/_npx
   ```

2. **Uninstall Legacy Globals:**

   ```bash
   npm uninstall -g synaphex
   ```

3. **Reload VSCode:**
   Use the `Developer: Reload Window` command (`Ctrl+Shift+P`) to refresh all MCP tool registries.
