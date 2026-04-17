# Synaphex Workflow Guide (v2.0.0)

Complete guide to using Synaphex for project tasks, with real-world examples.

## Quick Start

```bash
# 1. Create a project
synaphex create my-project

# 2. Create a task
synaphex task-create my-project "Add user authentication"

# 3. Examine the codebase
synaphex task-examine my-project <slug> "Add user authentication" ~/cwd

# 4. Get a plan
synaphex task-planner my-project <slug> "Add user authentication" ~/cwd "<examined_context>"

# 5. Implement
synaphex task-coder my-project <slug> "Add user authentication" ~/cwd "<plan>" "<context>" "<memory>"

# 6. Get answers to questions
synaphex task-answerer my-project <slug> "Add user authentication" ~/cwd "<implementation>"

# 7. Get review
synaphex task-reviewer my-project <slug> "Add user authentication" ~/cwd "<code>" "<context>"
```

## The 8-Step Task Workflow

Synaphex tasks follow a **user-orchestrated** workflow. You decide when to run each step.

### Step 1: Create (`task-create`)

**Purpose:** Initialize a task

**Usage:**

```bash
synaphex task-create my-project "Add user authentication with JWT"
```

**What it does:**

- Creates task directory: `.synaphex/my-project/memory/internal/task_<slug>/`
- Initializes `task-meta.json` with:
  - `slug`: URL-safe task identifier
  - `task`: Your task sentence
  - `created_at`: Timestamp
  - `status`: "created"
  - `completed_steps`: ["create"]
  - `iteration`: 1
  - `answerer_escalation`: null

**Output:**

- Task slug (use in subsequent commands)
- Path to task directory

**When to use:** Start of any new task

---

### Step 2: Remember (Optional, `task-remember`)

**Purpose:** Link parent project's memory for context

**Usage:**

```bash
synaphex task-remember parent-project my-project
```

**What it does:**

- Creates symlink: `.synaphex/my-project/memory/external/parent-project_memory/ → ../../../parent-project/memory/internal/`
- Appends "remember" to `completed_steps`

**When to use:** Before examine, if building on another project

---

### Step 3: Examine (`task-examine`)

**Purpose:** Analyze codebase and gather context

**Usage:**

```bash
synaphex task-examine my-project <slug> "Add user authentication with JWT" ~/cwd
```

**What it does:**

- Reads codebase at `~/cwd`
- Analyzes relevant files (imports, patterns, structure)
- Reads `memory/internal/` for patterns and prior research
- Reads `memory/external/` if linked from parent
- Generates:
  - Raw examination: `task_<slug>/<task>.md` (5-20 KB)
  - Compact digest: `task_<slug>/<task>_compact.md` (1-3 KB)
- Appends "examine" to `completed_steps`

**Output:**

- Examined context (raw markdown)
- Compact version (use in planner/coder)

**When to use:** Right after create (or remember)

**Note:** All subsequent commands need the examined context. Save the output.

---

### Step 4: Researcher (Optional, `task-researcher`)

**Purpose:** Research unfamiliar technologies/patterns

**Usage:**

```bash
synaphex task-researcher my-project <slug> "Add user authentication with JWT" ~/cwd "<examined_context>"
```

**What it does:**

- Analyzes task and examined context for knowledge gaps
- Searches web for unfamiliar libraries, frameworks, patterns
- Creates research files: `memory/internal/research/<topic>.md`
- Appends "researcher" to `completed_steps`

**Output:**

- Research summary with findings
- Memory files created for future reference

**When to use:** Before planner if task involves unfamiliar technology

**Example:** Task involves "Triton inference server" but you've never used it → use researcher

---

### Step 5: Planner (`task-planner`)

**Purpose:** Create architecture and implementation plan

**Usage:**

```bash
synaphex task-planner my-project <slug> "Add user authentication with JWT" ~/cwd "<examined_context>"
```

**What it does:**

- Reads examined context
- Reads `memory/internal/patterns/` for project conventions
- Reads `memory/external/` if linked from parent
- Creates detailed implementation plan
- Saves to `task_<slug>/plan-v<iteration>.md`
- Appends "planner" to `completed_steps`

**Output:**

- Implementation plan (architecture, file structure, step-by-step approach)

**When to use:** After examine (and researcher if used)

**Note:** Save the plan output for coder.

---

### Step 6: Coder (`task-coder`)

**Purpose:** Implement the task

**Usage:**

