# VSCode Integration (Claude Code / Copilot)

Synaphex can be utilized directly inside **VSCode** using tools like the **Claude Code** CLI extension, **GitHub Copilot Chat**, or any other MCP-compatible client.

## 1. Claude Code CLI Integration

Claude Code allows loading local plugins.

**Setup:**

1. Clone and build the project:

   ```bash
   npm install
   npm run build
   ```

2. Start your Claude Code session linking the local folder as a plugin:

   ```bash
   claude --plugin-dir /path/to/synaphex
   ```

**Usage Context:**
Claude Code will automatically register all `/synaphex:XXX` endpoints. Once inside the CLI:

- Run `/synaphex:create my_project` to structure memory.
- Run `/synaphex:memorize my_project ./src` to scan your repository.
- Use the standard `/synaphex:task_start`, `task_examine`, etc., commands to operate the agent pipeline.

_Note: Make sure your system `node` on `PATH` is NodeJS 18+. If you are using `fnm` or `nvm`, invoke Claude Code wrapped with it, e.g., `eval "$(fnm env)" && claude ...`_

## 2. Setting Up `.mcp.json` / VSCode Extensions

If you are using a VSCode extension (like Claude for VSCode, Cline, or Copilot MCP configurations), you can use the standard MCP configuration format to wire Synaphex up.

**Configuration File (`mcp.json` or equivalent):**

```json
{
  "mcpServers": {
    "synaphex": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/synaphex/dist/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "YOUR_KEY_HERE"
      }
    }
  }
}
```

> **Direct vs Delegated Mode:**
> By default, Synaphex uses `delegated` mode, meaning it will return a prompt packet for the IDE's model to process. If you want Synaphex to autonomously handle LLM calls in the background using Anthropic APIs, you can edit the `~/.synaphex/<project>/settings.json` file and change `"mode": "delegated"` to `"mode": "direct"`. In `"direct"` mode, you **must** supply the `ANTHROPIC_API_KEY` via `env`.

## Using the Agents in the Editor Chat

In your editor's AI chat window (e.g., Copilot Chat / Cline tab):

1. Ask the AI to call the tool: _"Create a new synaphex project called `webapp`."_
2. Ask it to memorize files: _"Use synaphex to memorize the current directory for the `webapp` project."_
3. Kick off pipelines: _"Run the synaphex task start pipeline for the task 'Refactor the authentication flow'."_

The IDE's Agent will execute the tool, receive the Synaphex Agent packet, and systematically step through the instructions.
