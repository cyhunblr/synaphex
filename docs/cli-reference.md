# Synaphex v2.0.0 CLI Reference

## Commands Overview

All commands follow the pattern: `synaphex <command> <project> [options]`

### task-create

Create a new task in a project.

**Usage**:

```bash
synaphex task-create <project> "<task_sentence>"
```

**Arguments**:

- `project`: Project name (created with `/synaphex/create`)
- `task_sentence`: Description of what to build (in quotes)

**Output**:

- Creates `task-meta.json` with:
  - `slug`: URL-safe task identifier
  - `completed_steps: ["create"]`
  - `status: "created"`
  - `iteration: 1`
  - `answerer_escalation: null`

**Example**:

```bash
synaphex task-create my-project "Add user authentication with JWT"
```

---

### task-examine

Examine codebase and memory for task context.

**Usage**:

```bash
synaphex task-examine <project> <slug> "<task_sentence>" <cwd>
```

**Arguments**:

- `project`: Project name
- `slug`: Task slug (from task-create output)
- `task_sentence`: Original task description
- `cwd`: Working directory to examine

**Prerequisites**:

- Must have run `task-create` first
- `completed_steps` must include "create"

**Output**:

- `memory/internal/task_<slug>/<task_sentence>.md` (raw examination)
- `memory/internal/task_<slug>/<task_sentence>_compact.md` (compact version)
- Updates `completed_steps` to include "examine"
- Sets `status: "examined"`

**Example**:

```bash
synaphex task-examine my-project add-auth "Add user authentication" ~/projects/my-app
```

---

### task-remember

Link parent project memory into child project (optional, before examine).

**Usage**:

```bash
synaphex task-remember <parent_project> <project>
```

**Arguments**:

- `parent_project`: Source project name
- `project`: Child project that will access parent memory

**Effect**:

- Creates symlink: `child/memory/external/<parent_project>_memory` → `parent/memory/internal/`
- Child project can now read parent's memory files
- Must run **before** task-examine
- Can run multiple times (updates existing link)

**Example**:

```bash
synaphex task-remember main-project sub-project
```

---

### task-researcher

Research knowledge gaps (optional, after examine).

**Usage**:

```bash
synaphex task-researcher <project> <slug> "<task_sentence>" <cwd> "<examiner_compact>"
```

**Arguments**:

- `project`, `slug`: Task identifiers
- `task_sentence`: Original task
- `cwd`: Working directory
- `examiner_compact`: Compact knowledge from task-examine

**Prerequisites**:

- Must have run `task-examine` first
- Optional step (user chooses "Researcher: yes/no" during task-create)

**Output**:

- `memory/internal/research/*.md` (research findings per topic)
- Research results included in Planner input
- Does NOT change task status

**Example**:

```bash
synaphex task-researcher my-project add-auth "Add auth" ~/app "examined context..."
```

---

### task-planner

Create implementation plan based on context and research.

**Usage**:

```bash
synaphex task-planner <project> <slug> "<task_sentence>" <cwd> "<examiner_compact>" [reviewer_feedback] [iteration]
```

**Arguments**:

- `project`, `slug`: Task identifiers
- `task_sentence`: Original task
- `cwd`: Working directory
- `examiner_compact`: Compact knowledge from examine
- `reviewer_feedback`: (Optional) Feedback from previous review
- `iteration`: (Optional) For re-planning after escalation

**Prerequisites**:

- Must have run `task-examine` first
- Planner is mandatory

**Output**:

- `plan-v{N}.md` with implementation steps
- Updates `completed_steps` to include "planner"
- Sets `status: "planned"`

**Re-planning**:
If `answerer_escalation` exists in task-meta.json:

- Clears escalation after reading it
- Incorporates user's clarification decision
- Increments iteration counter

**Example**:

```bash
synaphex task-planner my-project add-auth "Add auth" ~/app "context..."
```

**Re-plan after escalation**:

```bash
synaphex task-planner my-project add-auth "Add auth" ~/app "context..." "" 2
```

---

### task-coder

Implement code based on plan.

**Usage**:

```bash
synaphex task-coder <project> <slug> "<task_sentence>" <cwd> "<plan>" "<examiner_compact>" "<memory_digest>" [iteration]
```

**Arguments**:

- `project`, `slug`: Task identifiers
- `task_sentence`: Original task
- `cwd`: Working directory to modify
- `plan`: Plan from task-planner
- `examiner_compact`: Compact context
- `memory_digest`: Memory summary
- `iteration`: (Optional) Implementation iteration

**Prerequisites**:

- Must have run `task-planner` first

**Output**:

- Modified files at `cwd`
- `implementation-log-v{N}.md` with files changed
- Updates `completed_steps` to include "coder"
- Sets `status: "implemented"`

**Available Tools**:

- `read_file(path)`: Read code file
- `write_file(path, content)`: Create/overwrite file
- `edit_file(path, old_text, new_text)`: Surgical edits
- `list_files(pattern)`: List matching files
- `search_code(pattern, glob)`: Search code
- `ask_answerer(question, context)`: Ask architectural/technical question

**Question Markers**:
During implementation, embed questions with:

```typescript
// SYNAPHEX_QUESTION: Should we use async/await here?
// SYNAPHEX_ARCHITECTURAL: Should this be a singleton or injected?
```

These will be answered by task-answerer before review.

**Example**:

```bash
synaphex task-coder my-project add-auth "Add auth" ~/app \
  "Plan: 1. Add JWT lib..." \
  "Context: Express app at..." \
  "Memory: Contains auth patterns..."
```

---

### task-answerer

Answer Coder questions and escalate architectural decisions.

**Usage**:

```bash
synaphex task-answerer <project> <slug> "<task_sentence>" <cwd> "<implementation_summary>"
```

**Arguments**:

- `project`, `slug`: Task identifiers
- `task_sentence`: Original task
- `cwd`: Working directory (for code context)
- `implementation_summary`: Summary from task-coder output

**Prerequisites**:

- Must have run `task-coder` first
- Optional step (user chooses during workflow)

**Behavior**:

1. Finds embedded question markers in code
2. Answers technical questions independently
3. Detects architectural questions
4. **On architectural decision**: Sets `answerer_escalation` in task-meta.json and PAUSES
   - User must update `answerer_escalation` field in task-meta.json with their decision
   - Then run `task-planner` again (iteration++)
5. **No escalation**: Updates `completed_steps` and continues to reviewer

**Output**:

- Answers to all questions
- If escalation: marked with `<escalation>` tags
- Instruction: "Update task-meta.json with your decision, then re-run task-planner"

**Example**:

```bash
synaphex task-answerer my-project add-auth "Add auth" ~/app \
  "Implementation: JWT setup complete, found question about encryption..."
```

**After escalation** (user action):
Edit `task-meta.json`:

```json
{
  "answerer_escalation": {
    "question": "Should tokens be encrypted or just signed?",
    "context": "...",
    "decision": "Signed tokens with secure storage. Encryption not needed if HTTPS enforced."
  }
}
```

Then re-plan:

```bash
synaphex task-planner my-project add-auth ... 2
```

---

### task-reviewer

Review implemented code for quality and correctness.

**Usage**:

```bash
synaphex task-reviewer <project> <slug> "<task_sentence>" <cwd> "<implementation_summary>" [iteration]
```

**Arguments**:

- `project`, `slug`: Task identifiers
- `task_sentence`: Original task
- `cwd`: Working directory (to review files)
- `implementation_summary`: Output from task-coder
- `iteration`: (Optional) For re-review iterations

**Prerequisites**:

- Must have run `task-coder` first
- Answerer optional

**Output**:

- Pass: `status: "reviewed"`, task done
- Feedback: If issues found, feedback sent to Planner
  - User runs `task-planner` with feedback
  - Iteration incremented
  - Cycle continues: planner → coder → reviewer

**Example**:

```bash
synaphex task-reviewer my-project add-auth "Add auth" ~/app \
  "Implementation: Files created: auth.ts, jwt-middleware.ts"
```

---

## Workflow Examples

### Simple Flow (No Researcher, User Review)

```bash
# 1. Create task
synaphex task-create my-project "Add logging"

# 2. Examine codebase (returns examiner_compact)
synaphex task-examine my-project add-logging "Add logging" ~/app

# 3. Plan (returns plan)
synaphex task-planner my-project add-logging "Add logging" ~/app "examined..."

# 4. Implement (returns implementation_summary)
synaphex task-coder my-project add-logging "Add logging" ~/app \
  "plan: 1. Add winston lib..." "context..." "memory..."

# 5. Review (user chooses "user performs review" mode)
synaphex task-reviewer my-project add-logging "Add logging" ~/app "implementation..."
```

### With Research & Escalation

```bash
# 1-2: Create and examine
synaphex task-create my-project "Integrate Triton"
synaphex task-examine my-project integrate-triton "Integrate Triton" ~/app

# 3. Research (optional)
synaphex task-researcher my-project integrate-triton "Integrate Triton" ~/app "examined..."

# 4-5: Plan and code
synaphex task-planner my-project integrate-triton "Integrate Triton" ~/app "examined..."
synaphex task-coder my-project integrate-triton "Integrate Triton" ~/app \
  "plan: 1. Load model..." "context..." "memory..."

# 6. Answer (detects architectural question)
synaphex task-answerer my-project integrate-triton "Integrate Triton" ~/app "implementation..."

# 7. User clarifies escalation (manual JSON edit)
# Edit task-meta.json: answerer_escalation.decision = "Inference server as separate service"

# 8. Re-plan with clarification (iteration 2)
synaphex task-planner my-project integrate-triton "Integrate Triton" ~/app \
  "examined..." "" 2

# 9. Re-implement (iteration 2)
synaphex task-coder my-project integrate-triton "Integrate Triton" ~/app \
  "plan v2: 1. Create inference server..." "context..." "memory..." 2

# 10. Review
synaphex task-reviewer my-project integrate-triton "Integrate Triton" ~/app \
  "implementation v2..." 2
```

---

## Error Messages

### "Project 'X' does not exist"

- Create project first: `/synaphex/create <project>`

### "Validation failed: Cannot run <step> before <required_step>"

- Check `task-meta.json` `completed_steps` array
- Run missing prerequisites in order

### "Cannot run same step twice"

- Remove step from `completed_steps` if you want to re-run, or use iteration counter for re-plans

### "Escalation detected in answer. Update task-meta.json and re-run planner"

- Edit `task-meta.json` and add your decision to `answerer_escalation` field
- Run `task-planner` again with iteration++

---

## Notes

- All paths can be relative to project root
- Task slugs are auto-generated (URL-safe)
- Memory files persist across runs
- `completed_steps` is authoritative for workflow state
- No automatic transitions—each step is explicit and manual