```bash
synaphex task-coder my-project <slug> "Add user authentication with JWT" ~/cwd \
  "<plan>" "<examined_context>" "<memory_digest>" 1
```

**What it does:**

- Reads plan and context
- Implements code directly
- Can embed question markers for answerer:

  ```typescript
  // SYNAPHEX_QUESTION: Should we store JWT in localStorage or cookie?
  // SYNAPHEX_ARCHITECTURAL: Should auth be centralized or per-route?
  ```

- Detects questions and may ask answerer (optional)
- Saves to `task_<slug>/implementation-log-v<iteration>.md`
- Appends "coder" to `completed_steps`

**Output:**

- Implementation summary with files modified
- List of questions asked (if any)

**When to use:** After planner

**Note:** Iteration counter tracks re-implementations (1, 2, 3...)

---

### Step 7: Answerer (`task-answerer`)

**Purpose:** Answer Coder's architectural questions

**Usage:**

```bash
synaphex task-answerer my-project <slug> "Add user authentication with JWT" ~/cwd "<implementation_summary>"
```

**What it does:**

- Reads implementation summary from Coder
- Detects embedded questions:
  - `SYNAPHEX_QUESTION`: Technical questions
  - `SYNAPHEX_ARCHITECTURAL`: Architecture decisions
- For technical questions: provides answer
- For architectural questions: escalates to user
  - Sets `answerer_escalation` in `task-meta.json`
  - **Pauses task execution** (waits for user decision)
- Appends "answerer" to `completed_steps`

**Output:**

- Answers to technical questions
- Escalation details (if architectural question)

**Escalation Flow:**

1. Answerer detects architectural question
2. Sets `task-meta.json`:

   ```json
   {
     "answerer_escalation": {
       "question": "Should we use centralized or per-route auth?",
       "context": "Affects middleware placement and token validation",
       "options": ["Centralized", "Per-route"]
     }
   }
   ```

3. **Task pauses** - user must decide
4. User updates `task-meta.json` with decision:

   ```json
   {
     "answerer_escalation": {
       "question": "...",
       "context": "...",
       "options": ["...", "..."],
       "decision": "Centralized auth via middleware. Cleaner and more secure."
     }
   }
   ```

5. Run planner again with `iteration: 2` to re-plan with decision

**When to use:** After coder (required step)

**When paused:** Update `task-meta.json` with decision, then re-run planner

---

### Step 8: Reviewer (`task-reviewer`)

**Purpose:** Review implementation and provide feedback

**Usage:**

```bash
synaphex task-reviewer my-project <slug> "Add user authentication with JWT" ~/cwd \
  "<implementation>" "<context>"
```

**What it does:**

- Reviews code from Coder
- Checks against plan, patterns, best practices
- Identifies issues or improvements
- Appends "reviewer" to `completed_steps`

**Output:**

- Review feedback and suggestions

**Feedback Loop:**

- If issues found: reviewer provides feedback
- Re-run planner with feedback (iteration + 1)
- Re-run coder with updated plan
- Loop until reviewer is satisfied

---

## Workflow Examples

### Example 1: Simple Feature (No Research, No Escalation)

```bash
# Task: "Add password reset endpoint"
synaphex task-create my-project "Add password reset endpoint"

# Examine
synaphex task-examine my-project add-password-reset "Add password reset endpoint" ~/cwd

# Plan
synaphex task-planner my-project add-password-reset "Add password reset endpoint" ~/cwd "<examined>"

# Implement (no questions expected)
synaphex task-coder my-project add-password-reset "Add password reset endpoint" ~/cwd \
  "<plan>" "<examined>" "<memory>"

# Answerer (no escalation expected)
synaphex task-answerer my-project add-password-reset "Add password reset endpoint" ~/cwd \
  "<implementation>"

# Review
synaphex task-reviewer my-project add-password-reset "Add password reset endpoint" ~/cwd \
  "<implementation>" "<context>"

# If feedback: repeat planner → coder → answerer → reviewer
```

---

### Example 2: Complex Feature with Research

```bash
# Task: "Integrate GraphQL subscription support"
synaphex task-create my-project "Integrate GraphQL subscription support"

synaphex task-examine my-project graphql-subscriptions "Integrate GraphQL subscription support" ~/cwd

# Don't know much about subscriptions → research
synaphex task-researcher my-project graphql-subscriptions "Integrate GraphQL subscription support" ~/cwd \
  "<examined>"

# Research findings saved to memory/internal/research/
# Now plan with research available
synaphex task-planner my-project graphql-subscriptions "Integrate GraphQL subscription support" ~/cwd \
  "<examined>"

synaphex task-coder my-project graphql-subscriptions "Integrate GraphQL subscription support" ~/cwd \
  "<plan>" "<examined>" "<memory>"

synaphex task-answerer my-project graphql-subscriptions "Integrate GraphQL subscription support" ~/cwd \
  "<implementation>"

synaphex task-reviewer my-project graphql-subscriptions "Integrate GraphQL subscription support" ~/cwd \
  "<implementation>" "<context>"
```

