# Synaphex v1.x → v2.0.0 Migration Guide

## Overview

Synaphex v2.0.0 introduces **breaking changes**: command names have changed to clarify the user-orchestrated workflow. This guide helps you migrate projects and workflows from v1.7 to v2.0.

## What Changed

### Command Renames

| v1.7 Command              | v2.0 Command               | Purpose                                 |
| ------------------------- | -------------------------- | --------------------------------------- |
| `synaphex task`           | `synaphex task-create`     | Create new task                         |
| `synaphex task-plan`      | `synaphex task-planner`    | Create plan                             |
| `synaphex task-implement` | `synaphex task-coder`      | Implement code                          |
| `synaphex task-review`    | `synaphex task-reviewer`   | Review code                             |
| (new)                     | `synaphex task-examine`    | Examine codebase (was built-in to task) |
| (new)                     | `synaphex task-researcher` | Research knowledge gaps                 |
| (new)                     | `synaphex task-answerer`   | Answer Coder questions                  |
| (new)                     | `synaphex task-remember`   | Link parent project memory              |

### Removed Commands

- `synaphex write-memory` — Removed (now agent-internal)

### API/MCP Changes

- **Removed MCP tool**: `write_memory` (Researcher and Answerer use it internally now)
- **New MCP tools**: `task-researcher`, `task-answerer`, `task-remember`
- **Updated tools**: All renamed tools have same signatures, just different names

## Migration Steps

### Step 1: Update Your Scripts/Workflows

If you have scripts that call synaphex commands, update them:

**Before (v1.7)**:

```bash
synaphex task my-project "Build feature X"
synaphex task-plan my-project <slug> "Build feature X" ~/cwd "examined..."
synaphex task-implement my-project <slug> "Build feature X" ~/cwd "plan..." ...
synaphex task-review my-project <slug> "Build feature X" ~/cwd "implementation..."
```

**After (v2.0)**:

```bash
synaphex task-create my-project "Build feature X"
synaphex task-examine my-project <slug> "Build feature X" ~/cwd
synaphex task-planner my-project <slug> "Build feature X" ~/cwd "examined..."
synaphex task-coder my-project <slug> "Build feature X" ~/cwd "plan..." ...
synaphex task-reviewer my-project <slug> "Build feature X" ~/cwd "implementation..."
```

### Step 2: Update IDE/Claude Code Integrations

If you have custom MCP integration or prompts referencing old commands:

1. Update command references in your `.claude-plugin` or `.mcp.json`
2. Update any slash commands you've defined
3. Test the new commands in Claude Code

### Step 3: Update Project-Specific Documentation

If you have documentation referencing v1.7 workflows:

1. Replace `synaphex task` with `synaphex task-create`
2. Replace `synaphex task-plan` with `synaphex task-planner`
3. Replace `synaphex task-implement` with `synaphex task-coder`
4. Replace `synaphex task-review` with `synaphex task-reviewer`

### Step 4: Existing Projects

Your existing projects in `.synaphex/<project>/` don't need changes. The new commands work with existing task directories and `task-meta.json` files.

**No data migration required** — all existing projects are compatible.

## New Workflow Features

v2.0.0 introduces new capabilities. Consider adopting them:

### 1. Explicit Examination Step

v1.7: Examination was implicit in `task` command.
v2.0: `task-examine` is explicit and can be called independently.

**Benefits**:

- Reusable examination for multiple tasks
- Better control over context window
- Separate examination from task creation

**Use it**:

```bash
synaphex task-create my-project "Feature A"
synaphex task-examine my-project feature-a "Feature A" ~/cwd
# Now re-examine if codebase changed
synaphex task-examine my-project feature-a "Feature A" ~/cwd
```

### 2. Research Step (Optional)

v1.7: No explicit research step.
v2.0: `task-researcher` fills knowledge gaps automatically.

**Benefits**:

- Autonomous web research for unfamiliar frameworks
- Findings saved to memory for future reference
- Planner and Coder see research results

**Use it**:

```bash
synaphex task-examine my-project triton-setup "Set up Triton" ~/cwd
synaphex task-researcher my-project triton-setup "Set up Triton" ~/cwd "examined..."
# Researcher finds and documents Triton patterns
synaphex task-planner my-project triton-setup "Set up Triton" ~/cwd "examined..."
# Planner sees research findings
```

### 3. Question Markers in Code

v1.7: No embedded questions.
v2.0: Coder can embed `SYNAPHEX_QUESTION:` and `SYNAPHEX_ARCHITECTURAL:` markers.

**Benefits**:

- Technical questions answered by Answerer
- Architectural decisions escalated to user
- Pause workflow for critical decisions

**Use it**:

```typescript
// SYNAPHEX_ARCHITECTURAL: Should we use Redis or in-memory cache?
const cache = new InMemoryCache();
```

During implementation, Coder asks the Answerer, which either answers or escalates.

### 4. Task Re-planning After Escalation

v1.7: No escalation mechanism.
v2.0: Architectural decisions pause workflow for user clarification.

**Benefits**:

- User clarifies design decisions
- Planner generates updated plan with clarification
- Coder implements with clear direction

