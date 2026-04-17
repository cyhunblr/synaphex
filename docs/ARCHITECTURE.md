# System Architecture

Technical overview of Synaphex v2.0.0 design and implementation.

## Agent Pipeline

Synaphex uses an 8-agent pipeline to implement tasks end-to-end.

### Agent Sequence

```
Task Definition
  ↓
1. EXAMINER (required) — reads project code and memory
  ↓
2. RESEARCHER (optional) — researches unfamiliar technologies
  ↓
3. PLANNER (required) — creates implementation plan
  ↓
4. CODER (required) — writes code
  ↓
5. ANSWERER (required) — answers questions
  ↓
6. REVIEWER (optional) — reviews implementation
  ↓
COMPLETED or FEEDBACK LOOP
```

### Agent Roles

| Agent          | Role                             | Required? |
| -------------- | -------------------------------- | --------- |
| **Examiner**   | Reads project context and memory | Yes       |
| **Researcher** | Researches tech (web search)     | No        |
| **Planner**    | Creates implementation plan      | Yes       |
| **Coder**      | Writes code and tests            | Yes       |
| **Answerer**   | Answers technical questions      | Yes       |
| **Reviewer**   | Reviews code quality             | No        |

---

## State Machine

Tasks follow a strict state machine with required steps and order constraints.

### State Requirements

**Required steps** (must run in order):

1. `create` — Create project
2. `examine` — Read codebase and memory
3. `planner` — Plan implementation
4. `coder` — Write code
5. `answerer` — Handle questions

**Optional steps** (can be skipped or run conditionally):

- `remember` — Link parent project memory (before examine)
- `researcher` — Research technology (before planner)
- `reviewer` — Review code (after answerer)

### State Transitions

Tasks cannot skip required steps or run steps out of order. If reviewer feedback requires changes, task increments `iteration` counter and returns to planner.

**Example**: Iteration 1 → Iteration 2

```
Iteration 1: examine → planner → coder → answerer → reviewer (feedback)
Iteration 2: (return to planner) → planner → coder → answerer → reviewer (approval)
```

---

## Memory System

Projects store knowledge in organized markdown files under `~/.synaphex/project-name/memory/`

### Directory Structure

```
memory/
├── internal/                 # Project-specific knowledge
│   ├── overview.md          # Project purpose
│   ├── architecture.md       # System design
│   ├── conventions.md        # Code style guide
│   ├── security.md          # Security model
│   ├── research/            # Research findings
│   │   └── topic-name.md
│   ├── packages/            # Code analysis
│   └── tasks/               # Per-task working files
│       └── task-slug/
│           ├── plan.md
│           ├── implementation.md
│           └── task-meta.json
│
└── external/                # Inherited from other projects
    └── parent-project_memory -> symlink to parent/internal/
```

### How Agents Use Memory

- **Examiner**: Reads all memory, creates examination summary
- **Researcher**: Reads memory, writes to `research/` directory
- **Planner**: Reads all memory, writes plans to `tasks/slug/`
- **Coder**: Reads all memory, writes implementation to `tasks/slug/`
- **Answerer**: Reads all memory, writes escalations to `tasks/slug/task-meta.json`
- **Reviewer**: Reads all memory, writes review to `tasks/slug/review.md`

---

## Question Escalation

Coder can embed special markers when it needs user decisions on architectural questions.

### Technical Question

Marker: `SYNAPHEX_QUESTION`

Used when Coder needs a recommendation (Answerer handles it):

```
<!-- SYNAPHEX_QUESTION -->
Should we use bcrypt or Argon2 for password hashing?
<!-- /SYNAPHEX_QUESTION -->
```

Answerer responds with recommendation based on existing code patterns.

### Architectural Question

Marker: `SYNAPHEX_ARCHITECTURAL`

Used when Coder needs user decision (escalates to user):

```
<!-- SYNAPHEX_ARCHITECTURAL -->
Should we use WebSocket (low latency, complex)
or SSE (simple, high latency) for real-time delivery?
<!-- /SYNAPHEX_ARCHITECTURAL -->
```

Answerer shows user both options and waits for decision.

### Decision Storage

User decision saved in `task-meta.json`:

```json
{
  "answerer_escalation": [
    {
      "question": "Should we use WebSocket or SSE?",
      "decision": "WebSocket",
      "timestamp": "2026-04-18T12:34:56Z"
    }
  ]
}
```

Re-planning (iteration 2) uses this decision.

---

## Data Structures

### Project Metadata (meta.json)

```json
{
  "name": "my-project",
  "createdAt": "2026-04-18T00:00:00Z",
  "lastMemorizeAt": "2026-04-18T10:30:00Z",
  "lastMemorizeSourcePath": "/home/user/projects/my-codebase",
  "memorizeContentHash": "sha256:abc123..."
}
```

### Task State (task-meta.json)

```json
{
  "slug": "add-password-reset",
  "status": "completed",
  "iteration": 1,
  "completed_steps": [
    "create",
    "examine",
    "planner",
    "coder",
    "answerer",
    "reviewer"
  ],
  "answerer_escalation": []
}
```

### Agent Configuration (settings.json)

```json
{
  "examiner": {
    "provider": "anthropic",
    "model": "claude-opus-4-7",
    "think": true,
    "effort": 4
  },
  "coder": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5",
    "think": false,
    "effort": 0
  }
}
```

---

## State Validation

Tasks must follow state machine rules. Validation prevents invalid task execution.

### Rules

1. **Required steps must run in order**
   - Cannot run `coder` before `planner` completes
   - Cannot run `planner` before `examine` completes

2. **No step can run twice** (unless re-planning)
   - Same step name cannot appear twice in `completed_steps` array
   - Exception: when `iteration` counter increments, can re-run

3. **Optional steps check dependencies**
   - `remember` requires `create` to be complete
   - `researcher` requires `examine` to be complete
   - `reviewer` requires `answerer` to be complete

---

## Question Markers (Regex)

Answerer detects questions using this regex pattern:

```regex
/<!--\s*SYNAPHEX_(QUESTION|ARCHITECTURAL)\s*\n(.*?)\n\s*\/SYNAPHEX_\1\s*-->/s
```

Matches:

- Opening: `<!--`
- Marker type: `QUESTION` or `ARCHITECTURAL`
- Question text (multiline)
- Closing: `/SYNAPHEX_<TYPE> -->`

---

## Next Steps

- **Quick Start**: See [Getting Started](./GETTING-STARTED.md)
- **Examples**: See [Real-World Examples](./EXAMPLES.md)
- **How-To**: See [How-To Guide](./HOW-TO-GUIDE.md)
- **Installation**: See [Installation Guide](./INSTALLATION.md)