---

### Example 3: Escalation (Architectural Decision)

```bash
# Task: "Implement real-time notifications"
synaphex task-create my-project "Implement real-time notifications"

synaphex task-examine my-project realtime-notifications "Implement real-time notifications" ~/cwd

synaphex task-planner my-project realtime-notifications "Implement real-time notifications" ~/cwd \
  "<examined>"

# Coder asks architectural question
synaphex task-coder my-project realtime-notifications "Implement real-time notifications" ~/cwd \
  "<plan>" "<examined>" "<memory>"
# Output includes: "SYNAPHEX_ARCHITECTURAL: WebSockets vs Server-Sent Events?"

synaphex task-answerer my-project realtime-notifications "Implement real-time notifications" ~/cwd \
  "<implementation>"
# Output: "Escalation detected. Update task-meta.json with decision."

# Edit task-meta.json:
cat > .synaphex/my-project/memory/internal/task_realtime-notifications/task-meta.json <<'EOF'
{
  "...": "...",
  "answerer_escalation": {
    "question": "WebSockets vs Server-Sent Events?",
    "context": "Real-time updates, 1000s of concurrent users",
    "options": ["WebSockets (bidirectional)", "SSE (unidirectional)"],
    "decision": "WebSockets. Need bidirectional for live updates."
  }
}
EOF

# Re-plan with decision (iteration 2)
synaphex task-planner my-project realtime-notifications "Implement real-time notifications" ~/cwd \
  "<examined>" "" 2

# Re-implement
synaphex task-coder my-project realtime-notifications "Implement real-time notifications" ~/cwd \
  "<plan-v2>" "<examined>" "<memory>" 2

synaphex task-answerer my-project realtime-notifications "Implement real-time notifications" ~/cwd \
  "<implementation-v2>"

synaphex task-reviewer my-project realtime-notifications "Implement real-time notifications" ~/cwd \
  "<implementation-v2>" "<context>"
```

---

### Example 4: Multi-Project (Child Inherits Parent Knowledge)

```bash
# Parent project has established patterns
# Create child project that builds on parent

# Parent has: memory/internal/patterns/api-standards.md, auth-patterns.md, etc.

synaphex task-create child-project "Add team management endpoints"

# Link parent memory BEFORE examining
synaphex task-remember parent-project child-project

synaphex task-examine child-project team-endpoints "Add team management endpoints" ~/cwd
# Examiner can see parent patterns automatically

synaphex task-planner child-project team-endpoints "Add team management endpoints" ~/cwd \
  "<examined>"
# Planner can reference parent patterns: "Follow parent's API standards (see external memory)"

synaphex task-coder child-project team-endpoints "Add team management endpoints" ~/cwd \
  "<plan>" "<examined>" "<memory>"

synaphex task-answerer child-project team-endpoints "Add team management endpoints" ~/cwd \
  "<implementation>"

synaphex task-reviewer child-project team-endpoints "Add team management endpoints" ~/cwd \
  "<implementation>" "<context>"
```

---

## Memory Management

### Where Memory Lives

```
.synaphex/my-project/
├── memory/
│   ├── internal/                 # Project-specific knowledge
│   │   ├── task_<slug>/
│   │   │   ├── <task>.md         # Raw examination
│   │   │   └── <task>_compact.md # Compact version
│   │   ├── research/
│   │   │   ├── triton-setup.md
│   │   │   └── oauth-implementation.md
│   │   └── patterns/
│   │       ├── api-standards.md
│   │       ├── database-models.md
│   │       └── error-handling.md
│   └── external/                 # Linked from other projects
│       └── parent-project_memory/  (symlink to parent's internal/)
```

### Creating Memory Files

**Patterns (manual):**

```bash
cat > .synaphex/my-project/memory/internal/patterns/api-standards.md <<'EOF'
# API Standards

All endpoints follow REST conventions:
- GET /api/v1/<resource> — List
- POST /api/v1/<resource> — Create
- GET /api/v1/<resource>/<id> — Get single
- PUT /api/v1/<resource>/<id> — Update
- DELETE /api/v1/<resource>/<id> — Delete

Response format: {status: "ok"|"error", data: {...}, error: null|string}
EOF
```

