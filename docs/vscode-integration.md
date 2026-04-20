# VSCode Integration (Claude Code / Copilot)

Synaphex can be integrated into **VSCode** via the **Claude Code extension**, **GitHub Copilot Chat**, or any other MCP-compatible client. Since Synaphex defaults to **Delegated Mode**, no API keys are required — the IDE's own model handles all agent tasks.

> **TODO: Direct Mode API Keys**
> Per-provider API key support (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, etc.) for `"mode": "direct"` is planned but not yet implemented. When available, these will be injected via the `env` field in your `mcp.json`. For now, all pipelines run in `delegated` mode leveraging the IDE model.

---

## 1. MCP Server Setup

### Option A: Absolute `node` + script path (Recommended)

The VS Code extension spawns MCP servers with a minimal environment that does **not** inherit nvm/fnm shims. `npx` or the bare `synaphex` shebang script will fail with `MCP error -32000: Connection closed`. Always register with absolute paths:

```bash
npm install -g synaphex
claude mcp remove synaphex -s user 2>/dev/null
claude mcp add synaphex --scope user -- $(which node) $(npm root -g)/synaphex/dist/index.js
```

This is what `synaphex init` writes to `~/.claude.json` automatically since v2.3.12.

Equivalent `mcp.json` form:

```json
{
  "mcpServers": {
    "synaphex": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/global/node_modules/synaphex/dist/index.js"]
    }
  }
}
```

### Option B: NPX (CLI-only, not reliable in VS Code extension)

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

Works in `claude mcp list` from a terminal, but the VS Code extension's spawn environment typically lacks `npx` on the PATH. Prefer Option A.

---

## 2. Claude Code Extension

### Slash Commands

The Claude Code extension registers Synaphex skills as namespaced slash commands:

| Command                            | Description                           |
| ---------------------------------- | ------------------------------------- |
| `/synaphex:create <project>`       | Create a new Synaphex project         |
| `/synaphex:memorize <project> <p>` | Populate memory from a codebase       |
| `/synaphex:task <project> <task>`  | Run the full agent pipeline           |
| `/synaphex:load <project>`         | Load project memory + settings digest |
| `/synaphex:settings <project>`     | View agent configuration              |
| `/synaphex:fix <project> <desc>`   | Run a bug-fix pipeline                |

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

| ID                         | Label                            | Recommended For    |
| -------------------------- | -------------------------------- | ------------------ |
| `copilot-gpt-5.2`          | GPT-5.2 (Copilot)                | Planner, Reviewer  |
| `copilot-gemini-3.1-pro`   | Gemini 3.1 Pro Preview (Copilot) | Planner, Reviewer  |
| `copilot-gpt-4o`           | GPT-4o (Copilot)                 | Coder, Examiner    |
| `copilot-gpt-5.2-codex`    | GPT-5.2-Codex (Copilot)          | Coder              |
| `copilot-gpt-5.3-codex`    | GPT-5.3-Codex (Copilot)          | Coder              |
| `copilot-claude-haiku-4-5` | Claude Haiku 4.5 (Copilot)       | Answerer, Examiner |
| `copilot-gemini-3-flash`   | Gemini 3 Flash Preview (Copilot) | Answerer           |
| `copilot-gpt-5-mini`       | GPT-5 mini (Copilot)             | Answerer           |
| `copilot-gpt-5.4-mini`     | GPT-5.4 mini (Copilot)           | Answerer           |

**How to switch models:** Use the model picker dropdown at the top of the Copilot Chat panel.

### Model Transition Hints

When an agent transition requires a different model, Synaphex shows an advisory in the chat:

```
⚠️ Model Switch Recommended
Next agent: Reviewer — configured for GPT-5.2 (Copilot) with extended thinking enabled.
Current model: GPT-5.2-Codex (Copilot).
Please switch your IDE model to "GPT-5.2 (Copilot)" using the model picker before calling the next step.
```

Copilot does not support automated model switching via MCP — switch manually using the model picker before calling the next tool.

---

## 4. Troubleshooting: Restoring Slash Commands (`/`)

If you are using the **VSCode Extension** or **Antigravity** and do not see the slash commands (like `/synaphex:task` or `/synaphex:create`) in your menu, follow these steps:

### The Easy Way: Automated Plugin Setup [RECOMMENDED]

Synaphex is now a full **Claude Code Plugin**. This is the standard way to ensure all slash commands are registered correctly in v4.6+.

Run the appropriate command in your terminal:

```bash
# For Claude Code
npx -y synaphex setup claude

# For GitHub Copilot / VS Code
npx -y synaphex setup copilot

# For Antigravity
npx -y synaphex setup antigravity
```

> [!IMPORTANT]
> In Plugin Mode, commands are namespaced with the plugin name. Instead of `/create`, you should type **`/synaphex:create`**. This prevents conflicts with other installed plugins.

If you see duplicate commands or "Command not found" errors:

1. **Run the new automated setup**:

   ```bash
   npx -y synaphex@latest setup claude
   ```

   _The setup wizard now handles cleaning up legacy links and creating a resilient multi-path registration._

2. **Clear NPX cache**:

   ```bash
   rm -rf ~/.npm/_npx
   ```

Then reload the window again.

---

## 6. Model Switching in VSCode
