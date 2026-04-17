# Architecture — System Design Overview

This document describes the internal design of Synaphex v2.0.0, including the agent pipeline, state machine, memory system, and data structures.

## Agent Pipeline

The task execution pipeline consists of 6 sequential agents, each with specific responsibilities:

```
User Input
    ↓
[1. Examiner] — Analyzes codebase & project memory
    ↓
[2. Researcher] (optional) — Performs web research on knowledge gaps
    ↓
[3. Planner] — Creates implementation plan
    ↓
[4. Coder] — Generates and writes code
    ↓
[5. Answerer] — Handles architectural questions & escalations
    ↓
[6. Reviewer] — Validates changes & provides feedback
    ↓
Task Complete / Applied to Codebase
```

### 1. Examiner Agent

**Role:** Read codebase and produce analysis  
**Input:** Task description, project path  
**Output:** RAW analysis + COMPACT analysis (saved to disk)

**Responsibilities:**

- List files and structure using `find`
- Read relevant source files (limited by 100KB per file)
- Search code for patterns using `grep`
- Update project memory if outdated
- Produce two-part analysis:
  - **RAW**: Full context with all code excerpts (for reference)
  - **COMPACT**: Summarized for next agents (max 4000 tokens)

**Tools:**

- `read_file` — Read file contents
- `list_files` — List files by pattern
- `search_code` — Search using regex
- `write_memory` — Update project memory

### 2. Researcher Agent (Optional)

**Role:** Conduct internet research on knowledge gaps  
**Input:** Knowledge gaps identified by Examiner  
**Output:** Research findings (saved to task memory)

**Triggered when:**

- Task mentions unfamiliar libraries/frameworks
- Examiner identifies "knowledge gaps"
- User explicitly enables research

**Responsibilities:**

- Search for best practices, documentation, examples
- Synthesize findings into actionable guidance
- Identify common pitfalls and solutions
- Save findings to `.synaphex/tasks/{task-id}/research.md`

**Tools:**

- `web_search` — Search the internet
- `write_memory` — Save findings

### 3. Planner Agent

**Role:** Create detailed implementation plan  
**Input:** Examiner analysis, optional Researcher findings  
**Output:** Step-by-step implementation plan

**Responsibilities:**

- Break task into discrete steps
- Identify files to create/modify/delete
- Flag architectural decisions needing user input
- Create logical sequence respecting dependencies
- Estimate time for each step

**Asks user for approval before proceeding.**

### 4. Coder Agent

**Role:** Generate and write code  
**Input:** Implementation plan, examiner analysis  
**Output:** Code changes applied to files

**Responsibilities:**

- Implement each step from plan
- Generate code following project patterns
- Write tests alongside implementation
- Handle errors gracefully
- Update task state after each step

**Tools:**

- `read_file` — Check existing code
- `write_file` — Create new files
- `edit_file` — Modify existing files
- `list_files` — Verify structure

### 5. Answerer Agent

**Role:** Handle architectural questions and escalations  
**Input:** Coder questions, implementation context  
**Output:** Answers or escalation to user

**Triggered when:**

- Coder encounters architectural question
- Multiple valid approaches exist
- Decision affects system design

**Responsibilities:**

- Analyze question and options
- Provide context on trade-offs
- Ask user for guidance if needed
- Document decision in memory for consistency

### 6. Reviewer Agent

**Role:** Validate implementation quality  
**Input:** Generated code, original requirements  
**Output:** Feedback and approval

**Responsibilities:**

- Check code against requirements
- Verify tests cover happy path and edge cases
- Confirm patterns match project conventions
- Identify potential issues or improvements

---

## State Machine

Synaphex tasks flow through defined states with validation rules:

```
CREATED
  ↓ (after Examiner)
EXAMINED
  ↓ (after Researcher, if enabled)
RESEARCHED
  ↓ (after Planner)
PLANNED
  ↓ (user approval)
IMPLEMENTING
  ├─ (per step completion)
  ├─ STEP_1_COMPLETE
  ├─ STEP_2_COMPLETE
  ├─ ...
  ↓
IMPLEMENTED
  ↓ (after Reviewer)
REVIEWED
  ↓ (user applies changes)
COMPLETE
```

### State Validation Rules

