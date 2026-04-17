## ADDED Requirements

### Requirement: Task creation and initialization
The system SHALL provide `/synaphex:task-create <project_name> <task_name>` command that initializes a new task with metadata, an empty completed_steps array, and initial status "created".

#### Scenario: Create new task successfully
- **WHEN** user runs `/synaphex:task-create myproject "add authentication"`
- **THEN** system creates task directory in `~/.synaphex/myproject/tasks/<slug>/` with task-meta.json
- **AND** task-meta.json contains: project, slug, task, mode, createdAt, iteration, status: "created", completed_steps: ["create"], answerer_escalation: null

#### Scenario: Task slug generation
- **WHEN** task is created with name "add user authentication"
- **THEN** slug is generated as URL-safe: "add-user-authentication-<timestamp>" to handle duplicates

### Requirement: Task workflow commands execute in sequence
The system SHALL enforce strict ordering: task-examine and required subsequent steps cannot run until prior required steps complete. Optional steps can be skipped.

**Required sequence**: create → examine → planner → coder → answerer → reviewer  
**Optional steps**: remember (before examine), researcher (after examine)

#### Scenario: Valid sequence execution
- **WHEN** user runs `/synaphex:task-examine myproject add-user-authentication` after task-create
- **THEN** system permits execution
- **AND** appends "examine" to completed_steps
- **AND** sets status: "examining"

#### Scenario: Out-of-order execution blocked
- **WHEN** user runs `/synaphex:task-coder myproject add-user-authentication` before task-examine completes
- **THEN** system blocks with error: "Cannot run task-coder: task-examine not completed yet. Run in order: create → examine → planner → coder → answerer → reviewer"

#### Scenario: Optional step skipped
- **WHEN** user runs `/synaphex:task-planner myproject add-user-authentication` without running task-researcher
- **THEN** system permits execution (researcher is optional)
- **AND** task proceeds normally

### Requirement: Task examine command
The system SHALL provide `/synaphex:task-examine <project_name> <task_name>` that runs Examiner agent to analyze code and create raw + compact analysis.

#### Scenario: Examine code and produce analysis
- **WHEN** user runs `/synaphex:task-examine myproject add-user-authentication`
- **THEN** Examiner reads codebase and memory
- **AND** produces two outputs: examiner-raw.md (full context) and examiner-compact.md (condensed)
- **AND** appends "examine" to completed_steps
- **AND** sets status: "examined"

### Requirement: Task remember command (optional, before examine)
The system SHALL provide `/synaphex:task-remember <remembered_project> <project_name>` to link memory from another project before task examination begins.

#### Scenario: Remember parent memory before examination
- **WHEN** user runs `/synaphex:task-remember parent-proj myproject` before task-examine
- **THEN** system creates symlink: `~/.synaphex/myproject/memory/external/parent-proj_memory/ → parent-proj/memory/internal/`
- **AND** appends "remember" to completed_steps
- **AND** Examiner will read linked memory in subsequent step

### Requirement: Task planner command
The system SHALL provide `/synaphex:task-planner <project_name> <task_name>` that runs Planner agent to create implementation plan from Examiner output.

#### Scenario: Create implementation plan
- **WHEN** user runs `/synaphex:task-planner myproject add-user-authentication` after examine completes
- **THEN** Planner reads examiner-compact.md
- **AND** produces plan.md with structured steps
- **AND** appends "planner" to completed_steps
- **AND** returns plan for user review

### Requirement: Task coder command
The system SHALL provide `/synaphex:task-coder <project_name> <task_name>` that runs Coder agent to implement code according to plan, embedding questions/notes for Answerer.

#### Scenario: Implement code with embedded questions
- **WHEN** user runs `/synaphex:task-coder myproject add-user-authentication` after planner completes
- **THEN** Coder reads plan.md and examiner output
- **AND** implements code, embedding special markers for questions:
  - `# SYNAPHEX_QUESTION: <question>` for technical questions
  - `# SYNAPHEX_ARCHITECTURAL: <question>` for architectural decisions
- **AND** writes code changes to files
- **AND** appends "coder" to completed_steps
- **AND** returns summary of files created/modified/deleted

### Requirement: Task answerer command
The system SHALL provide `/synaphex:task-answerer <project_name> <task_name>` that runs Answerer agent to address Coder's embedded questions, escalating architectural decisions to user.

#### Scenario: Answerer answers technical questions
- **WHEN** user runs `/synaphex:task-answerer myproject add-user-authentication` after coder completes
- **THEN** Answerer reads implementation with question markers
- **AND** answers technical questions independently
- **AND** returns answers inline with code

#### Scenario: Answerer escalates architectural decision
- **WHEN** Answerer encounters `# SYNAPHEX_ARCHITECTURAL: Should we use singleton pattern?`
- **THEN** Answerer pauses and sets task-meta.answerer_escalation:
  ```json
  {
    "question": "Should we use singleton pattern for database connection?",
    "context": "...",
    "options": ["Yes, singleton is safer", "No, pass connection as parameter"]
  }
  ```
- **AND** system returns escalation prompt to user
- **AND** user updates task-meta.json with their choice
- **AND** system waits (does not automatically continue)

#### Scenario: Planner re-triggered after escalation
- **WHEN** user updates task-meta.answerer_escalation with their decision
- **THEN** user can manually run `/synaphex:task-planner myproject add-user-authentication` to re-plan based on decision
- **AND** Planner reads user's clarification and updates plan
- **AND** workflow can continue to coder again if needed

### Requirement: Task reviewer command
The system SHALL provide `/synaphex:task-reviewer <project_name> <task_name>` that runs Reviewer agent to examine implemented code for correctness and adherence to plan.

#### Scenario: Reviewer approves implementation
- **WHEN** user runs `/synaphex:task-reviewer myproject add-user-authentication` after answerer completes
- **THEN** Reviewer reads code, plan, and examiner context
- **AND** produces verdict: "approved"
- **AND** returns review.md
- **AND** appends "reviewer" to completed_steps
- **AND** sets status: "complete"

#### Scenario: Reviewer finds issues
- **WHEN** Reviewer identifies problems
- **THEN** verdict: "needs_changes"
- **AND** returns detailed feedback
- **AND** user can manually run task-planner again to re-plan
- **AND** iteration counter increments

### Requirement: Task mode and settings context
Each task command SHALL read project settings (agent models, think, effort) and apply them. Commands SHALL use IDE's current model for agent execution (delegated mode only).

#### Scenario: Commands use project settings
- **WHEN** user runs `/synaphex:task-examine myproject task_name`
- **THEN** system reads `~/.synaphex/myproject/settings.json`
- **AND** uses Examiner's configured model from settings
- **AND** sets thinking and effort parameters accordingly