**Research findings (via task-researcher):**

- Automatically saved to `memory/internal/research/<topic>.md`

**Task examinations (via task-examine):**

- Automatically saved as raw and compact versions

### Using Memory Files

**In Planner/Coder prompts:**

- Automatically loaded if they exist
- Referenced as: "See memory/internal/patterns/api-standards.md for standards"

**In external projects:**

- Accessible as: `memory/external/<parent-project>_memory/patterns/...`
- Referenced as: "Inherit from parent: see external memory"

---

## State Management (task-meta.json)

The state file tracks task progress:

```json
{
  "slug": "add-auth",
  "task": "Add user authentication with JWT",
  "created_at": "2026-04-17T10:30:00Z",
  "status": "implementing",
  "completed_steps": ["create", "examine", "planner", "coder"],
  "iteration": 1,
  "answerer_escalation": null
}
```

**After escalation:**

```json
{
  "...": "...",
  "completed_steps": ["create", "examine", "planner", "coder", "answerer"],
  "answerer_escalation": {
    "question": "Centralized or per-route auth?",
    "context": "Middleware placement affects security",
    "options": ["Centralized", "Per-route"],
    "decision": "Centralized"
  }
}
```

**After re-planning:**

```json
{
  "...": "...",
  "completed_steps": ["create", "examine", "planner", "coder", "answerer"],
  "iteration": 2,
  "answerer_escalation": null
}
```

---

## Error Recovery

### Common Issues

#### "Cannot run planner before examine"

- You skipped examine step
- Run: `synaphex task-examine ...` first

#### "Step 'coder' has already been completed"

- You already ran coder once
- For iterations: use the `iteration` parameter (fourth argument)
- Or reset `completed_steps` in `task-meta.json` to modify

#### "Escalation detected"

- Answerer found an architectural question
- Update `task-meta.json` with `decision`
- Re-run planner with iteration + 1

#### "Memory files missing"

- Normal - memory is optional
- Examiner will note what's missing
- Create memory files manually if needed

See [error-handling.md](error-handling.md) for complete troubleshooting.

---

## Tips & Tricks

### Save Context Between Commands

Each command outputs context needed for the next. Always save it:

```bash
# Examine
examined=$(synaphex task-examine ...)

# Plan
plan=$(synaphex task-planner ... "$examined")

# Implement
implementation=$(synaphex task-coder ... "$plan" "$examined" ...)

# And so on...
```

### Use Iteration Counter for Re-Work

After feedback from reviewer:

```bash
# First iteration (default = 1)
synaphex task-coder ... 1

# After feedback, re-work (iteration 2)
synaphex task-planner ... 2
synaphex task-coder ... 2
synaphex task-answerer ... 2
synaphex task-reviewer ... 2

# And so on...
```

### Batch Commands in Scripts

```bash
#!/bin/bash
PROJECT=my-project
SLUG=add-auth
TASK="Add user authentication"
CWD=~/cwd

examined=$(synaphex task-examine "$PROJECT" "$SLUG" "$TASK" "$CWD")
plan=$(synaphex task-planner "$PROJECT" "$SLUG" "$TASK" "$CWD" "$examined")
implementation=$(synaphex task-coder "$PROJECT" "$SLUG" "$TASK" "$CWD" "$plan" "$examined" "")
answers=$(synaphex task-answerer "$PROJECT" "$SLUG" "$TASK" "$CWD" "$implementation")
review=$(synaphex task-reviewer "$PROJECT" "$SLUG" "$TASK" "$CWD" "$implementation" "")

echo "=== Answers ==="
echo "$answers"
echo ""
echo "=== Review ==="
echo "$review"
```

---

## Related Documentation

For more guidance and deeper dives:

- **[GETTING-STARTED.md](GETTING-STARTED.md)** — 5-minute quick start guide
- **[HOW-TO-GUIDE.md](HOW-TO-GUIDE.md)** — Common task-based workflows
- **[EXAMPLES.md](EXAMPLES.md)** — Real-world workflow examples
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — System design and state machine details
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** — Common issues and error recovery
- **[CLI-REFERENCE.md](CLI-REFERENCE.md)** — All CLI commands and options

For deployment and upgrades, see [README.md](../README.md) and [MIGRATION.md](../MIGRATION.md).
