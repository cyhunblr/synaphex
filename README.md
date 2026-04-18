# synaphex v2.0.0

Multi-agent task automation for Claude Code. Synaphex provides a complete pipeline for code generation, research, and review with human oversight.

## Quick Start

```bash
npm install -g synaphex
synaphex --check
```

For detailed setup, see [INSTALLATION.md](docs/INSTALLATION.md).

## What It Does

Synaphex automates tasks using a 6-agent pipeline:

1. **Examiner** — Analyzes your codebase and project memory
2. **Researcher** — Researches unfamiliar technologies (optional)
3. **Planner** — Creates detailed implementation plan
4. **Coder** — Generates and applies code changes
5. **Answerer** — Handles architectural questions and escalations
6. **Reviewer** — Validates changes and provides feedback

All tasks are **user-orchestrated** — you control when each step runs.

## Usage

In Claude Code, use slash commands:

```
/synaphex:create          Create a new project
/synaphex:task            Run a task through the pipeline
/synaphex:memorize        Analyze codebase and update memory
/synaphex:remember        Link parent project memory
/synaphex:settings        View configuration
```

Example:

```
/synaphex:task
Task: "Add user authentication with JWT tokens"
Research: Yes
```

## Installation & Setup

- **[INSTALLATION.md](docs/INSTALLATION.md)** — Install on macOS, Linux, Windows and configure IDE plugins

## Documentation

### For New Users

1. **[Getting Started (5 min)](docs/GETTING-STARTED.md)** — Quick start guide
2. **[How-To Guide](docs/HOW-TO-GUIDE.md)** — Common task workflows
3. **[Examples](docs/EXAMPLES.md)** — Real-world scenarios

### Reference

- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — System design, agent pipeline, state machine, memory system
- **[CLI-REFERENCE.md](docs/CLI-REFERENCE.md)** — All commands with options
- **[TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)** — Error recovery and debugging
- **[Workflow Guide](docs/workflow-guide.md)** — Detailed workflow documentation

### Migration & IDE Integration

- **[MIGRATION.md](MIGRATION.md)** — Upgrade from v1.x to v2.0.0
- **[Antigravity Integration](docs/antigravity-integration.md)** — Use with Antigravity IDE
- **[VSCode Integration](docs/vscode-integration.md)** — Use with VSCode

## Project Memory

Synaphex manages project knowledge at `~/.synaphex/<project>/`:

```
.synaphex/
├── settings.json          # Agent configuration
├── memory/                # Project knowledge
│   ├── MEMORY.md         # Index
│   ├── architecture.md   # System design
│   ├── conventions.md    # Coding standards
│   └── patterns.md       # Common patterns
└── tasks/                # Task artifacts
    └── task_<slug>/
        ├── task-meta.json
        ├── analysis.md
        ├── plan.md
        └── research.md
```

Child projects can link parent memory for consistency:

```bash
synaphex task-remember parent-project my-project
```

## Installation Methods

### From npm (Recommended)

```bash
npm install -g synaphex
synaphex --check
```

### From Source

```bash
git clone https://github.com/cyhunblr/synaphex.git
cd synaphex
npm install
npm run build
npm link
```

### Via Claude Code Plugin

1. Open Claude Code settings
2. Navigate to Plugins → Available
3. Search for "synaphex"
4. Click Install

## Uninstallation

```bash
# Remove npm package
npm uninstall -g synaphex

# Remove IDE plugins
# - Claude Code: Settings → Plugins → Synaphex → Uninstall
# - VSCode: Extensions → Synaphex → Uninstall
# - Antigravity: Settings → Extensions → Synaphex → Remove

# Remove all project data
rm -rf ~/.synaphex
```

## Version History

**v2.0.0** (April 2026)

- User-orchestrated task workflow
- 6-agent pipeline with validation
- Comprehensive documentation suite
- State machine with error recovery
- Question escalation and decision tracking
- Multi-project memory inheritance

For full changelog, see [CHANGELOG.md](CHANGELOG.md).

## Support

- **Questions?** See [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
- **Need help?** Check [HOW-TO-GUIDE.md](docs/HOW-TO-GUIDE.md)
- **Report issues** — [GitHub Issues](https://github.com/cyhunblr/synaphex/issues)
- **Discuss features** — [GitHub Discussions](https://github.com/cyhunblr/synaphex/discussions)

## License

See [LICENSE](LICENSE) for details.
