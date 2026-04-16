# synaphex — Claude Code Plugin Context

## Architecture

Claude Code plugins are built as MCP servers. The VS Code extension surfaces slash commands by reading from a `.claude/commands/` directory, where each subfolder becomes a command namespace. There are two integration layers:

1. **`.claude/commands/synaphex/*.md`** — Markdown files Claude Code reads natively to surface slash commands. No build step needed.
2. **`src/`** — The MCP server registered in `~/.claude.json`, which backs tool execution with TypeScript logic.

Registration in `~/.claude.json`:
```json
{
  "mcpServers": {
    "synaphex": {
      "command": "node",
      "args": ["/absolute/path/to/synaphex/dist/index.js"]
    }
  }
}
```

---

## File Structure

```
synaphex/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                  # MCP server entry point, registers all tools
│   ├── commands/
│   │   ├── create.ts
│   │   ├── load.ts
│   │   ├── settings.ts
│   │   ├── task.ts
│   │   └── fix.ts
│   └── lib/
│       └── project-store.ts      # ~/.synaphex/ path logic
└── .claude/
    └── commands/
        └── synaphex/
            ├── create.md
            ├── load.md
            ├── settings.md
            ├── task.md
            └── fix.md
```

---

## Dependencies

- `@modelcontextprotocol/sdk` — MCP server
- `zod` — tool argument validation
- TypeScript, Node.js 18+, ESM (`"type": "module"`)

---

## Storage

All project data lives globally in `~/.synaphex/<project>/`. No per-workspace storage. `project-store.ts` is the single source of truth for all path logic.

`project-store.ts` exports:
- `SYNAPHEX_HOME` → `~/.synaphex/`
- `projectDir(project)` → `~/.synaphex/<project>/`
- `projectExists(project)` → boolean
- `ensureSynaphexHome()` → creates the dir if missing
- `listProjects()` → lists all project dirs
- `ProjectMeta` interface → `{ name: string, createdAt: string }` — to be extended later

---

## Commands

| Command | MCP Tool Name | Status |
|---|---|---|
| `/synaphex/create <project>` | `synaphex_create` | Partially implemented |
| `/synaphex/load <project>` | `synaphex_load` | Stub |
| `/synaphex/settings <project>` | `synaphex_settings` | Stub |
| `/synaphex/task <project> <description>` | `synaphex_task` | Stub |
| `/synaphex/fix <project> <description>` | `synaphex_fix` | Stub |

### `/synaphex/create <project>`
- Calls `ensureSynaphexHome()` first
- Checks `projectExists()` — if true, returns: *"Project already exists. Use `/synaphex/load <project>` instead."*
- If new: creates `~/.synaphex/<project>/` and writes `meta.json` with `{ name, createdAt }`
- Internals of what gets scaffolded beyond `meta.json` are **TBD**

### `/synaphex/load <project>`
- Guards: if project doesn't exist, returns: *"Use `/synaphex/create <project>` first."*
- What "loading" means (what context gets injected into the session) is **TBD**

### `/synaphex/settings <project>`
- Guards: project must exist
- Settings schema and interaction model are **TBD**

### `/synaphex/task <project> <description>`
- Guards: project must exist
- First token = project name, remainder = task description sentence
- How it translates natural language into agentic work is **TBD**

### `/synaphex/fix <project> <description>`
- Guards: project must exist
- First token = project name, remainder = problem description sentence
- How it diagnoses and resolves the problem is **TBD**

---

## Decisions Made

- Storage: global `~/.synaphex/` only, no per-workspace storage
- `create` scaffolds a **new** codebase inside `~/.synaphex/<project>/`
- `create` is **idempotent** — silently skips and redirects to `load` if project already exists
- `load` is the only way to bring an existing project into a session
- All command internals beyond guards and `create`'s basic scaffold are intentionally deferred

---

> **Everything marked TBD is intentional. Do not invent behavior for TBD items — ask before implementing.**