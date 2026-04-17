## Context

Synaphex v1.7.0 has working agents and CLI infrastructure but suffers from architectural drift: the system was designed around automated orchestration (one command chains all agents) but implemented as separate CLI commands. This created:

- Confusing naming (task-implement doesn't convey "Coder agent")
- Missing agents (Researcher, Answerer never completed)
- No state validation (can call task-coder before task-examine)
- Code redundancy (~500 LOC in file-tools.ts, memory-scaffold.ts)
- Unclear user workflow (which command is next?)

The actual use case is **user-orchestrated**: user calls commands explicitly in sequence with the system enforcing order. This is cleaner, safer, and matches what exists in the codebase.

## Goals / Non-Goals

**Goals:**

- Rename CLI commands to match agent roles (task-implement → task-coder)
- Implement missing agents (Researcher with web search, Answerer with escalation)
- Add state validation (prevent out-of-order execution)
- Consolidate redundant code (~500 LOC reduction)
- Document state machine and task workflow
- Ensure production-grade error handling

**Non-Goals:**

- Automated orchestration (user orchestrates sequence)
- Automatic model switching (future enhancement; document pattern)
- Anthropic API support (IDE models only; future feature)
- New task types or workflow modes

## Decisions

### 1. Task Workflow Order (Enforce Sequentially)

**Decision**: Commands must execute in strict order: task-create → task-remember (opt) → task-examine → task-researcher (opt) → task-planner → task-coder → task-answerer → task-reviewer.

**Why**:

- User clarity: each step has clear input/output expectations
- Safety: prevents data corruption (e.g., task-coder modifying code before task-examine reads it)
- Error prevention: can't run task-planner before task-examine completes

**Implementation**:

- Track `completed_steps: string[]` in task-meta.json
- Each command validates that required prior steps completed before proceeding
- Return error with helpful message: "Cannot run task-planner: task-examine not completed yet"

**Alternatives considered**:

- Allow user to skip steps: rejected (too error-prone; no validation framework needed)
- Flexible ordering: rejected (violates agent dependency model—Planner needs Examiner output)

### 2. Command Naming Convention

**Decision**: Use `task-<role>` naming (task-coder, task-planner, task-reviewer) to make agent role explicit.

**Why**:

- task-implement is unclear (implement what? code? a plan?)
- task-coder is explicit: "run the Coder agent"
- Matches agent file structure: src/agents/coder.ts → task-coder command

**Mapping**:

- task-start → task-create (clearer intent)
- task-plan → task-planner (who does it: the Planner)
- task-implement → task-coder (what role: the Coder)
- task-review → task-reviewer (what role: the Reviewer)
- task-examine → task-examine (keep; Examiner is singular noun)

### 3. Researcher Agent: Web Search + Memory Integration

**Decision**: Researcher agent uses Claude's web search capability. If Researcher finds information missing in project memory (e.g., Triton library docs), it searches, learns, and updates memory/internal/research/{task_slug}/.md files.

**Why**:

- Researcher is optional (user decides when to invoke)
- Reduces manual research burden: "researcher didn't know about Triton, looked it up, now we have docs"
- Decouples research from code—doesn't block on knowledge gaps

**How it works**:

1. User calls `/synaphex:task-researcher project_name task_name`
2. Researcher reads task context + existing memory
3. Identifies knowledge gaps ("don't know Triton well")
4. Performs web search on gaps
5. Writes findings to memory/internal/research/triton-library.md (or updates if exists)
6. Returns summary

**Tool**: Claude's `web_search` via Messages API (no MCP needed)

### 4. Answerer Agent: Question Answering + Escalation

**Decision**: Answerer reads Coder's embedded questions (in code comments or special markers), answers what it can, escalates architectural decisions to user, and pauses for user input.

**Why**:

- Coder writes code with embedded notes: "TODO: how should we handle concurrency?"
- Answerer reads notes, provides answers
- For architectural questions: Answerer pauses and asks user for clarification
- After clarification: user triggers Planner to re-plan if refactor needed

**How it works**:

1. User calls `/synaphex:task-coder project_name task_name` (Coder writes code with embedded questions)
2. User calls `/synaphex:task-answerer project_name task_name`
3. Answerer reads code, finds question markers
4. Answerer answers technical questions independently
5. For architectural questions: Answerer pauses, outputs clarification request
6. System waits for user input in task-meta.json (new field: `answerer_escalation`)
7. User updates task-meta.json with clarification
8. User (optionally) calls `/synaphex:task-planner project_name task_name` to re-plan based on clarification

**Escalation Detection**: Answers starting with "This is an architectural decision..." or "This requires team consensus..."

### 5. State Validation: completed_steps Array

**Decision**: Track completed task steps in task-meta.json as `completed_steps: string[]`. Each command appends its name when done.

```json
{
  "project": "myproject",
  "slug": "add-feature-2026-04-17",
  "task": "add user authentication",
  "mode": "task",
  "createdAt": "2026-04-17T12:00:00Z",
  "iteration": 1,
  "status": "examining",
  "completed_steps": ["create", "remember"],
  "answerer_escalation": null
}
```

**Why**: Simple, auditable, human-readable

**Validation logic** (pseudocode):

```
required_steps = ["create", "examine", "planner", "coder"]
optional_steps = ["remember", "researcher", "answerer", "reviewer"]

if command not in (required_steps + optional_steps):
  error "Unknown step"

if command in required_steps and required_steps_before not completed:
  error "Cannot run X: Y not completed yet"

if command in optional_steps and required_step_before not completed:
  error "Cannot run X: required step Y not completed"
```

### 6. Code Cleanup: Consolidate Redundant Files

**Decision**: Remove file-tools.ts, memory-scaffold.ts, write-memory.ts; consolidate their logic into agents and command handlers.

**Why**:

- file-tools.ts (read_file, list_files, search_code) are Examiner's tools—move into agents/examiner.ts
- memory-scaffold.ts (default memory structure) belongs in create.ts and memorize.ts
- write-memory.ts (standalone command) should be agent-internal; remove MCP exposure

**Result**: Reduce src/ from 27 files to ~20; consolidate ~500 LOC

### 7. Task Metadata Structure Changes

**Decision**: Add new fields to TaskMeta:

- `completed_steps: string[]` — track progress
- `answerer_escalation: { question: string; options: string[] } | null` — pause for user input

**Why**: Enables state validation and Answerer escalation without side files

## Risks / Trade-offs

| Risk                                                                                                       | Mitigation                                                                              |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Breaking change**: Renaming task-implement → task-coder breaks existing docs/workflows                   | Document migration path; update all examples; version as v2.0.0                         |
| **State validation too strict**: User accidentally skips optional step (e.g., researcher) and gets blocked | State machine allows skipping optional steps; only blocks required steps                |
| **Researcher doesn't know what to search**: Model decides what to research—may miss topics                 | Document expected behavior; user can manually add memory if Researcher misses something |
| **Answerer escalation unclear**: User doesn't understand what "architectural decision" means               | Provide clear escalation examples in docs; Answerer explains why it's escalating        |
| **Performance**: Researcher runs web search—could be slow                                                  | Document expected wait time; user decides whether to invoke Researcher                  |
| **Codebase complexity during refactor**: Renaming + consolidating 27 files is risky                        | Use git branches; refactor one command at a time; test each before merging              |

## Migration Plan

### Phase 3.1: Prepare (Week 1)

1. Branch: `phase-3-refactor`
2. Update src/lib/pipeline-types.ts: Add `completed_steps` and `answerer_escalation` fields to TaskMeta
3. Update src/lib/project-store.ts: Helper functions for state validation
4. Create src/agents/researcher.ts (stub)
5. Create src/agents/answerer.ts (stub)

### Phase 3.2: Consolidate (Week 2)

1. Move file-tools.ts tools into agents/examiner.ts
2. Merge memory-scaffold.ts into src/commands/create.ts and src/commands/memorize.ts
3. Remove write-memory.ts; integrate its logic into agent commands
4. Update src/index.ts: remove write_memory tool

### Phase 3.3: Rename Commands (Week 3)

1. Rename src/commands/task-plan.ts → task-planner.ts
2. Rename src/commands/task-implement.ts → task-coder.ts
3. Rename src/commands/task-review.ts → task-reviewer.ts
4. Rename src/commands/task-start.ts → task-create.ts
5. Create src/commands/task-researcher.ts
6. Create src/commands/task-answerer.ts
7. Create src/commands/task-remember.ts
8. Update src/index.ts: register new tool names and deprecate old ones (with warnings)

### Phase 3.4: Implement Agents (Week 4)

1. Implement Researcher agent with web search
2. Implement Answerer agent with escalation logic
3. Add state validation to all task-\* commands

### Phase 3.5: Document & Test (Week 5)

1. State machine diagram
2. CLI reference guide
3. Error handling guide
4. Integration tests for state validation

**Rollback Strategy**:

- Keep old command names in index.ts with deprecation warnings during transition
- If critical issue: revert branch, release v1.7.1 patch
- No database migration (state stored in JSON files)

## Open Questions (RESOLVED)

### Model Switching: Solved via Subagent Frontmatter

**Question**: Can Claude Code Extension auto-switch models at runtime?

**Answer**: No API call exists for mid-session model switching. However, the actual need is solved via Claude Code's **subagent frontmatter** mechanism:

Each task agent (task-coder, task-planner, task-answerer, etc.) becomes a `.claude/agents/task-*.md` subagent with model pinned in YAML frontmatter:

```yaml
---
name: task-coder
description: Implements code changes based on plan
tools: Read, Write, Edit, Bash
model: haiku
---
You are the Coder agent...
```

When the orchestrator invokes `@agent-task-coder`, Claude Code spins up a subagent with the model from its own frontmatter. This means model switching happens automatically as a side effect of the workflow sequence.

**Implementation approach**:

1. Generate `.claude/agents/task-*.md` files from project `settings.json` at build time or plugin activation
2. Orchestrator calls agents via subagent invocation (@agent-task-coder, @agent-task-planner, etc.)
3. Each subagent runs with its configured model automatically

**Caveats**:

- Tool call can override frontmatter model (~30% leak-through risk when parent Opus calls child Sonnet)
- Built-in agents (Explore, Plan) are hardcoded; can't override them—must write custom agents
- CLAUDE_CODE_SUBAGENT_MODEL is read at process start, not runtime

### Researcher Memory Output: Task-Local Directory

**Question**: Where should Researcher save findings?

**Answer**: Inside task directory as `researcher.md`. Planner checks if it exists before planning; if yes, uses it as context; if no, proceeds normally (Researcher is optional).

### Coder Question Markers: Comment-Based

**Question**: What syntax for embedded questions?

**Answer**: Use comment-based markers per language:

```
# SYNAPHEX_QUESTION: how should we handle concurrency?
# SYNAPHEX_ARCHITECTURAL: should we use singleton pattern?
```

(Language-agnostic; Answerer parses regardless of comment style)

### Backward Compatibility: Remove

**Answer**: Full breaking change (v2.0.0). Remove old command names entirely (task-implement, task-plan, task-review, task-start). No aliases.

### Test Coverage: Critical & Integration

- State validation (critical)
- Agent integration tests (Researcher, Answerer, Reviewer)
- Full workflow e2e tests
- Edge case tests (corrupted metadata, missing files)