**Use it**:

```bash
# Coder hits architectural question
synaphex task-answerer my-project <slug> ...
# Task pauses, user updates task-meta.json with decision
# User re-plans with iteration++
synaphex task-planner my-project <slug> ... 2
synaphex task-coder my-project <slug> ... 2
```

### 5. Memory Linking (task-remember)

v1.7: Projects were isolated.
v2.0: `task-remember` links parent project memory into child.

**Benefits**:

- Child projects inherit parent patterns
- Shared knowledge across projects
- Avoid duplicate research

**Use it**:

```bash
synaphex task-create parent "Build auth system"
# ... complete parent task ...

synaphex task-remember parent child
synaphex task-create child "Add API endpoint"
# Child can now see parent's auth patterns and research
```

## Backward Compatibility

**Data**:

- All existing `.synaphex/<project>/` directories are compatible
- All existing `task-meta.json` files work with v2.0
- No data migration required

**Commands**:

- v1.7 command names will NOT work in v2.0
- You must update script references
- CLI will error if you use old command names

**Projects**:

- Create new projects with v2.0 (uses new workflow)
- Existing projects work as-is with renamed commands
- No forced upgrade

## Common Migration Scenarios

### Scenario 1: Updating Scripts

**Before**:

```bash
#!/bin/bash
TASK=$1
synaphex task my-project "$TASK"
synaphex task-plan my-project ... "$TASK" ...
synaphex task-implement my-project ... "$TASK" ...
synaphex task-review my-project ... "$TASK" ...
```

**After**:

```bash
#!/bin/bash
TASK=$1
synaphex task-create my-project "$TASK"
synaphex task-examine my-project ... "$TASK" ~/cwd
synaphex task-planner my-project ... "$TASK" ...
synaphex task-coder my-project ... "$TASK" ...
synaphex task-reviewer my-project ... "$TASK" ...
```

---

### Scenario 2: Existing Project + New Features

```bash
# Old project created with v1.7
# Still works with v2.0, now try new features

# Link another project's memory
synaphex task-remember old-project new-project

# Create new task in old project
synaphex task-create old-project "New feature"
synaphex task-examine old-project new-feature "New feature" ~/cwd

# Use research for new feature
synaphex task-researcher old-project new-feature "New feature" ~/cwd "examined..."

# Continue normal workflow
synaphex task-planner old-project new-feature "New feature" ~/cwd "examined..."
```

---

### Scenario 3: Gradual Adoption

You don't have to adopt all new features at once:

```bash
# Minimal adoption (just renamed commands)
synaphex task-create my-project "Feature"
synaphex task-examine my-project feature "Feature" ~/cwd
synaphex task-planner my-project feature "Feature" ~/cwd "examined..."
synaphex task-coder my-project feature "Feature" ~/cwd "plan..." ...
synaphex task-reviewer my-project feature "Feature" ~/cwd "implementation..."

# Later: add research when hitting knowledge gap
synaphex task-researcher my-project feature "Feature" ~/cwd "examined..."

# Later: use question markers in code
# (Coder can embed SYNAPHEX_QUESTION: ...)

# Later: try memory linking with other projects
synaphex task-remember project-a project-b
```

## Troubleshooting

### Error: "Unknown command: task"

**Cause**: You're using v1.7 command name in v2.0.

**Fix**: Update to `task-create`

```bash
# Old
synaphex task my-project "Feature"

# New
synaphex task-create my-project "Feature"
```

---

### Error: "Validation failed: Cannot run planner before examine"

**Cause**: v2.0 requires explicit `task-examine` step.

**Fix**: Run `task-examine` before `task-planner`

```bash
synaphex task-examine my-project <slug> "task" ~/cwd
synaphex task-planner my-project <slug> "task" ~/cwd "examined..."
```

---

### Old project doesn't work with v2.0

**Cause**: Unlikely — all existing projects are compatible.

**Check**:

1. Are you using new command names? (task-create, task-planner, etc.)
2. Is the working directory accessible?
3. Does `task-meta.json` exist in the task directory?

**Fix**:

1. Update command names (see table above)
2. Ensure cwd is readable
3. If `task-meta.json` missing, you need to start task fresh

---

## Support

- **New Documentation**: See `docs/` directory for v2.0 guides
  - `docs/task-state-machine.md` — Workflow diagram
  - `docs/cli-reference.md` — All command usage
  - `docs/coder-questions.md` — Question markers
  - `docs/answerer-escalation.md` — Escalation flow
  - `docs/memory-organization.md` — Memory structure

- **Questions**: Check GitHub issues or ask in discussions

- **Feedback**: Report issues on GitHub

## Summary

v2.0.0 is a **recommended upgrade** that:

- Clarifies workflow with explicit step names
- Adds powerful features (research, escalation, memory linking)
- Maintains backward compatibility with existing projects
- Requires minimal code changes (just command renaming)

**Getting started**:

1. Update command names in your scripts
2. Try the new workflow with a test project
3. Adopt new features (research, escalation) gradually
4. See `docs/` for comprehensive guides
