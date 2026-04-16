# synaphex

Project memory management for Claude Code. Distributed as a Claude Code plugin (skills + MCP server).

All project data lives globally at `~/.synaphex/<project>/`. Each project has a `settings.json` (agent config), `meta.json`, and a `memory/` directory split into `internal/` (own knowledge) and `external/` (linked from other projects).

## Phase 1 commands

| Command                               | Description                                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `/synaphex:create <project>`          | Create a new project with memory scaffold and default settings. Errors if the project already exists. |
| `/synaphex:load <project>`            | Load a project's settings + memory digest into the session.                                           |
| `/synaphex:memorize <project> <path>` | Analyze a source directory and populate / update the project's topic-based memory files.              |
| `/synaphex:remember <parent> <child>` | Symlink `<parent>`'s `memory/internal/` into `<child>`'s `memory/external/<parent>_memory`.           |
| `/synaphex:settings <project>`        | **Phase 2** — placeholder. Edit `~/.synaphex/<project>/settings.json` directly for now.               |

## Usage

Synaphex is published as an npm package and can be run instantly as an MCP server via `npx` (requires Node 18+):

```bash
npx -y synaphex
```

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

## Status

Phase 1 (foundation + memory infra) implemented. Phase 2 will add the six-agent pipeline (`task`, `fix`, interactive `settings`).

See [MEET.MD](MEET.MD) for the original spec.
