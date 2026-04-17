## ADDED Requirements

### Requirement: Task researcher command with web search

The system SHALL provide `/synaphex:task-researcher <project_name> <task_name>` command that runs Researcher agent to perform web search on topics unknown in project memory and update memory files accordingly.

#### Scenario: Researcher identifies knowledge gaps

- **WHEN** user runs `/synaphex:task-researcher myproject "fix triton error"`

- **THEN** Researcher reads task context and existing memory

- **AND** identifies topics not covered: "Triton library functions, error handling patterns"

- **AND** notes: "memory/internal/ doesn't have detailed Triton docs"

#### Scenario: Researcher performs web search

- **WHEN** Researcher finds knowledge gaps

- **THEN** Researcher performs web search on gaps: "Triton library API, common errors"

- **AND** learns about Triton functions, error messages, workarounds

- **AND** summarizes findings

#### Scenario: Researcher creates or updates memory

- **WHEN** Researcher completes search

- **THEN** Researcher creates/updates memory file: `memory/internal/research/triton-library.md`

- **AND** memory contains: API functions, error patterns, solutions, links

- **AND** if memory file existed, appends new findings (doesn't overwrite)

- **AND** appends "researcher" to completed_steps

- **AND** returns summary of findings

#### Scenario: Researcher used before planning

- **WHEN** user calls task-researcher after task-examine but before task-planner

- **THEN** Researcher findings are available to Planner in subsequent steps

- **AND** Planner can reference newly-learned information

### Requirement: Researcher decides what to search

The Researcher model (Claude) SHALL decide what topics to search based on task context and existing memory, not requiring explicit user direction.

#### Scenario: Researcher autonomous search decisions

- **WHEN** Researcher reads task "debug concurrent database access in Rust"

- **AND** memory has architecture.md but no concurrency patterns

- **THEN** Researcher decides to search: "Rust concurrency patterns, tokio async, database connection pooling"

- **AND** user is not prompted for search topics

### Requirement: Researcher optional step

Task researcher SHALL be optional; user can skip it and proceed directly to task-planner.

#### Scenario: Skip researcher step

- **WHEN** user runs `/synaphex:task-planner myproject task_name` after task-examine without running task-researcher

- **THEN** system permits execution (no research required)
