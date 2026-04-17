## ADDED Requirements

### Requirement: Document task state machine

The system documentation SHALL include a state machine diagram showing valid task step transitions and decision points.

#### Scenario: State machine documentation

- **WHEN** user reads synaphex documentation

- **THEN** state machine diagram shows:
  - Required path: create → examine → planner → coder → answerer → reviewer → complete
  - Optional branches: remember (before examine), researcher (between examine and planner)
  - Escalation pause: answerer_escalation in task-meta.json
  - Re-plan loop: user can call task-planner again after user clarification
  - Visual indication of which steps are optional vs. required

### Requirement: Document CLI command reference

Documentation SHALL provide clear reference for all synaphex commands with usage examples and expected output.

#### Scenario: CLI reference completeness

- **WHEN** user reads CLI reference

- **THEN** it documents:
  - `/synaphex:create <project_name>` — creates project
  - `/synaphex:settings <project_name>` — configure agents
  - `/synaphex:load <project_name>` — load project context
  - `/synaphex:memorize <project_name> <path>` — analyze codebase
  - `/synaphex:remember <parent_project> <project_name>` — link memory
  - `/synaphex:task-create <project_name> <task_name>` — initialize task
  - `/synaphex:task-remember <parent_project> <project_name>` — link memory before task
  - `/synaphex:task-examine <project_name> <task_name>` — analyze code for task
  - `/synaphex:task-researcher <project_name> <task_name>` — web search
  - `/synaphex:task-planner <project_name> <task_name>` — create plan
  - `/synaphex:task-coder <project_name> <task_name>` — implement code
  - `/synaphex:task-answerer <project_name> <task_name>` — answer questions
  - `/synaphex:task-reviewer <project_name> <task_name>` — review code

- **AND** each command includes example usage and output format

### Requirement: Document error handling patterns

Documentation SHALL explain common errors and recovery procedures.

#### Scenario: Error handling guide

- **WHEN** user encounters error

- **THEN** documentation explains:
  - Out-of-order execution: "Cannot run task-X: task-Y not completed yet" → run task-Y first
  - Missing project: "Project 'xyz' not found" → create with /synaphex:create
  - Corrupted task-meta.json: "Invalid task metadata" → delete task dir and restart
  - Model not available: "Model claude-opus-4-6 not available" → switch model in settings
  - Recovery procedures: which files to delete, which steps to re-run

### Requirement: Document Coder question marker syntax

Documentation SHALL explain how Coder embeds questions and how Answerer interprets them.

#### Scenario: Question marker documentation

- **WHEN** user reads developer guide

- **THEN** it documents syntax:

  ```
  # SYNAPHEX_QUESTION: <question>
  /* SYNAPHEX_QUESTION: <question> */
  // SYNAPHEX_QUESTION: <question>
  ```

- **AND** examples:

  ```rust
  // SYNAPHEX_QUESTION: Should we use async/await or blocking calls?
  fn database_query() { }
  ```

- **AND** explains how to embed architectural questions:

  ```rust
  // SYNAPHEX_ARCHITECTURAL: Should database be singleton or DI?
  ```

### Requirement: Document Answerer escalation workflow

Documentation SHALL explain when and how Answerer escalates architectural questions to user.

#### Scenario: Escalation documentation

- **WHEN** user reads workflow guide

- **THEN** it explains:
  1. Answerer encounters architectural question
  2. System pauses and sets answerer_escalation in task-meta.json
  3. User reads question and options
  4. User updates task-meta.json with their decision
  5. User can optionally re-run task-planner to adjust plan
  6. User continues workflow

### Requirement: Document memory organization

Documentation SHALL explain how to create and update memory files for projects.

#### Scenario: Memory organization guide

- **WHEN** user reads memory guide

- **THEN** it explains:
  - memory/internal/: project-owned knowledge, editable
  - memory/external/: linked from other projects, read-only
  - memory/internal/research/: Researcher findings
  - memory/internal/tasks/: task-specific context
  - How to create custom topics (e.g., memory/internal/security.md)
  - Examples of well-organized memory for C++/Python/ROS projects

### Requirement: Document versioning and compatibility

Documentation SHALL note versioning strategy and breaking changes from Phase 1.

#### Scenario: Versioning note

- **WHEN** user reviews documentation

- **THEN** it notes:
  - Phase 1 (v1.x): earlier command names (task-implement, task-plan, task-review)
  - Phase 3 (v2.x): refactored command names (task-coder, task-planner, task-reviewer)
  - Migration guide: mapping old commands to new ones

### Requirement: Produce README updates

The main README.md SHALL be updated to reflect Phase 3 changes.

#### Scenario: README reflects current commands

- **WHEN** user reads README.md

- **THEN** it documents:
  - All 8 task commands in correct order
  - Example workflow walkthrough
  - Link to detailed CLI reference
  - Link to state machine diagram
