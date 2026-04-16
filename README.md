# synaphex

Project memory management for Claude Code. Distributed as a Claude Code plugin (skills + MCP server).

All project data lives globally at `~/.synaphex/<project>/`. Each project has a `settings.json` (agent config), `meta.json`, and a `memory/` directory split into `internal/` (own knowledge) and `external/` (linked from other projects).

## Commands

Synaphex provides native **MCP Prompts** that appear as slash commands in Claude Code and other compatible IDEs.

| Native Command (MCP Prompt) | Tool Fallback | Description                          |
| --------------------------- | ------------- | ------------------------------------ |
| `/mcp__synaphex__create`    | `create`      | Create a new synaphex project        |
| `/mcp__synaphex__load`      | `load`        | Load project settings + memory       |
| `/mcp__synaphex__memorize`  | `memorize`    | Analyze codebase and update memory   |
| `/mcp__synaphex__remember`  | `remember`    | Link memory from another project     |
| `/mcp__synaphex__settings`  | `settings`    | View current agent configurations    |
| `/mcp__synaphex__task`      | `task`        | Run the multi-agent task pipeline    |
| `/mcp__synaphex__fix`       | `task`        | Run the multi-agent bug-fix pipeline |

> [!TIP]
> Many IDEs (like Claude Code) will autocomplete these. You can also trigger them by just asking Claude: _"Run synaphex task for project X: [your task]"_.

## Usage

Synaphex is published as an npm package and can be run instantly as an MCP server via `npx` (requires Node 18+):

```bash
npx -y synaphex
```

### IDE / VSCode Setup (Automated) [RECOMMENDED]

Synaphex is now a full **Claude Code Plugin**. Run the automated setup to configure the plugin and the MCP server:

```bash
# For Claude Code (Plugin Mode)
npx -y synaphex setup claude

# For GitHub Copilot / VS Code
npx -y synaphex setup copilot

# For Antigravity
npx -y synaphex setup antigravity
```

> [!NOTE]
> In Plugin Mode (Claude Code), slash commands are namespaced. Use `/synaphex:create`, `/synaphex:task`, etc.

### Manual Setup (Slash Commands)

If you prefer manual configuration, follow these steps:

1. **Link the skills folder:**

   ```bash
   mkdir -p ~/.claude/skills
   ln -sf $(pwd)/skills ~/.claude/skills/synaphex
   ```

2. **Reload VSCode:**
   _Press `F1`, type **"Developer: Reload Window"**, and press Enter._

For platform-specific instructions on how to use Synaphex with your editor, see the [IDE Integrations](#ide-integrations--documentation) section.

## Local development

```bash
cd /path/to/synaphex
eval "$(~/.local/share/fnm/fnm env)"   # if your default Node is too old
npm install
npm run build
```

Then load the plugin in a Claude Code session:

```bash
claude --plugin-dir /path/to/synaphex
```

If the MCP server fails to spawn (Node not on PATH), pin an absolute node path in `.mcp.json`.

## Memory layout

The topic-based layout is tailored for C++ / Python / ROS 1 Noetic / security projects:

```
memory/internal/
├── overview.md
├── architecture.md
├── interfaces.md        # ROS msg/srv/action
├── build.md             # catkin / CMake / package.xml
├── conventions.md       # C++ + Python style
├── security.md          # threat model, ROS 1 auth gaps, crypto
├── glossary.md
├── packages/<pkg>.md    # one per catkin package
├── tasks/<slug>/        # Phase 2 — Examiner output
└── research/<slug>.md   # Phase 2 — Researcher output
```

## IDE Integrations & Documentation

Synaphex supports a **Delegated Mode**, allowing IDE models (like Gemini in Antigravity, or Copilot/Claude in VSCode) to natively run the Synaphex agent pipelines without requiring Anthropic API keys.

Check out the detailed integration guides:

- [Antigravity IDE Integration](docs/antigravity-integration.md)
- [VSCode / Claude Code Integration](docs/vscode-integration.md)

## Uninstallation & Cleanup

To completely remove a Synaphex project and its memory, simply delete its directory:

```bash
rm -rf ~/.synaphex/<project>

# To remove ALL synaphex data globally:
rm -rf ~/.synaphex
```

### Uninstalling the package

Because `npx` executes packages on-the-fly without permanently installing them, there is no system-wide "uninstall" command required. The package only lives temporarily in your npm cache.

To remove Synaphex from that cache so it is completely gone from your system:

```bash
npx clear-npx-cache
# Or manually delete the cache if the above didn't work:
rm -rf ~/.npm/_npx
```

_(If you happened to install it globally via `npm install -g synaphex`, you can remove it with `npm uninstall -g synaphex`)_

To remove Synaphex from your IDE, delete the `"synaphex"` entry from your `mcp_config.json` (or `.mcp.json`) and refresh your MCP servers.

## Updating from Legacy Versions (v1.0.0+)

Synaphex recently removed the `/synaphex:` prefix from its tools to improve IDE integration. If you are updating from an older version and still see legacy commands in your IDE autocomplete, you **must clear your caches**:

```bash
# 1. Uninstall legacy global version
npm uninstall -g synaphex

# 2. Clear NPX cache to force a fresh pull of @latest
rm -rf ~/.npm/_npx

# 3. Clear Claude Code extension's cached commands (Crucial for VSCode users)
rm -rf ~/.claude/skills
```

After running these, restart your IDE (`Developer: Reload Window` in VSCode) and follow the normal NPX usage instructions.

## Status

Phase 1 and Phase 2 (the six-agent pipeline) are implemented. See [MEET.MD](MEET.MD) for the original specification.
