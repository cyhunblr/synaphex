# Getting Started with Synaphex

Get Synaphex up and running in **5 minutes**.

## Prerequisites

- **Node.js 18+** and **npm 8+** (check versions: `node --version` && `npm --version`)
- **5 minutes** free time
- **Difficulty**: Beginner (no prior experience required)

If you don't have Node.js installed, see [Installation Guide](./INSTALLATION.md).

---

## Step 1: Install (~30 seconds)

Copy and paste this command:

```bash
npm install -g synaphex@2.0.0
```

Verify it worked:

```bash
synaphex --version
# Output should be: 2.0.0
```

---

## Step 2: Setup IDE Integration (~1 minute)

Run the interactive setup wizard to detect and configure your IDEs:

```bash
synaphex init
```

This will automatically:

- Detect installed IDEs (VS Code, Antigravity, CLI)
- Prompt you to select which to configure
- Register the MCP server in VS Code's settings

---

## Step 3: Create Your First Project (~10 seconds)

```bash
/synaphex:create my-first-task
```

This creates a new project at `~/.synaphex/my-first-task/` with:

- `settings.json` — agent configuration (can be customized later)
- `memory/internal/` — project memory files organized by topic
- `memory/external/` — (empty) for inherited parent project memory

Expected output:

```
Created synaphex project 'my-first-task' at /home/user/.synaphex/my-first-task

Files written:
  - settings.json (default agent config)
  - meta.json
  - memory/internal/overview.md
  - memory/internal/architecture.md
  - memory/internal/interfaces.md
  - memory/internal/build.md
  - memory/internal/conventions.md
  - memory/internal/security.md
  - memory/internal/glossary.md
  - memory/internal/packages/  (empty — populated by the 'memorize' tool)
  - memory/external/           (empty — populated by the 'remember' tool)
```

---

## Step 3b: Optional - Initialize Memory from Your Codebase

Before running tasks, you can analyze your codebase and populate memory automatically:

```bash
/synaphex:memorize my-first-task /path/to/your/codebase
```

This examines your codebase and creates:

- `overview.md` — extracted from README and package.json
- `architecture.md` — from directory structure and source code
- `conventions.md` — detected naming patterns and style
- `security.md` — analysis of auth/security mechanisms

Memory is idempotent (won't overwrite if unchanged), so you can run memorize again after code changes.

### Optional - Link to Parent Project

If you have a parent project you want to inherit knowledge from:

```bash
/synaphex:remember parent-project-name my-first-task
```

This creates a symlink so `my-first-task` can access all of `parent-project-name`'s memory. Child project has its own `internal/` memory but reads-only access to parent's knowledge.

---

## Step 4: Run Your First Task (~2 minutes)

Open a terminal in your IDE and run:

```bash
/synaphex:task my-first-task "Add a hello world endpoint to my API"
```

This starts the 8-agent pipeline:

1. **Examiner** — reads your code and memory
2. **Researcher** (optional) — researches if you need external knowledge
3. **Planner** — creates an implementation plan
4. **Coder** — writes the code
5. **Answerer** — answers questions the coder has
6. **Reviewer** — reviews the implementation
7. Results are saved to your project memory

You'll see console output from each agent. The task is complete when the reviewer approves the code.

---

## Next Steps

Choose your path:

### Want to understand the system better?

→ Read [Architecture Overview](./ARCHITECTURE.md)

### Want to see more examples?

→ Explore [Real-World Examples](./EXAMPLES.md)

### Want to learn specific tasks?

→ Read [How-To Guide](./HOW-TO-GUIDE.md)

### Need to troubleshoot?

→ Check [CLI Reference](./CLI-REFERENCE.md)

### Want detailed installation options?

→ See [Installation Guide](./INSTALLATION.md)

---

## Quick Reference

| Command                                 | What It Does            |
| --------------------------------------- | ----------------------- |
| `synaphex --version`                    | Show version            |
| `synaphex --help`                       | Show available commands |
| `/synaphex:create <name>`               | Create new project      |
| `/synaphex:load <name>`                 | Load existing project   |
| `/synaphex:task <name> "<description>"` | Start a new task        |

---

Need help? Check the [Troubleshooting Guide](./INSTALLATION.md#troubleshooting).
