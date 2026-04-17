# How-To Guide

Task-focused guides for common Synaphex workflows.

## Table of Contents

1. [How to create a project](#how-to-create-a-project)
2. [How to run a simple task](#how-to-run-a-simple-task)
3. [How to research unfamiliar technology](#how-to-research-unfamiliar-technology)
4. [How to handle architectural questions](#how-to-handle-architectural-questions)
5. [How to link multi-project memory](#how-to-link-multi-project-memory)
6. [How to debug errors](#how-to-debug-errors)
7. [How to contribute improvements](#how-to-contribute-improvements)

---

## How to create a project

**Prerequisites**: Synaphex installed (`npm install -g synaphex@2.0.0`)

### Step 1: Choose a project name

Pick a lowercase name with letters, numbers, hyphens, or underscores. Examples:
- `my-api`
- `web_app_2024`
- `rtp_receiver`

### Step 2: Create the project

```bash
/synaphex:create my-project-name
```

### Step 3: Verify creation

Check that the project exists:

```bash
ls ~/.synaphex/my-project-name/
# Should show: settings.json, meta.json, memory/
```

### Learn more

- [Installation Guide](./INSTALLATION.md) — detailed setup options
- [Getting Started](./GETTING-STARTED.md) — quick 5-minute walk-through
- [Examples](./EXAMPLES.md) — see real-world project creation

---

## How to run a simple task

**Prerequisites**: Project created with `/synaphex:create`

A task goes through these steps:

1. **Examine** — Reads your code and project memory
2. **Planner** — Creates implementation plan
3. **Coder** — Writes the code
4. **Answerer** — Handles questions from Coder
5. **Reviewer** — Reviews the implementation

### Step 1: Start the task

```bash
/synaphex:task my-project-name "Add password reset endpoint"
```

The system will ask:
- "Activate researcher?" (yes/no) — Say `no` for simple tasks
- "How should review work?" (user/agent/ask) — Say `agent` for automated review

### Step 2: Monitor progress

Watch the console as agents run in sequence. Each agent outputs its findings.

### Step 3: Verify success

After reviewer approves, check:

```bash
cat ~/.synaphex/my-project-name/memory/internal/tasks/add-password-reset-endpoint/plan.md
```

This contains the implementation plan and code.

### Learn more

- [CLI Reference](./CLI-REFERENCE.md) — detailed command options
- [Examples](./EXAMPLES.md) — see full examples with expected outputs
- [Architecture](./ARCHITECTURE.md) — understand agent roles

---

## How to research unfamiliar technology

**When to use**: You want Synaphex to research a topic before implementing

### Step 1: Activate researcher in task setup

When prompted "Activate researcher?", answer `yes`:

```
Researcher: This agent conducts web research on unfamiliar technologies.
Use when: implementing a library you haven't used before
Skip when: simple tasks with known patterns

Activate researcher? (yes/no): yes
```

### Step 2: Wait for research phase

The **Researcher** agent will:
- Search the web for relevant solutions
- Ask if you want a specific implementation method or further research
- Offer to save findings to project memory

Example output:

```
Researching: "How to implement GraphQL subscriptions in Node.js"

Found:
1. Apollo Server subscriptions
2. GraphQL.js with graphql-ws
3. Prisma subscriptions

Save to memory? (yes/no): yes
```

### Step 3: Continue with planning

Researcher findings are passed to Planner, which incorporates them into the implementation plan.

### Learn more

- [Examples](./EXAMPLES.md) — see full research example
- [Architecture](./ARCHITECTURE.md) — understand researcher agent role
- [CLI Reference](./CLI-REFERENCE.md) — control researcher behavior

---

## How to handle architectural questions

**When to use**: Coder asks about major design decisions

### Step 1: Recognize escalation

Coder might ask architectural questions like:
- "Should we use REST or GraphQL?"
- "Should data be cached in-memory or in Redis?"

Synaphex detects these using special markers:

```
<!-- SYNAPHEX_ARCHITECTURAL -->
Question: Should we use Event Sourcing for audit logs?
<!-- /SYNAPHEX_ARCHITECTURAL -->
```

### Step 2: Provide user feedback

When an architectural question is detected, Answerer escalates to you:

```
Architectural Question Escalated:
"Should we use Event Sourcing for audit logs?"

Your options:
  A) Yes, use Event Sourcing
  B) No, use traditional audit table
  C) Hybrid approach
  
What's your decision?
```

### Step 3: Decision is stored

Your decision is saved in project memory:

```bash
cat ~/.synaphex/my-project/memory/internal/tasks/your-task/task-meta.json
# Shows: "answerer_escalation": [{"question": "...", "decision": "..."}]
```

### Step 4: Re-planning incorporates decision

Planner runs again (iteration 2) with your decision, and Coder implements using the chosen approach.

### Learn more

- [Examples](./EXAMPLES.md) — see full escalation example
- [Architecture](./ARCHITECTURE.md) — understand escalation flow
- [CLI Reference](./CLI-REFERENCE.md) — control review behavior

---

## How to link multi-project memory

**When to use**: You have patterns in one project and want to reuse them in another

### Scenario

You have:
- **Parent project**: `backend-api` with established Node.js + GraphQL patterns
- **Child project**: `backend-service` that should follow same patterns

### Step 1: Create child project

```bash
/synaphex:create backend-service
```

### Step 2: Link parent memory

```bash
/synaphex:remember backend-api backend-service
```

This creates a symbolic link from:
- `backend-api/memory/internal/` → `backend-service/memory/external/backend-api_memory`

### Step 3: Run tasks in child project

When you run tasks in child project:

```bash
/synaphex:task backend-service "Add user authentication endpoint"
```

The Examiner will read:
- Child project memory (`memory/internal/`)
- Inherited parent patterns (`memory/external/backend-api_memory`)

### Step 4: Planner sees parent patterns

Planner automatically references parent project's:
- Code conventions
- Architecture decisions
- API design patterns

Result: Child project implementations are consistent with parent patterns.

### Learn more

- [Examples](./EXAMPLES.md) — see multi-project example
- [Architecture](./ARCHITECTURE.md) — understand memory inheritance
- [CLI Reference](./CLI-REFERENCE.md) — task-remember command options

---

## How to debug errors

### Check the error type

**Validation Error** (happens before agents run):
```
Error: Project 'my-project' not found
```
→ Check project exists: `ls ~/.synaphex/my-project/`
→ See [Installation Guide troubleshooting](./INSTALLATION.md#troubleshooting)

**Execution Error** (happens during agent run):
```
Error: Cannot run 'coder' - 'planner' not completed yet
```
→ Check task state: `cat ~/.synaphex/my-project/memory/internal/tasks/slug/task-meta.json`
→ Task steps must run in order

**Escalation Error** (architectural question):
```
Awaiting user decision on architectural question...
Timeout: User decision not provided
```
→ You need to provide decision
→ See [How to handle architectural questions](#how-to-handle-architectural-questions)

### Common issues

| Error | Solution |
|-------|----------|
| `command not found: synaphex` | Check installation: `npm list -g synaphex` |
| `Invalid project name` | Use lowercase letters, numbers, hyphens, underscores |
| `Project already exists` | Delete it: `rm -rf ~/.synaphex/project-name` |
| `Step X already completed` | Task state is locked. Check memory for step order. |

### Enable detailed logging

Set environment variable before running task:

```bash
export SYNAPHEX_DEBUG=1
/synaphex:task my-project "..."
```

This prints full agent inputs/outputs to console.

### Check memory files

After each step, examine what agents wrote:

```bash
# After examiner
cat ~/.synaphex/my-project/memory/internal/tasks/slug/examination.md

# After planner
cat ~/.synaphex/my-project/memory/internal/tasks/slug/plan.md

# After coder
cat ~/.synaphex/my-project/memory/internal/tasks/slug/implementation.md
```

### Learn more

- [Troubleshooting Guide](./INSTALLATION.md#troubleshooting) — installation issues
- [CLI Reference](./CLI-REFERENCE.md) — all available commands
- [Architecture](./ARCHITECTURE.md) — understand state machine and step order

---

## How to contribute improvements

**Want to improve Synaphex?**

### Step 1: Check the repository

```bash
git clone https://github.com/cyhunblr/synaphex.git
cd synaphex
npm install
```

### Step 2: Review contribution guidelines

Read [CONTRIBUTING.md](../CONTRIBUTING.md) for:
- Code style (TypeScript, linting rules)
- Test requirements (Jest)
- Commit message format
- PR process

### Step 3: Make your changes

- Bug fixes: target `main` branch
- Features: create feature branch `feature/your-feature`
- Docs: update relevant `.md` files

### Step 4: Test your changes

```bash
npm run build
npm run test
npm run lint
```

### Step 5: Submit a pull request

Push to GitHub and open a PR:
- Title: concise description (`fix: agent pipeline deadlock`)
- Description: why this change (reference issues if applicable)
- Reviewers will provide feedback

### Learn more

- [GitHub repository](https://github.com/cyhunblr/synaphex)
- [CONTRIBUTING guide](../CONTRIBUTING.md)
- [Architecture](./ARCHITECTURE.md) — understand system design before contributing

---

## Still need help?

- **Questions?** Open an issue on [GitHub](https://github.com/cyhunblr/synaphex/issues)
- **Setup issues?** See [Installation Guide troubleshooting](./INSTALLATION.md#troubleshooting)
- **Want more examples?** Check [Examples](./EXAMPLES.md)
- **Understand the system?** Read [Architecture](./ARCHITECTURE.md)
