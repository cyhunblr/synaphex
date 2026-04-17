# Error Handling & Recovery (v2.0.0)

## Common Errors & Recovery

### Validation Errors

#### "Project 'X' does not exist"

**Cause**: You referenced a project that hasn't been created.

**Recovery**:

```bash
synaphex create <project>
# This creates the project directory and initializes settings.json and memory/
```

---

#### "Validation failed: Cannot run <step> before <required_step>"

**Cause**: Task workflow requires steps in order. You tried to run a step whose prerequisite hasn't completed.

**Example**:

```
Validation failed: Cannot run planner before examine
Completed steps: ["create"]
Required steps: ["create", "examine"]
```

**Recovery**:

1. Check `task-meta.json` in the task directory
2. Look at `completed_steps` array
3. Run missing prerequisite steps in order:

```bash
# If error says "Cannot run planner before examine"
synaphex task-examine my-project <slug> "task sentence" ~/cwd
# Now examine is complete, planner can run
synaphex task-planner my-project <slug> "task sentence" ~/cwd ...
```

**Prevention**:
Follow the workflow order:

1. task-create (required)
2. task-remember (optional, before examine)
3. task-examine (required)
4. task-researcher (optional)
5. task-planner (required)
6. task-coder (required)
7. task-answerer (optional)
8. task-reviewer (required)

---

#### "Cannot run same step twice"

**Cause**: You ran the same step twice without clearing the previous state.

**Example**:

```
Validation failed: Step 'coder' has already been completed.
Completed steps: ["create", "examine", "planner", "coder"]
```

**Recovery**:
Option 1: Use iteration counter for re-runs (preferred):

```bash
# Re-implement after reviewer feedback
synaphex task-coder my-project <slug> ... 2
# iteration=2, but step is still "coder"
```

Option 2: Reset completed_steps (if you want to re-run from scratch):

1. Edit `task-meta.json` manually
2. Remove the step from `completed_steps` array
3. Re-run the step

**Prevention**:

- Use iteration counter when re-planning or re-implementing
- Don't manually edit `completed_steps` unless necessary

---

### Escalation Errors

#### "Escalation detected. Update task-meta.json and re-run planner"

**Cause**: Answerer found an architectural decision that needs user clarification.

**Flow**:

1. task-answerer runs and detects architectural question
2. Sets `answerer_escalation` in task-meta.json
3. Task PAUSES (no automatic continuation)

**Recovery**:

1. Read the escalation in task-meta.json:

```json
{
  "answerer_escalation": {
    "question": "Should we use Redis or in-memory cache?",
    "context": "Caching layer for 10K users/day, growing...",
    "options": ["Redis (distributed)", "In-memory (simple)"]
  }
}
```

1. Make a decision and add it to the JSON:

```json
{
  "answerer_escalation": {
    "question": "Should we use Redis or in-memory cache?",
    "context": "Caching layer for 10K users/day, growing...",
    "options": ["Redis (distributed)", "In-memory (simple)"],
    "decision": "Redis. Scalability needed as user base grows."
  }
}
```

1. Re-plan with your clarification:

```bash
synaphex task-planner my-project <slug> "task" ~/cwd "context..." "" 2
# iteration=2 incorporates your decision
```

1. Re-implement with updated plan:

```bash
synaphex task-coder my-project <slug> "task" ~/cwd "plan-v2..." "context..." "memory..." 2
```

**Prevention**:

- Be explicit about architectural decisions upfront
- Run task-researcher early to understand constraints
- Ask clarifying questions to Answerer before escalation if uncertain

---

### File & Directory Errors

#### "task-meta.json not found"

**Cause**: Task directory wasn't created by task-create, or file was deleted.

**Recovery**:

1. Verify task directory exists:

```bash
ls -la .synaphex/<project>/task_<slug>/
```

1. If directory missing, recreate from task-create (but use same slug):

```bash
# This creates a new task-meta.json with iteration=1
synaphex task-create my-project "task sentence"
```

1. If directory exists but file is missing, recreate it:

```json
{
  "slug": "task-slug",
  "task": "task sentence",
  "created_at": "2026-04-17T...",
  "status": "created",
  "completed_steps": ["create"],
  "iteration": 1,
  "answerer_escalation": null
}
```

**Prevention**:

- Don't manually delete task-meta.json
- Backup .synaphex directory before bulk operations

---

#### "Cannot create symlink: directory already exists"

**Cause**: task-remember tried to create a symlink, but a regular directory exists at that location.

**Recovery**:

```bash
# Option 1: Remove the existing directory if it's a duplicate
rm -rf .synaphex/<project>/memory/external/<parent>_memory

# Option 2: Use different parent project name
# If the directory is not a duplicate, rename it:
mv .synaphex/<project>/memory/external/<parent>_memory \
   .synaphex/<project>/memory/external/<parent>_memory.old

# Then retry task-remember
synaphex task-remember <parent> <project>
```

**Prevention**:

- Don't manually create directories in memory/external/
- Use task-remember to manage parent memory links

---

### Memory & Context Errors

#### "Memory digest empty or truncated"

