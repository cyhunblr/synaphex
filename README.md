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

## Status

Phase 1 (foundation + memory infra) implemented. Phase 2 will add the six-agent pipeline (`task`, `fix`, interactive `settings`).

See [MEET.MD](MEET.MD) for the original spec.
