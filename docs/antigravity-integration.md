# Antigravity IDE Integration

Synaphex can be easily integrated into **Antigravity IDE** as an MCP server. Since Synaphex uses its **Delegated Mode** by default, it perfectly pairs with Antigravity to utilize the IDE's built-in conversational models to execute the agent pipeline without needing any `ANTHROPIC_API_KEY`.

## 1. Installation & Configuration

### Option A: Automated Setup [RECOMMENDED]

Synaphex can automatically configure itself for Antigravity, including absolute path detection for Node/NVM. Run the following in your terminal:

```bash
npx -y synaphex setup antigravity
```

This will:

1. Detect your modern Node.js path (avoiding Antigravity's internal v10 conflicts).
2. Update **`~/.gemini/antigravity/mcp_config.json`** with the correct server entry.
3. Automatically link the Synaphex skills to your home directory.

### Option B: Manual Using NPX (Requires Shell Wrapper)

If you prefer to configure manually, you must trigger a login shell so that your modern Node version managers take priority:

```json
{
  "mcpServers": {
    "synaphex": {
      "command": "bash",
      "args": ["-ic", "npx -y synaphex@latest"]
    }
  }
}
```

_(Note: `-ic` ensures bash loads interactive configurations like your `fnm env` or `nvm` bindings from your shell profiles.)_

### Option B: Local Development Build (Safest Alternative)

If you are developing Synaphex locally:

1. **Build Synaphex Local Project**

   ```bash
   cd /path/to/synaphex
   npm install
   npm run build
   ```

2. **Retrieve Node Path (Crucial for Antigravity)**
   Antigravity runs an isolated version of Node (v10.x). You must find the absolute path to your active Node.js binary (e.g., via `fnm`, `nvm` or system).

   ```bash
   which node
   ```

3. **Configure mcp_config.json**
   Link the path to your modern node binary and the `dist/index.js`:

   ```json
   {
     "mcpServers": {
       "synaphex": {
         "command": "/ABSOLUTE/PATH/TO/YOUR/NODE/HERE",
         "args": ["/ABSOLUTE/PATH/TO/synaphex/dist/index.js"]
       }
     }
   }
   ```

4. **Refresh MCP Servers**
   In Antigravity IDE, go to `MCP Settings` -> `Manage MCP Servers` and click **Refresh**. You should see `synaphex` listed as **enabled**.

## Model Delegation & Configuration

Since Synaphex defaults to **Delegated Mode**, the IDE's internal model (Gemini, Claude, GPT) is responsible for executing agent tasks.

### Antigravity-Native Model IDs

You can configure each agent in `~/.synaphex/<project>/settings.json` to use Antigravity's specific model selection. Synaphex supports the following native IDs for display in transition notes:

- `claude-opus-4-6-thinking` — Recommended for **Planner** and **Reviewer**
- `claude-sonnet-4-6-thinking` — Recommended for **Coder** and **Examiner**
- `gemini-3.1-pro-high`
- `gemini-3-flash` — Recommended for **Answerer**
- `gpt-oss-120b`

### Model Transition Hints

When moving from one agent to another (e.g., from **Coder** to **Reviewer**), Synaphex will check if the next agent requires a different model (e.g., switching from Sonnet to Opus with Thinking). It will provide an advisory note in the chat:

> ⚠️ **Model Switch Recommended**
> Next agent: **Reviewer** — configured for **Claude Opus 4.6 (Thinking)**.
> Current model: Claude Sonnet 4.6 (Thinking).
> Please switch your IDE model to **"Claude Opus 4.6 (Thinking)"** before calling the next step.

1. **Creating a Project**
   In your chat window, ask the agent:

   > _"Run the 'create' tool for a new synaphex project named 'my_app'."_

2. **Building Context Memory**
   Initialize memory by analyzing your source code:

   > _"Use the 'memorize' tool to analyze the directory /path/to/my_app for the 'my_app' project."_

3. **Starting a Task (Pipeline)**
   To use the multi-agent pipeline:

   > _"Run the 'task' tool on 'my_app' for the requirement 'Create a login API endpoint'."_

   The IDE model will automatically receive the task instructions. From there, it will guide you through the pipeline step-by-step using these tool calls:
   - `examine`
   - `plan`
   - `implement`
   - `review`

> **Note: Tool Discovery**
> Antigravity IDE and other MCP extensions generally do **NOT** display MCP tools as slash commands. Instead, the tools are cleanly exported as `task`, `create`, `memorize`, etc. They will appear in the IDE autocomplete (e.g., `@mcp:synaphex:task`) or can be triggered via natural language.

Instead of Synaphex calling out to the Anthropic API internally, each step returns a prompt back to Antigravity's model, allowing the LLM _within_ the IDE (Gemini, Claude, GPT, etc.) to securely read, write, and execute the task!
