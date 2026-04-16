# Antigravity IDE Integration

Synaphex can be easily integrated into **Antigravity IDE** as an MCP server. Since Synaphex uses its **Delegated Mode** by default, it perfectly pairs with Antigravity to utilize the IDE's built-in conversational models to execute the agent pipeline without needing any `ANTHROPIC_API_KEY`.

## Installation & Configuration

1. **Build Synaphex Local Project**
   Ensure you have installed dependencies and built the project locally:

   ```bash
   cd /path/to/synaphex
   npm install
   npm run build
   ```

2. **Retrieve Node Path (Crucial for Antigravity)**
   Antigravity runs an isolated version of Node (v10.x). Synaphex requires **Node 18+**. You must find the absolute path to your active Node.js binary (e.g., via `fnm`, `nvm` or system).

   ```bash
   which node
   # Example output: /home/user/.local/share/fnm/node-versions/v20.19.6/installation/bin/node
   ```

3. **Configure mcp_config.json**
   Open your Antigravity IDE configuration directory (usually `~/.gemini/antigravity/` on Linux) and edit or create the `mcp_config.json` file. Link the path to your modern node binary and the `dist/index.js` of Synaphex:

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

   > _"Run the synaphex_create tool to create a project named 'my_app'."_

2. **Building Context Memory**
   Initialize memory by analyzing your source code:

   > _"Use synaphex_memorize to analyze the directory /path/to/my_app for the 'my_app' project."_

3. **Starting a Task (Pipeline)**
   To use the multi-agent pipeline:

   > _"Run synaphex_task_start on 'my_app' for the task 'Create a login API endpoint'."_

   The IDE model will automatically receive the task instructions. From there, execute the pipeline step-by-step:
   - Request `synaphex_task_examine`
   - Request `synaphex_task_plan`
   - Request `synaphex_task_implement`
   - Request `synaphex_task_review`

Instead of Synaphex calling out to the Anthropic API internally, each step returns a prompt back to Antigravity's model, allowing the LLM _within_ the IDE (Gemini, Claude, GPT, etc.) to securely read, write, and execute the task!
