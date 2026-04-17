## Context

Synaphex is a Claude Code plugin architecture for multi-agent task orchestration, building on [OpenSpec](https://github.com/Fission-AI/OpenSpec)'s spec-driven development (SDD) principles. Phase 1 established the skill infrastructure; Phase 2 requires CLI commands, project management, configurable agent pipelines, and memory organization.

Like OpenSpec, which emphasizes "agree on what to build before code is written," Synaphex adopts specification-driven task execution where Examiner, Researcher, and Planner establish a knowledge base and plan before Coder implements. Users need to manage multiple projects with different agent configurations and cross-project memory linking. Memory files should be Markdown-based (except `settings.json`) and organized by topic to keep individual files focused—mirroring OpenSpec's iterative artifact workflow.

## Goals / Non-Goals

**Goals:**

- Implement 7 CLI commands that manage projects, settings, and invoke agent pipelines

- Design project structure with isolated `settings.json` and topic-based Markdown memory

- Orchestrate 6-agent pipeline with optional Researcher and Reviewer stages

- Enable cross-project memory linking via symlinks in `memory/external/`

- Provide agent capability matrix (model-aware constraints on `effort` and `think`)

- Create compact context summaries for Coder to reduce token consumption

**Non-Goals:**

- Remote project storage or cloud sync (projects are local to `.synaphex/`)

- Real-time collaboration on shared projects

- Memory version control (rely on git for history)

- Automatic memory archival or cleanup

- Non-Claude provider integration (Phase 2 is Claude-only)

## Decisions

### 1. Project Root: `.synaphex/` Directory

**Decision**: Store all projects in a global `.synaphex/` directory (e.g., `~/.synaphex/` or project-local `.synaphex/`).

- **Why**: Centralized location, discoverable, easy to backup and manage all projects in one place

- **Alternatives**: Store projects in a scattered fashion (rejected: harder to manage); use XDG directories (rejected: overcomplicates setup)

- **Implication**: Each project is `{.synaphex}/{project-name}/` with `settings.json` and `memory/` inside

### 2. Settings Isolation: JSON Only

**Decision**: Configuration stored exclusively in `settings.json`, not Markdown. Markdown reserved for memory only.

- **Why**: JSON is structured, enables validation and programmatic updates; Markdown is human-friendly for memory. Clear separation of concerns.

- **Alternatives**: YAML config files (rejected: less structured); all Markdown (rejected: settings need validation and typing)

- **Implication**: `/synaphex/settings` is the only way to update config; users cannot edit `settings.json` directly

### 3. Memory Organization: Topic-Based Files

**Decision**: Memory stored as multiple Markdown files organized by topic (e.g., `architecture.md`, `dependencies.md`) rather than one monolithic file.

- **Why**: Respects user's constraint that single files become too large; allows focused edits; enables cross-linking by topic

- **Alternatives**: Single large file (rejected: too unwieldy); database (rejected: violates Markdown-first constraint)

- **Implication**: Examiner must decide what topics to create/update based on task context; memory structure grows organically

### 4. Memory Directories: Internal vs. External

**Decision**: Split memory into `memory/internal/` (editable) and `memory/external/` (linked).

- **Why**: Internal = project-owned context; External = referenced context from other projects. Users update internal, link external.

- **Implication**: `/synaphex/remember` creates symlinks from parent's `memory/internal/` into child's `memory/external/{parent-name}_memory/`

### 5. Context Compaction by Examiner

**Decision**: Examiner reads full project context and creates both full (`task_sentence.md`) and compact (`task_sentence_compact.md`) summaries in `memory/internal/task_sentence/`.

- **Why**: Full version preserves detail for reference; compact version fits in Coder's context window, reducing token cost

- **Alternatives**: Coder does its own filtering (rejected: Coder shouldn't be distracted); no compaction (rejected: wastes tokens)

- **Implication**: Examiner is context-aware and must summarize intelligently per task

### 6. Agent Capability Matrix

**Decision**: Model capabilities defined by provider/model pair. Haiku 4.5 has `effort=0` (no extended thinking); Opus 4.6 supports `effort=1-4` and `think=true`.

- **Why**: Different models have different capabilities; settings validation must reject unsupported combos

- **Alternatives**: Feature flags (rejected: less transparent); runtime fallback (rejected: silent degradation is bad)

- **Implication**: Settings validation must enforce constraints; user chooses model, effort and think are auto-clamped or rejected

### 7. Pipeline Loop: Reviewer → Planner

**Decision**: If Reviewer finds issues, feedback goes to Planner (not back to Examiner). Planner re-plans, then Coder → Answerer → Reviewer loop.

- **Why**: Preserves Examiner's context; avoids re-reading codebase; Planner adjusts strategy based on feedback

- **Alternatives**: Full restart from Examiner (rejected: wasteful); Reviewer auto-fixes (rejected: not Reviewer's role)

- **Implication**: Planner must be ready to receive both initial and feedback-driven requests

### 8. Researcher as Optional Stage

**Decision**: User controls whether Researcher runs via prompt. Researcher can save findings to `memory/internal/research/` or discard.

- **Why**: Not all tasks need research; user controls token spend; saves findings only if useful

- **Alternatives**: Always run Researcher (rejected: wastes tokens); never offer Researcher (rejected: misses research opportunities)

- **Implication**: Pipeline branching logic; Researcher output is not mandatory for downstream agents

### 9. Fix Pipeline: Researcher Disabled

**Decision**: `/synaphex/fix` is identical to `/synaphex/task` but Researcher is pre-disabled.

- **Why**: Quick fixes don't need research; saves tokens; signals intent

- **Alternatives**: Configuration flag (rejected: same outcome, less explicit); separate code path (rejected: duplicates logic)

- **Implication**: `task` command has researcher prompt; `fix` command skips it

## Risks / Trade-offs

| Risk                                                    | Mitigation                                                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Large memory files become unmaintainable**            | Topic-based organization + user discipline. If a topic grows, encourage Examiner to split it.                            |
| **Symlinks break if parent project moved**              | Document the limitation; provide repair script to re-link if needed.                                                     |
| **Agent misconfiguration due to capability mismatches** | Build validation layer in `/synaphex/settings` that prevents invalid model/effort/think combos.                          |
| **Reviewer loop causes infinite feedback**              | Implement loop counter (max 3 iterations). After max loops, ask user for manual intervention.                            |
| **Context window overflow despite compaction**          | Examiner can create multiple task subtasks in `memory/internal/task_sentence/` (e.g., `task_part1.md`, `task_part2.md`). |
| **Coder needs to query Answerer multiple times**        | Answerer is stateless per question; Coder must provide full context in each query. This is acceptable.                   |

## Migration Plan

1. **Phase 2a (CLI & Project Structure)**: Implement `/synaphex/create`, `/synaphex/load`, `/synaphex/settings` with basic validation
2. **Phase 2b (Memory)**: Add `/synaphex/memorize` and `/synaphex/remember` with symlink logic
3. **Phase 2c (Examiner Agent)**: Build Examiner to read project context, create memory, produce compact summaries
4. **Phase 2d (Pipeline Orchestration)**: Implement Researcher, Planner, Coder, Answerer, Reviewer agents + pipeline routing
5. **Phase 2e (Fix Pipeline)**: Add `/synaphex/fix` as fast path variant

No rollback needed for Phase 1 skills; Phase 2 is additive.

## OpenSpec Alignment

Synaphex Phase 2 adopts [OpenSpec](https://github.com/Fission-AI/OpenSpec)'s core principles:

- **Specification-Driven**: Before Coder implements, Examiner gathers context, Researcher finds solutions, Planner creates a detailed plan. This mirrors OpenSpec's pre-implementation agreement phase.

- **Artifact Organization**: Like OpenSpec's proposal/design/specs/tasks structure, Synaphex organizes project knowledge into memory files (topics) and task summaries, enabling iterative refinement.

- **Markdown-First Documentation**: Both use Markdown for specifications and context (except JSON config), keeping documentation readable and git-trackable.

- **Agent as AI Coding Assistant**: Just as OpenSpec works with AI assistants like Claude, Synaphex orchestrates Claude agents as implementation partners, respecting their capabilities and constraints.

- **Flexible Iteration**: Both allow updating artifacts at any time. Synaphex memory can be updated via `/synaphex/memorize` and specs refined via agent feedback.

## Open Questions

1. **Memory topic structure**: Should Examiner auto-detect topics (e.g., parse codebase for module names) or ask user? Suggest: auto-detect for common patterns (config, API, test), ask for custom topics.
2. **Model fallback**: If a requested model is unavailable, should we auto-substitute (e.g., Sonnet instead of Opus) or fail hard? Suggest: fail hard with clear error message.
3. **Symlink target**: For `/synaphex/remember`, should symlinks point to `memory/internal/` directly or to a `_memory` wrapper directory? User specifies: wrapper directory named `{parent_project}_memory`.
4. **Effort scaling**: Is effort 0-4 universal across Claude models that support it, or does it vary? Assume: 0-4 is standard; validate per model in capability matrix.