**Cause**: Memory wasn't properly compiled from task-examine, or file is corrupted.

**Recovery**:

1. Re-run task-examine to regenerate memory:

```bash
synaphex task-examine my-project <slug> "task" ~/cwd
# This overwrites memory/internal/task_<slug>/{task}.md
```

1. Verify memory files exist:

```bash
ls -la .synaphex/my-project/memory/internal/task_<slug>/
# Should see: <task>.md (raw) and <task>_compact.md (compact)
```

1. If re-examine fails, check cwd permissions:

```bash
ls -la ~/cwd  # Working directory must be readable
```

**Prevention**:

- Don't delete memory files manually
- Keep working directory (cwd) accessible during examine

---

#### "Researcher found no knowledge gaps"

**Cause**: Task and codebase are well-understood; no research needed.

**Recovery**:

- This is normal and acceptable
- Continue to planner without research
- No action needed

**Prevention**:

- Researcher is optional; skip if confident in knowledge
- Use explicitly when facing unfamiliar frameworks/libraries

---

### Tool & Agent Errors

#### "Web search not available in this environment"

**Cause**: Researcher attempted web_search tool in environment without internet access.

**Recovery**:

1. Provide research manually:
   - Create `memory/internal/research/topic.md` with findings
   - Include sources and key insights
   - Researcher will use it if present

2. Or skip researcher:

```bash
# Don't run task-researcher; proceed to planner
synaphex task-planner my-project <slug> ...
```

**Prevention**:

- Research is optional; use in development environments
- Pre-populate memory files if offline

---

#### "Answerer could not answer question"

**Cause**: Question was too ambiguous or required context Answerer didn't have.

**Recovery**:

1. Clarify the question in code:

```typescript
// Before (too vague)
// SYNAPHEX_QUESTION: What should we do here?

// After (specific)
// SYNAPHEX_QUESTION: Should we use lodash or native map/filter?
```

1. Provide more context:

```typescript
// Better: Include domain context
// SYNAPHEX_QUESTION: For user lookups in a 10K+ user list, should we paginate?
```

1. Re-run task-answerer:

```bash
synaphex task-answerer my-project <slug> "task" ~/cwd "implementation..."
```

**Prevention**:

- Ask specific questions with context
- Reference file names and function contexts
- If architectural, ask about tradeoffs explicitly

---

## Edge Cases

### Missing or Corrupted completed_steps

**Scenario**: `completed_steps` array is missing or malformed.

```json
{
  "completed_steps": null, // Wrong
  "status": "examining"
}
```

**Handling**:

1. Manual repair:

```json
{
  "completed_steps": ["create", "examine"], // Recreate based on status
  "status": "examining"
}
```

1. Or restart task:

- Delete task directory and create fresh task-create

### answerer_escalation Timeout

**Scenario**: User doesn't clarify escalation; task sits in paused state indefinitely.

**Expected Behavior**: This is acceptable. Task remains paused until user provides decision.

**Recovery**:

1. User provides decision (edit task-meta.json)
2. Re-run planner to continue workflow

There is no timeout or automatic continuation.

### Researcher with Failing Internet

**Scenario**: Researcher starts but network fails mid-search.

**Recovery**:

1. Researcher fails gracefully and reports it
2. Provide research findings manually
3. Continue to planner

### Reviewer Feedback Loop (Many Iterations)

**Scenario**: Reviewer keeps asking for changes; task cycles planner → coder → reviewer multiple times.

**Normal Behavior**: This is expected for complex features.

**Prevention**:

- Clearer requirements upfront (task-examine + task-researcher)
- More detailed planner output
- Early architectural decisions (via answerer)

---

## Helpful Error Messages

All validation errors follow this format:

```
Validation failed: <error description>
  Step: <step_name>
  Required: ["step1", "step2"]
  Completed: ["step1"]
  Next: Run task-step2 first

For help: See docs/error-handling.md
```

**Always check**:

1. `Completed` array — what's been done
2. `Required` array — what's missing
3. `Next` suggestion — recommended next step

---

## Debugging

### View Current Task State

```bash
cat .synaphex/<project>/task_<slug>/task-meta.json
# Shows: status, completed_steps, answerer_escalation, iteration
```

### View Task Memory

```bash
ls -la .synaphex/<project>/memory/internal/
# Raw and compact examination outputs
```

### View Implementation Log

```bash
cat .synaphex/<project>/task_<slug>/implementation-log-v<N>.md
# Shows files created/modified by Coder
```

### View Plan

```bash
cat .synaphex/<project>/task_<slug>/plan-v<N>.md
# Implementation plan from Planner
```

### Check Escalation State

```bash
cat .synaphex/<project>/task_<slug>/task-meta.json | grep -A 5 answerer_escalation
# Shows question, context, and user's decision (if any)
```

---

## Support Resources

- **CLI Reference**: `docs/cli-reference.md` — All command usage
- **State Machine**: `docs/task-state-machine.md` — Workflow diagram
- **Question Markers**: `docs/coder-questions.md` — Escalation examples
- **GitHub Issues**: Report bugs or ask questions
