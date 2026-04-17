# synaphex

Project memory management for Claude Code. Distributed as a Claude Code plugin (skills + MCP server).

All project data lives globally at `~/.synaphex/<project>/`. Each project has a `settings.json` (agent config), `meta.json`, and a `memory/` directory split into `internal/` (own knowledge) and `external/` (linked from other projects).

## Commands

Synaphex provides native **Plugin Skills** that appear as namespaced slash commands in Claude Code.

| Native Slash Command | Description                          |
| -------------------- | ------------------------------------ |
| `/synaphex:create`   | Create a new synaphex project        |
| `/synaphex:load`     | Load project settings + memory       |
| `/synaphex:memorize` | Analyze codebase and update memory   |
| `/synaphex:remember` | Link memory from another project     |
| `/synaphex:settings` | View current agent configurations    |
| `/synaphex:task`     | Run the multi-agent task pipeline    |
| `/synaphex:fix`      | Run the multi-agent bug-fix pipeline |

> [!TIP]
> These commands are natively discovered by Claude Code once the plugin is installed. You can also trigger them by just asking Claude: _"Run synaphex task for project X: [your task]"_.

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

### Manual Setup (Plugin Mode)

If you prefer manual configuration, follow these steps:

1. **Link the package as a plugin:**

   ```bash
   mkdir -p ~/.claude/plugins
   ln -sf $(pwd) ~/.claude/plugins/synaphex
   ```

2. **Reload VSCode:**
   _Press `F1`, type **"Developer: Reload Window"**, and press Enter._

For platform-specific instructions on how to use Synaphex with your editor, see the [IDE Integrations](#ide-integrations) section.

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

## Installation

Install Synaphex v2.0.0 globally via npm or from source:

```bash
npm install -g synaphex
synaphex --version
```

For detailed installation instructions for all platforms (macOS, Linux, Windows) and IDE plugins, see [INSTALLATION.md](docs/INSTALLATION.md).

## Getting Started

New to Synaphex? Start here:

1. **[Getting Started (5 minutes)](docs/GETTING-STARTED.md)** — Quick start guide with step-by-step instructions
2. **[How-To Guide](docs/HOW-TO-GUIDE.md)** — Task-based workflows for common scenarios
3. **[Examples](docs/EXAMPLES.md)** — Real-world workflows: password reset, GraphQL integration, real-time notifications, multi-project inheritance, and refactoring

## Documentation

Complete reference guides for Synaphex v2.0.0:

### Quick Links

- **[INSTALLATION.md](docs/INSTALLATION.md)** — Install on macOS, Linux, Windows, and IDE plugins
- **[GETTING-STARTED.md](docs/GETTING-STARTED.md)** — 5-minute quick start
- **[HOW-TO-GUIDE.md](docs/HOW-TO-GUIDE.md)** — Common task-based workflows
- **[EXAMPLES.md](docs/EXAMPLES.md)** — Real-world workflow examples

### Advanced

- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — System design, agent pipeline, state machine, memory system, and question escalation
- **[TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)** — Common errors and recovery procedures
- **[Workflow Guide](docs/workflow-guide.md)** — Complete workflow guide with step-by-step instructions
- **[CLI Reference](docs/cli-reference.md)** — All commands with usage examples
- **[Migration Guide](docs/MIGRATION.md)** — Upgrade from v1.x to v2.0.0

### Legacy Documentation (Archived)

- **[Task State Machine](docs/task-state-machine.md)** — _Consolidated into ARCHITECTURE.md_
- **[Memory Organization](docs/memory-organization.md)** — _Consolidated into ARCHITECTURE.md_
- **[Answerer Escalation](docs/answerer-escalation.md)** — _Consolidated into ARCHITECTURE.md_
- **[Coder Questions](docs/coder-questions.md)** — _Consolidated into ARCHITECTURE.md_

### IDE Integrations

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

## Updating from Legacy Versions (v1.0.0 — v1.5.0)

Synaphex has transitioned to a **Standardized Plugin Architecture**. This means slash commands now correctly use the `/synaphex:` prefix to prevent conflicts and ensure reliable discovery in Claude Code v4.6+.

If you are updating from an older version and see broken or duplicate commands, follow these cleanup steps:

1. **Run the new automated setup**:

   ```bash
   npx -y synaphex@latest setup claude
   ```

   _The setup wizard now handles cleaning up legacy standalone links automatically._

2. **Clear NPX cache**:

   ```bash
   rm -rf ~/.npm/_npx
   ```

After running these, restart your IDE (`Developer: Reload Window` in VSCode).

## Status

Phase 1 and Phase 2 (the six-agent pipeline) are implemented. See [MEET.MD](MEET.MD) for the original specification.
