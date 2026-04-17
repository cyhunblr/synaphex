# How-To Guide

Task-based guide for common Synaphex workflows. Find what you want to do and follow the steps.

## Table of Contents

1. [How to create a project](#how-to-create-a-project)
2. [How to run a simple task](#how-to-run-a-simple-task)
3. [How to research unfamiliar technology](#how-to-research-unfamiliar-technology)
4. [How to handle architectural questions](#how-to-handle-architectural-questions)
5. [How to link multi-project memory](#how-to-link-multi-project-memory)
6. [How to debug errors](#how-to-debug-errors)
7. [How to contribute improvements](#how-to-contribute-improvements)

## How to Create a Project

**Goal:** Set up a new Synaphex project for a codebase.

### Using the CLI

```bash
synaphex create my-project-name
cd my-project-name
```

### Using the IDE Plugin

1. Open your IDE
2. Run: `/synaphex:project-create`
3. Enter project name when prompted
4. Wait for project initialization (30 seconds)

### Verify Creation

```bash
ls -la .synaphex/
```

You should see:

- `settings.json` — Agent configuration
- `memory/` — Project memory directory
- `tasks/` — Task tracking directory (appears after first task)

### Configure Your Project

Edit `.synaphex/settings.json` to set:

- **Agent effort**: 0 (quick) to 4 (thorough)
- **Model**: Choose Claude Opus, Sonnet, or Haiku
- **Thinking mode**: Enable extended thinking for complex tasks
- **Researcher**: Enable/disable web research

See [CLI-REFERENCE.md](CLI-REFERENCE.md) for all options.

## How to Run a Simple Task

**Goal:** Execute a straightforward task (no research needed).

### 1. Create the task

```bash
/synaphex:task-create

Description: "Add input validation to login form"
```

### 2. Answer initial questions

Synaphex will ask:

- "Review code memory?" → Yes (if you have existing code understanding)
- "Enable research?" → No (for simple tasks)

### 3. Review the plan

Synaphex shows a step-by-step implementation plan. Review it and confirm.

### 4. Watch execution

The pipeline runs automatically:

1. **Examine** — Analyzes your codebase (2-3 min)
2. **Plan** — Creates detailed steps (1-2 min)
3. **Code** — Implements the solution (3-5 min)
4. **Review** — Checks the code quality (1-2 min)

### 5. Accept or iterate

When done, Synaphex asks: "Ready to apply changes?"

- **Yes** → Changes are applied
- **No** → Iterate and refine

## How to Research Unfamiliar Technology

**Goal:** Let Synaphex research a library/framework before implementing.

### 1. Create a research task

```bash
/synaphex:task-create

Description: "Integrate GraphQL into the API layer"
```

### 2. Enable research

When asked "Enable Researcher?", answer **Yes**.

### 3. Let the researcher run

Synaphex will:

1. Identify knowledge gaps (GraphQL concepts, patterns)
2. Search the internet for best practices
3. Save findings to project memory
4. Use this research to inform implementation

### 4. Review research findings

After research, Synaphex shows:

- What was learned
- Key patterns to follow
- Common pitfalls to avoid
- Relevant examples

### 5. Proceed with implementation

The Planner uses research findings to create a better plan.

## How to Handle Architectural Questions

**Goal:** Get Synaphex to ask you for guidance on design decisions.

### 1. Create an architectural task

```bash
/synaphex:task-create

Description: "Implement real-time notifications for user updates"
```

### 2. Let Synaphex identify questions

During planning, Synaphex encounters questions that require your input:

- "Should we use WebSockets or Server-Sent Events?"
- "How should notification state be persisted?"
- "What's the timeout policy for stale notifications?"

### 3. Provide clarification

When prompted, answer with:

- **Decision**: Your choice (WebSockets)
- **Rationale**: Why you chose it (scalability, browser support)
- **Constraints**: Any limitations (avoid X because Y)

### 4. See it in memory

Your decision is saved in `.synaphex/memory/` for future tasks.

### 5. Continue implementation

Synaphex now has your guidance and proceeds with consistent decisions.

## How to Link Multi-Project Memory

**Goal:** Share knowledge between related projects.

### Parent Project Setup

In the parent project (e.g., "shared-infrastructure"):

```bash
synaphex memorize
```

This creates memory files:

- `memory/architecture.md`
- `memory/conventions.md`
- `memory/deployment.md`

### Child Project Setup

In the child project (e.g., "api-service"):

```bash
/synaphex:project-remember

Parent project path: ../shared-infrastructure
```

Synaphex creates symlinks in `.synaphex/external-memory/` pointing to parent memory.

### Update Parent Memory

Edit parent project memory files. Changes automatically reflect in child projects.

Example: Update `../shared-infrastructure/memory/conventions.md` → automatically used by API service.

### Verify Linking

```bash
ls -la my-project/.synaphex/external-memory/
```

You should see symlinks pointing to parent project memory.

## How to Debug Errors

**Goal:** Troubleshoot when Synaphex hits an error.

### 1. Check the error message

Synaphex shows:

- **Error type** (validation, execution, blocker)
- **What failed** (which step)
- **Why** (root cause if known)
- **Suggestion** (how to fix)

### 2. Common fixes

**Validation error:**

```
Error: Task description is ambiguous
Fix: Be more specific ("Add login validation" not "Fix login")
```

**Execution error:**

```
Error: Could not read file
Fix: File path is correct? Check with: ls path/to/file
```

**Blocker (needs your help):**

```
Error: Cannot decide between approaches
Fix: Provide guidance on requirements or constraints
```

### 3. Get detailed error info

```bash
synaphex logs task-id
```

Shows full error context and stack trace.

### 4. Recover from error

After fixing the issue:

```bash
/synaphex:task-continue

Task: my-task-id
```

Synaphex resumes from where it paused.

## How to Contribute Improvements

**Goal:** Help improve Synaphex and share your workflow improvements.

### 1. Set up for contribution

```bash
git clone https://github.com/cyhunblr/synaphex.git
cd synaphex
npm install
npm run build
npm link  # Use local version for testing
```

### 2. Make your improvements

Options:

- **Fix a bug** — Create an issue first, then submit PR
- **Add a feature** — Discuss in issues before starting
- **Improve docs** — Directly submit PR
- **Enhance examples** — Add to EXAMPLES.md

### 3. Test thoroughly

```bash
npm test                # Run all tests
npm run lint            # Check code quality
npm run lint:md         # Check documentation
```

### 4. Submit pull request

1. Push to a branch: `git checkout -b fix/your-fix-name`
2. Commit with conventional messages: `fix: resolve X issue`
3. Create PR with description of changes
4. Wait for review and iterate

### 5. Celebrate

Your contribution makes Synaphex better for everyone 🎉

---

## Quick Reference

| Task                   | Command                      | Time     |
| ---------------------- | ---------------------------- | -------- |
| Create project         | `synaphex create`            | 30s      |
| Start simple task      | `/synaphex:task-create`      | 10-15m   |
| Task with research     | Enable Researcher            | 15-25m   |
| Architectural decision | Answer when prompted         | Variable |
| Link multi-project     | `/synaphex:project-remember` | 5m       |
| Debug errors           | `synaphex logs`              | Variable |

## Related Documentation

- **[GETTING-STARTED.md](GETTING-STARTED.md)** — 5-minute quick start
- **[EXAMPLES.md](EXAMPLES.md)** — Real-world workflows
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — System design
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** — Error recovery
- **[CLI-REFERENCE.md](CLI-REFERENCE.md)** — All commands
