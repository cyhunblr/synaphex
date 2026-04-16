# Antigravity IDE Integration

Synaphex can be easily integrated into **Antigravity IDE** as an MCP server. Since Synaphex uses its **Delegated Mode** by default, it perfectly pairs with Antigravity to utilize the IDE's built-in conversational models to execute the agent pipeline without needing any `ANTHROPIC_API_KEY`.

## Installation & Configuration

Synaphex can be run globally via `npx` (recommended for production) or built locally from source.

### Option A: Using NPX (Recommended)

You can directly execute the published package without cloning the repository.
In your `mcp_config.json`, simply configure npx to execute `synaphex`:

```json
{
  "mcpServers": {
    "synaphex": {
      "command": "npx",
      "args": ["-y", "synaphex"]
    }
  }
}
```

_(Note: Ensure your system's global `npx` is running on Node 18+)_

### Option B: Local Development Build

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

## Using Synaphex in Antigravity

Since Synaphex defaults to **Delegated Mode**, you get a seamless experience leveraging the IDE's models.

1. **Creating a Project**
   In your chat window, ask the agent:

   > _"Run the create tool for a new synaphex project named 'my_app'."_

2. **Building Context Memory**
   Initialize memory by analyzing your source code:

   > _"Use the memorize tool to analyze the directory /path/to/my_app for the 'my_app' project."_

3. **Starting a Task (Pipeline)**
   To use the multi-agent pipeline:

   > _"Run the task tool on 'my_app' for the requirement 'Create a login API endpoint'."_

   The IDE model will automatically receive the task instructions. From there, execute the pipeline step-by-step using these tools:
   - Request `examine`
   - Request `plan`
   - Request `implement`
   - Request `review`

> **IMPORTANT NOTE: Slash Commands**
> Antigravity IDE and other MCP extensions generally do **NOT** display MCP tools as `/synaphex:XXX` slash commands (this is specific to the Claude Code CLI plugin). Instead, the tools are cleanly exported as `@mcp:synaphex:task`, `@mcp:synaphex:create`, etc., which you can select from the IDE autocomplete or simply trigger via natural language.

Instead of Synaphex calling out to the Anthropic API internally, each step returns a prompt back to Antigravity's model, allowing the LLM _within_ the IDE (Gemini, Claude, GPT, etc.) to securely read, write, and execute the task!