| State             | Allowed From             | Requires              | Transitions To              |
| ----------------- | ------------------------ | --------------------- | --------------------------- |
| `CREATED`         | Initial                  | description           | `EXAMINED`                  |
| `EXAMINED`        | `CREATED`                | analysis file         | `RESEARCHED` or `PLANNED`   |
| `RESEARCHED`      | `EXAMINED`               | research file         | `PLANNED`                   |
| `PLANNED`         | `EXAMINED`, `RESEARCHED` | plan file             | `IMPLEMENTING`              |
| `IMPLEMENTING`    | `PLANNED`                | step tracking         | `STEP_N_COMPLETE`           |
| `STEP_N_COMPLETE` | `IMPLEMENTING`           | completed_steps array | `STEP_N+1` or `IMPLEMENTED` |
| `IMPLEMENTED`     | `STEP_N_COMPLETE`        | code changes          | `REVIEWED`                  |
| `REVIEWED`        | `IMPLEMENTED`            | review feedback       | `COMPLETE`                  |
| `COMPLETE`        | `REVIEWED`               | all artifacts         | End                         |

### Task Metadata Structure

```json
{
  "id": "task-20240417-001",
  "description": "Add user authentication",
  "state": "IMPLEMENTING",
  "progress": {
    "current_step": 3,
    "total_steps": 8,
    "completed_steps": [1, 2]
  },
  "timestamps": {
    "created": "2026-04-17T10:30:00Z",
    "examined": "2026-04-17T10:35:00Z",
    "planned": "2026-04-17T10:42:00Z"
  },
  "artifacts": {
    "analysis": ".synaphex/tasks/task-001/analysis.md",
    "plan": ".synaphex/tasks/task-001/plan.md",
    "research": ".synaphex/tasks/task-001/research.md"
  },
  "escalations": [
    {
      "type": "architectural",
      "question": "Should we use JWT or session-based auth?",
      "answer": "JWT for API, sessions for web UI",
      "decided_at": "2026-04-17T10:48:00Z"
    }
  ]
}
```

---

## Memory System

Project memory is organized hierarchically into internal and external memory:

```
.synaphex/
├── settings.json              # Project configuration
├── memory/                    # Internal (project-specific)
│   ├── MEMORY.md             # Index of memory files
│   ├── architecture.md       # System design notes
│   ├── conventions.md        # Coding standards
│   ├── patterns.md           # Common patterns
│   └── [custom files]        # User-defined topics
├── external-memory/          # External (linked from parents)
│   ├── architecture.md -> ../../parent-project/.synaphex/memory/architecture.md
│   └── conventions.md -> ../../parent-project/.synaphex/memory/conventions.md
└── tasks/                    # Task-specific artifacts
    └── task-001/
        ├── task-meta.json
        ├── analysis.md
        ├── plan.md
        └── research.md (if applicable)
```

### Memory File Types

**Internal Memory (`.synaphex/memory/`)**

Persistent knowledge about your project:

```markdown
---
name: database_schema
description: Current database structure and migration strategy
type: project
---

## Tables

- users: Core user model with auth info
- projects: Project containers with settings
- tasks: Task tracking with state machine

## Migration Strategy

- Use Flyway for versioning
- Backwards-compatible migrations required
- Test all migrations on staging first
```

### External Memory (symlinks)

Reference to parent/shared project memory. Read-only in child projects.

**Task Memory (`.synaphex/tasks/{id}/`)**

Temporary artifacts for a specific task:

- `task-meta.json` — State and progress
- `analysis.md` — Examiner's findings
- `plan.md` — Implementation plan
- `research.md` — Researcher findings (if any)

---

## Question Escalation

When Coder encounters architectural questions, Synaphex escalates to the user:

```
Coder encounters question:
"Should authentication be in middleware or per-route?"

↓

Synaphex analyzes context:
- Current request handling patterns
- Scaling implications
- Security considerations
- Team preferences (from memory)

↓

Present to user:
"**Question:** Where should authentication logic live?
**Options:**
1. Middleware (centralized, harder to bypass)
2. Per-route decorators (flexible, easy to forget)
3. Hybrid (critical routes in middleware, others custom)

**Impact:**
- Maintainability: Middleware > Decorators > Hybrid
- Flexibility: Hybrid > Decorators > Middleware"

↓

User provides answer + rationale:
"Middleware for core API routes, decorators for webhooks"

↓

Decision saved to memory:
escalations.json records the decision for future consistency
```

### Escalation Types

| Type            | Example                        | Decision Impact    |
| --------------- | ------------------------------ | ------------------ |
| `architectural` | "JWT vs sessions?"             | Auth system design |
| `performance`   | "In-memory cache or Redis?"    | Caching strategy   |
| `database`      | "Denormalize for speed?"       | Schema design      |
| `testing`       | "How much edge-case coverage?" | Test strategy      |
| `deployment`    | "Blue-green or canary?"        | Release process    |

---

## Data Structures

### Task Progress Object

