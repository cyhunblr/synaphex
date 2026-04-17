# Troubleshooting Guide

Solutions for common issues and errors in Synaphex v2.0.0.

## Quick Links

- [Common Errors](#common-errors)
- [Installation Issues](#installation-issues)
- [Task Workflow Problems](#task-workflow-problems)
- [Memory & Project Issues](#memory--project-issues)
- [Debugging Checklist](#debugging-checklist)
- [FAQ](#faq)

---

## Common Errors

### Validation Errors

#### "Project 'X' does not exist"

**What it means:** You referenced a project that hasn't been initialized.

**How to fix:**

```bash
synaphex create my-project
cd my-project
```

**Prevention:** Always create a project with `synaphex create` before running tasks.

---

#### "Validation failed: Cannot run <step> before <required_step>"

**What it means:** Task steps have a required order. You tried to run a step before its prerequisite.

**Example error:**

```
Validation failed: Cannot run planner before examine
Completed steps: ["create"]
Required steps: ["create", "examine", "plan"]
```

**How to fix:**

1. Check what's been completed:

   ```bash
   cat .synaphex/<project>/task_<slug>/task-meta.json
   ```

2. Run missing steps in order:

   ```bash
   # Run examine if not done
   synaphex task-examine ...
   # Then run planner
   synaphex task-planner ...
   ```

**Prevention:** Follow the task workflow order:

1. `task-create` (required)
2. `task-examine` (required)
3. `task-researcher` (optional)
4. `task-planner` (required)
5. `task-coder` (required)
6. `task-answerer` (optional)
7. `task-reviewer` (required)

---

#### "Cannot run same step twice"

**What it means:** You ran the same step twice without proper iteration handling.

**How to fix:**

Use iteration counter for re-runs:

```bash
# First run
synaphex task-coder my-project slug "task" ~/cwd ... 1

# If you need to re-code after feedback
synaphex task-coder my-project slug "task" ~/cwd ... 2
```

**Prevention:** Always increment the iteration number when re-running steps.

---

### Escalation Errors

#### "Escalation detected. Update task-meta.json and re-run"

**What it means:** Synaphex found an architectural question that needs your input.

**How to fix:**

1. Read the escalation:

   ```bash
   cat .synaphex/<project>/task_<slug>/task-meta.json | grep -A 10 escalation
   ```

2. See your question:

   ```json
   {
     "escalation": {
       "question": "Should we use Redis or in-memory cache?",
       "options": ["Redis (distributed)", "In-memory (simple)"]
     }
   }
   ```

3. Make a decision and update the file:

   ```json
   {
     "escalation": {
       "question": "Should we use Redis or in-memory cache?",
       "options": ["Redis (distributed)", "In-memory (simple)"],
       "decision": "Redis for scalability"
     }
   }
   ```

4. Re-run the planner with your decision:

   ```bash
   synaphex task-planner my-project slug "task" ~/cwd ... 2
   ```

**Prevention:** Clarify architectural decisions upfront to avoid mid-task escalations.

---

#### "Answerer could not answer question"

**What it means:** The code question was too vague for Synaphex to answer.

**How to fix:**

Make questions more specific:

```typescript
// ❌ Too vague
// QUESTION: What should we do here?

// ✅ Better
// QUESTION: For user lookups in 10K+ users, should we paginate?
```

Include context:

```typescript
// Include file name and purpose
// File: src/services/UserService.ts
// QUESTION: Should we cache user lookups? Current avg latency is 150ms.
```

Then re-run:

```bash
synaphex task-answerer my-project slug "task" ~/cwd ...
```

**Prevention:** Write specific questions with domain context.

---

## Installation Issues

### Command Not Found

**Problem:** `synaphex --version` returns command not found.

**Solutions:**

1. Check if installed:

   ```bash
   npm list -g synaphex
   ```

2. Reinstall globally:

   ```bash
   npm install -g synaphex
   ```

3. Fix npm permissions (if needed):

   ```bash
   mkdir ~/.npm-global
   npm config set prefix '~/.npm-global'
   export PATH=~/.npm-global/bin:$PATH
   # Add above export to ~/.bashrc or ~/.zshrc
   npm install -g synaphex
   ```

4. Restart terminal and try again:

   ```bash
   synaphex --version
   ```

---

### Node Version Error

**Problem:** "Node 18+ required"

**Solution:**

1. Check current version:

   ```bash
   node --version
   ```

2. Update Node.js:
   - Visit [nodejs.org](https://nodejs.org)
   - Download Node 18 LTS or higher
   - Install and restart terminal

3. Verify:

   ```bash
   node --version  # Should be 18.0.0 or higher
   npm install -g synaphex
   ```

---

### Plugin Installation Failed

**In Claude Code:**

- Ensure Claude Code is updated to latest version
- Restart Claude Code completely
- Go to Plugins and clear extension cache
- Reinstall Synaphex plugin

**In VSCode:**

- Update to VSCode 1.75+
- Open Command Palette: `Cmd+Shift+P` / `Ctrl+Shift+P`
- Run: "Extensions: Show Built-in Extensions"
- Reinstall Synaphex extension

**In Antigravity:**

- Verify Antigravity 1.0+
- Check internet connection
- Restart Antigravity completely
- Retry plugin installation

---

## Task Workflow Problems

### Task Gets Stuck

**Problem:** Task hasn't progressed for 5+ minutes.

**Diagnosis:**

1. Check task status:

   ```bash
   cat .synaphex/<project>/task_<slug>/task-meta.json
   ```

2. Look for:
   - `"status": "examining"` — Should complete in < 5 min
   - `"status": "researching"` — Can take 5-10 min
   - `"status": "planning"` — Should complete in < 2 min
   - Unanswered `escalation` — Task paused, waiting for you

3. If waiting for escalation, provide answer (see [Escalation Errors](#escalation-errors))

4. If step is stuck, kill and retry:

   ```bash
   # Kill the process
   Ctrl+C

   # Check what's in the task state file
   ls -la .synaphex/<project>/task_<slug>/

   # Increment iteration counter and retry
   synaphex task-examine my-project slug "task" ~/cwd 2
   ```

---

### Implementation Creates Wrong Files

**Problem:** Coder created files in unexpected locations.

**Diagnosis:**

```bash
# Check what was created
git status
# or
ls -la src/

# Check the implementation plan
cat .synaphex/<project>/task_<slug>/plan-v1.md
```

**How to fix:**

If files are wrong:

1. Delete incorrect files:

   ```bash
   git reset --hard HEAD
   ```

2. Provide better task description:

   ```bash
   synaphex task-create my-project
   # Task: "Add authentication in src/auth/ directory"
   ```

3. Retry task

**Prevention:** Be specific about file locations in task description.

---

### Code Doesn't Match Your Standards

**Problem:** Generated code doesn't follow your project conventions.

**Diagnosis:**

1. Check if memory was updated:

   ```bash
   cat .synaphex/<project>/memory/conventions.md
   ```

2. If conventions missing, update memory:

   ```bash
   # Edit conventions file
   cat > .synaphex/<project>/memory/conventions.md << 'EOF'
   # Naming Conventions
   - Functions: camelCase
   - Classes: PascalCase
   - Constants: UPPER_SNAKE_CASE
   EOF
   ```

3. Re-run the task:

   ```bash
   synaphex task-coder my-project slug "task" ~/cwd ... 2
   ```

**Prevention:** Document conventions in memory before running tasks.

---

## Memory & Project Issues

### Memory Digest Empty or Truncated

**Problem:** Task examination doesn't have proper memory files.

**Diagnosis:**

```bash
ls -la .synaphex/<project>/memory/
# Should show: conventions.md, architecture.md, etc.
```

**How to fix:**

1. Re-run examination:

   ```bash
   synaphex task-examine my-project slug "task" ~/cwd
   ```

2. Check if cwd is accessible:

   ```bash
   ls -la ~/your/project/path
   # Should have read permissions
   ```

3. If still failing, check file permissions:

   ```bash
   chmod -R 755 ~/.synaphex
   ```

**Prevention:** Keep `.synaphex` directory with proper read permissions.

---

### Cannot Create Symlink: Directory Exists

**Problem:** Can't link parent project memory.

**How to fix:**

```bash
# Option 1: Remove duplicate directory
rm -rf .synaphex/<project>/memory/external/<parent>_memory

# Option 2: Rename and retry
mv .synaphex/<project>/memory/external/<parent>_memory \
   .synaphex/<project>/memory/external/<parent>_memory.old

# Retry linking
synaphex task-remember <parent> <project>
```

**Prevention:** Don't manually create directories in memory/external/

---

### Researcher Found No Knowledge Gaps

**Problem:** Researcher skipped even though you expected research.

**This is normal.** It means:

- Task is well-understood
- No unfamiliar libraries/frameworks detected
- Researcher found your codebase already has examples

**No action needed.** Continue to planner.

---

## Debugging Checklist

Use this checklist when things go wrong:

### Step 1: Check Task Status

```bash
# See current state
cat .synaphex/<project>/task_<slug>/task-meta.json

# What to look for:
# - "status": ? (what step is it in?)
# - "completed_steps": ? (what's been done?)
# - "escalation": ? (waiting for your input?)
```

### Step 2: Check Memory

```bash
# See what was examined
ls -la .synaphex/<project>/memory/

# If empty or old, re-examine:
synaphex task-examine my-project slug "task" ~/cwd
```

### Step 3: Check Implementation Log

```bash
# What did Coder actually create?
cat .synaphex/<project>/task_<slug>/implementation-log-v*.md

# Check if files match your expectations
git status
git diff src/
```

### Step 4: Check Plan

```bash
# What was the implementation plan?
cat .synaphex/<project>/task_<slug>/plan-v*.md

# Does it match what you expected?
# If not, re-plan with iteration += 1
```

### Step 5: Verify Project Setup

```bash
# Is .synaphex properly initialized?
ls -la .synaphex/
# Should have: settings.json, memory/, tasks/

# Are permissions correct?
ls -la .synaphex/<project>/
```

---

## FAQ

### Q: Can I edit task-meta.json manually?

**A:** Yes, but be careful. Most common edits:

- Add your decision to `escalation.decision`
- Fix `completed_steps` if corrupted
- Change `iteration` number before re-running

Don't edit:

- Task slug (use same as original)
- Status (let agents set this)

### Q: How do I cancel a task?

**A:** Delete the task directory:

```bash
rm -rf .synaphex/<project>/task_<slug>/
```

Then create a new task with `task-create`.

### Q: Can I run two tasks in parallel?

**A:** Not recommended. The memory system locks to one active task. Run tasks sequentially instead.

### Q: How do I recover from a failed implementation?

**A:** Two options:

#### Option 1: Rollback

```bash
git reset --hard HEAD
# Then retry with iteration += 1
synaphex task-coder my-project slug "task" ~/cwd ... 2
```

#### Option 2: Clear and restart

```bash
git reset --hard HEAD
rm -rf .synaphex/<project>/task_<slug>/
# Create fresh task
synaphex task-create my-project "task..."
```

### Q: Where are my completed tasks stored?

**A:** In `.synaphex/<project>/archive/`

```bash
ls -la .synaphex/<project>/archive/
# Shows all completed task directories
```

### Q: Can I export my memory to another project?

**A:** Yes! Use symlinks:

```bash
# In child project
synaphex task-remember <parent-path> <project>

# Or manually create symlink
ln -s ../parent-project/.synaphex/memory \
      .synaphex/<project>/memory/external
```

### Q: What if Synaphex changes my code incorrectly?

**A:** Review before applying:

```bash
# See changes
git diff

# If wrong, reject:
git reset --hard HEAD

# Diagnose the issue:
1. Was the task description clear?
2. Are conventions documented in memory?
3. Did Coder ask clarifying questions?

# Fix and retry
```

---

## Getting Help

If you're still stuck:

1. **Check the docs:**
   - [CLI-REFERENCE.md](CLI-REFERENCE.md) — All commands
   - [HOW-TO-GUIDE.md](HOW-TO-GUIDE.md) — Common tasks
   - [EXAMPLES.md](EXAMPLES.md) — Real workflows

2. **Check project memory:**
   - `.synaphex/<project>/memory/` — Your project context
   - `.synaphex/<project>/task_<slug>/` — Task-specific artifacts

3. **View logs:**
   - `synaphex logs <project> <slug>` — Full task output
   - `git log` — Code changes

4. **Report issues:**
   - GitHub Issues — Bug reports and feature requests
   - GitHub Discussions — Q&A with community

---

## Memory Structure Migration (v2.0.0 to v3.0+)

**Note:** v3.0 uses a new memory structure with files in `memory/internal/` instead of the flat `memory/` root.

### For v2.0.0 Projects

If you have a v2.0.0 project with memory files in `memory/` root (not `memory/internal/`), you can manually migrate:

```bash
cd ~/.synaphex/my-project
mkdir -p memory/internal
cp memory/*.md memory/internal/
```

After migration, agents will read from `memory/internal/` automatically.

---

For more detailed information, see [ARCHITECTURE.md](ARCHITECTURE.md) for system design and [CLI-REFERENCE.md](CLI-REFERENCE.md) for all command options.

---

## Memory System Issues

### Memory Files Not Updated After Code Changes

**Problem**: You updated code but memory still shows old information.

**Cause**: Memory is created once and only updated by `memorize` command or manual editing.

**Solution**:

```bash
/synaphex:memorize my-project /path/to/codebase
```

This examines your codebase and updates:

- overview.md
- architecture.md
- conventions.md
- security.md
- dependencies.md

(Does NOT touch research/, tasks/, or your manual edits)

---

### Symlink Not Working (Remember Command)

**Problem**: Child project can't access parent memory.

**Cause**: Symlink creation failed (permissions, Windows, or pre-existing file).

**Solutions**:

1. Check if symlink exists:

```bash
ls -la ~/.synaphex/child-project/memory/external/
# Should see: parent_memory -> /path/to/parent/memory/internal
```

1. If it doesn't exist, re-run remember:

```bash
/synaphex:remember parent-project child-project
```

1. On Windows, if symlinks don't work:

```bash
# Synaphex falls back to copying parent memory
# You can manually copy instead:
xcopy "%USERPROFILE%\.synaphex\parent-project\memory\internal\*" ^
      "%USERPROFILE%\.synaphex\child-project\memory\external\parent_memory\" /E /I
```

---

### Task Memory Gets Overwritten

**Problem**: Your task plan was deleted when you ran memorize.

**Cause**: Memorize should NOT touch `tasks/` directory, but older versions did.

**Solution**:

1. Check Synaphex version:

```bash
synaphex --version
# Should be v2.0.0 or higher
```

1. If older version, upgrade:

```bash
npm install -g synaphex@latest
```

1. Recover from backup (if you have one):

```bash
git checkout HEAD -- ~/.synaphex/my-project/memory/internal/tasks/
```

---

### Memory File Encoding Issues

**Problem**: Memory files show garbled characters or encoding errors.

**Cause**: File saved in wrong encoding (UTF-16, Latin-1, etc.).

**Solution**:

Convert to UTF-8:

```bash
# macOS/Linux
iconv -f ISO-8859-1 -t UTF-8 memory.md > memory-fixed.md
mv memory-fixed.md memory.md

# Or use a text editor
# VS Code: Set encoding to UTF-8 in bottom right
# vim: set fileencoding=utf-8
```

---

### External Memory Not Readable

**Problem**: Child project can't read parent memory files.

**Cause**: Permissions or symlink corruption.

**Solutions**:

1. Check symlink is valid:

```bash
ls -la ~/.synaphex/child-project/memory/external/parent_memory
# Should show the link target
```

1. Fix permissions:

```bash
chmod -R 755 ~/.synaphex/parent-project/memory/internal/
```

1. Relink if corrupted:

```bash
rm ~/.synaphex/child-project/memory/external/parent_memory
/synaphex:remember parent-project child-project
```

---

### Memory Directory Bloat

**Problem**: Memory directory is huge (hundreds of MB).

**Cause**: Large binary files accidentally added, or very old projects.

**Solutions**:

1. Check what's taking space:

```bash
du -sh ~/.synaphex/my-project/memory/internal/*
```

1. Remove unnecessary files:

```bash
rm ~/.synaphex/my-project/memory/internal/large-binary.bin
```

1. Or clean old research:

```bash
rm -rf ~/.synaphex/my-project/memory/internal/research/old-experiments/
```

---

### Can't Create New Project Due to Memory Issues

**Problem**: `/synaphex:create` fails with permission or disk errors.

**Solutions**:

1. Check disk space:

```bash
df -h ~
# Should have >1 GB free
```

1. Check ~/.synaphex directory exists and is writable:

```bash
ls -la ~/.synaphex
# If missing, create it:
mkdir -p ~/.synaphex
chmod 755 ~/.synaphex
```

1. Check file permissions:

```bash
# Make sure user owns the directory
chown -R $USER ~/.synaphex
```

---

### Research Findings Lost

**Problem**: Your research files were deleted.

**Cause**: Manual deletion or version conflict.

**Recovery**:

1. Check git history (if using git):

```bash
git log --follow -p ~/.synaphex/my-project/memory/internal/research/
```

1. Restore from git:

```bash
git checkout HEAD -- ~/.synaphex/my-project/memory/internal/research/
```

1. Re-run researcher if lost:

```bash
/synaphex:task-researcher my-project
```

---

## Memory Best Practices

### Keep Memory in Sync

After major code changes:

```bash
/synaphex:memorize my-project /path/to/codebase
```

### Backup Memory

```bash
# Backup entire project memory
cp -r ~/.synaphex/my-project/memory ~/backups/memory-$(date +%Y%m%d).bak

# Or just the internal directory
tar czf memory-backup.tar.gz ~/.synaphex/my-project/memory/internal/
```

### Version Control

If tracking memory in git:

```bash
# Add memory to git
git add ~/.synaphex/my-project/memory/

# Commit changes
git commit -m "Update project memory"

# Never commit external/ (it's a symlink)
echo "memory/external/" >> .gitignore
```

### Documentation Links

- [Memory Structure](./ARCHITECTURE.md#memory-system)
- [Memory Guide](./MEMORY-GUIDE.md)
- [CLI Reference](./CLI-REFERENCE.md)
