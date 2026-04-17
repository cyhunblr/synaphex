## ADDED Requirements

### Requirement: Quick fix pipeline with Researcher disabled

The system SHALL provide `/synaphex/fix <project> <fix_sentence>` command that executes an identical pipeline to `/synaphex/task` except Researcher is always disabled (never runs). This pipeline is optimized for rapid bug fixes and cost reduction.

#### Scenario: Fix pipeline runs without Researcher

- **WHEN** user runs `/synaphex/fix myproject "fix null pointer exception"`

- **THEN** system executes: Examiner → Planner → Coder → Answerer → [Reviewer if user configured]

- **AND** Researcher stage is skipped entirely

- **AND** system does not prompt about Researcher activation

#### Scenario: Fix pipeline prompts only for Reviewer handling

- **WHEN** fix pipeline starts

- **THEN** system asks only: "How should Reviewer be handled? [user performs review, agent performs review, ask when reached]"

- **AND** no Researcher activation prompt is shown

### Requirement: Fix pipeline reuses existing project memory

The Examiner in a fix pipeline SHALL read existing memory files from `memory/internal/` to provide quick context without re-analyzing the entire codebase. This enables rapid problem diagnosis.

#### Scenario: Examiner uses existing memory for quick context

- **WHEN** Examiner runs in a fix pipeline

- **THEN** Examiner prioritizes existing memory files in `memory/internal/`

- **AND** Examiner only reads relevant codebase sections based on the fix sentence

- **AND** Examiner compiles a focused knowledge base for the specific bug

#### Scenario: Compact context for quick fix

- **WHEN** Examiner creates task summary for fix

- **THEN** compact summary (`task_sentence_compact.md`) emphasizes affected code and prior fixes

- **AND** context is minimal but sufficient for targeted fix