```json
{
  "id": "task-20240417-001",
  "description": "Add error handling middleware",
  "state": "IMPLEMENTING",
  "completed_steps": [
    "1.1_Create error handler module",
    "1.2_Add try-catch wrappers",
    "1.3_Write error tests"
  ],
  "current_step": "1.4_Update error logging",
  "total_steps": 6,
  "steps_complete": 3,
  "steps_remaining": 3,
  "progress_percent": 50
}
```

### Analysis Object

```json
{
  "task_id": "task-20240417-001",
  "timestamp": "2026-04-17T10:35:00Z",
  "files_analyzed": 12,
  "patterns_identified": ["express-middleware-pattern", "async-error-handling"],
  "memory_updated": true,
  "raw_analysis_path": ".synaphex/tasks/task-001/analysis-raw.md",
  "compact_analysis_path": ".synaphex/tasks/task-001/analysis-compact.md",
  "summary": "Existing error handling uses try-catch blocks. Recommend middleware wrapper for DRY principle."
}
```

### Plan Object

```json
{
  "task_id": "task-20240417-001",
  "steps": [
    {
      "step_number": 1,
      "description": "Create error handling middleware module",
      "files": ["src/middleware/error-handler.ts"],
      "estimated_time": "5 minutes",
      "dependencies": []
    },
    {
      "step_number": 2,
      "description": "Integrate middleware into Express app",
      "files": ["src/app.ts"],
      "estimated_time": "3 minutes",
      "dependencies": ["step-1"]
    }
  ],
  "estimated_total_time": "25 minutes",
  "estimated_total_steps": 6,
  "architectural_decisions_needed": 1,
  "research_recommended": false
}
```

---

## State Validation

Synaphex validates task state transitions to ensure consistency:

### Validation Rules

1. **Step completion tracking** — `completed_steps` must be sequential

   ```
   ✓ Valid: [1, 2, 3]
   ✗ Invalid: [1, 3] (missing 2)
   ✗ Invalid: [2, 1] (wrong order)
   ```

2. **State consistency** — State must match artifacts

   ```
   ✓ Valid: state=PLANNED + plan.md exists
   ✗ Invalid: state=PLANNED + no plan.md
   ```

3. **Timestamp ordering** — Timestamps must move forward

   ```
   ✓ Valid: created < examined < planned < implemented
   ✗ Invalid: created > examined
   ```

4. **Escalation resolution** — Open escalations prevent completion

   ```
   ✓ Valid: all escalations answered before COMPLETE
   ✗ Invalid: COMPLETE state with unanswered escalations
   ```

---

## Question Markers

Synaphex detects questions in code using markers:

```typescript
// Question marker types:

// [?] IDEA: What if we...
// Treated as low-priority suggestion

// [?] QUESTION: Should we...
// Requires architect input, pauses implementation

// [?] BUG: Does this handle...
// Treated as blocker, requires investigation

// [?] REVIEW: Is this following...
// Reviewer will evaluate this point
```

Synaphex scans generated code for these markers and:

1. Identifies which ones need escalation
2. Groups by type (idea, question, bug, review)
3. Either escalates to user or reviewer for evaluation

---

## Integration Points

### With IDE Plugins

The IDE plugin communicates with Synaphex via:

- **Commands** — `/synaphex:task-create`, `/synaphex:task-continue`
- **Status** — Real-time progress updates
- **Feedback** — User approvals, escalation responses
- **Files** — Task artifacts saved to `.synaphex/tasks/`

### With Project Memory

Every task:

1. Reads initial memory
2. Examines codebase against memory
3. Updates memory if patterns found
4. Saves decision rationale to memory
5. Next task loads updated memory

### With External Memory

Child projects:

1. Reference parent memory via symlinks
2. Inherit conventions and patterns
3. Maintain consistency across projects
4. Child updates only affect child project

---

## Performance Considerations

### File Size Limits

- **Max file to read**: 100KB (truncated if larger)
- **Max search results**: 50 results from grep
- **Max list results**: 200 files from find
- **Analysis token limit**: 4000 tokens for compact analysis

### Caching Strategy

- Project memory loaded once per session
- External memory symlinks checked at task start
- File reads cached by Examiner
- Search results memoized within single task

### Scalability

Works efficiently with:

- **Small projects**: < 1000 files (typical task: 5-15 min)
- **Medium projects**: 1000-10000 files (typical task: 15-30 min)
- **Large projects**: 10000+ files (typical task: 30-60 min)

For very large codebases, consider:

- Filtering to relevant directories
- Using `.synaphexignore` to exclude paths
- Creating separate Synaphex projects per service

---

For more details, see:

- [HOW-TO-GUIDE.md](HOW-TO-GUIDE.md) — Task-based documentation
- [EXAMPLES.md](EXAMPLES.md) — Real-world workflows
- [CLI-REFERENCE.md](CLI-REFERENCE.md) — All commands
