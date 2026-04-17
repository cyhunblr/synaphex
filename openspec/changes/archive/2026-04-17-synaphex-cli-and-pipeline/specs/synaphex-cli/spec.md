## ADDED Requirements

### Requirement: Create new Synaphex project
The system SHALL provide `/synaphex/create <project>` command that initializes a new project directory under `.synaphex/` with default `settings.json` and empty `memory/` directories. If a project with the same name already exists, the command SHALL throw an error and inform the user to delete it first.

#### Scenario: Create new project successfully
- **WHEN** user runs `/synaphex/create myproject` and `myproject` does not exist
- **THEN** system creates `.synaphex/myproject/` with `settings.json` (default agent config) and `memory/internal/` and `memory/external/` subdirectories

#### Scenario: Create project that already exists
- **WHEN** user runs `/synaphex/create myproject` and `myproject` already exists
- **THEN** system throws error message: "Project 'myproject' already exists. Delete it first or choose a different name."

### Requirement: Load existing Synaphex project
The system SHALL provide `/synaphex/load <project>` command that loads a project from `.synaphex/`, making its `settings.json` and `memory/` available for subsequent commands. If a project does not exist, the command SHALL throw an error and direct the user to create it.

#### Scenario: Load existing project
- **WHEN** user runs `/synaphex/load myproject` and `myproject` exists
- **THEN** system loads the project context (settings and memory) and confirms: "Loaded project 'myproject'"

#### Scenario: Load project that does not exist
- **WHEN** user runs `/synaphex/load myproject` and `myproject` does not exist
- **THEN** system throws error: "Project 'myproject' not found. Create it with `/synaphex/create myproject` first."

### Requirement: Update project settings interactively
The system SHALL provide `/synaphex/settings <project>` command that updates a project's `settings.json` interactively. The user is prompted to configure 6 agents (Examiner, Researcher, Planner, Coder, Answerer, Reviewer), each with `provider`, `model`, `effort`, and `think` options. The system SHALL validate that selected model/effort/think combinations are supported.

#### Scenario: Configure Coder agent
- **WHEN** user runs `/synaphex/settings myproject` and selects Coder
- **THEN** system prompts: Provider [Claude], Model [Haiku 4.5/Sonnet 4.6/Opus 4.6], Think [Yes/No], Effort [0-4 if supported]
- **AND** system validates that Haiku 4.5 cannot use Think=Yes or Effort>0

#### Scenario: Save agent configuration
- **WHEN** user completes agent configuration
- **THEN** system updates `settings.json` with new values and confirms: "Settings saved for project 'myproject'"

### Requirement: Invoke task pipeline
The system SHALL provide `/synaphex/task <project> <task_sentence>` command that starts a multi-agent pipeline. The system SHALL first prompt the user whether to activate Researcher [yes/no], then prompt how to handle Reviewer [user performs review, agent performs review, ask when reached].

#### Scenario: Start task with Researcher enabled
- **WHEN** user runs `/synaphex/task myproject "add authentication to API"`
- **THEN** system asks: "Activate Researcher for this task? [yes/no]"
- **AND** if yes, Researcher is included in the pipeline

#### Scenario: Start task with Reviewer auto-enabled
- **WHEN** user selects Reviewer handling as "agent performs review"
- **THEN** system runs pipeline through Reviewer, and if Reviewer finds issues, loops back to Planner

### Requirement: Invoke quick fix pipeline
The system SHALL provide `/synaphex/fix <project> <fix_sentence>` command that is identical to `/synaphex/task` except Researcher is pre-disabled (skipped entirely). This command is optimized for rapid fixes.

#### Scenario: Quick fix with Researcher disabled
- **WHEN** user runs `/synaphex/fix myproject "fix null pointer exception in handler"`
- **THEN** system runs pipeline with Researcher skipped (Examiner → Planner → Coder → Answerer → Reviewer)
- **AND** system does not prompt about Researcher activation

### Requirement: Initialize or update project memory
The system SHALL provide `/synaphex/memorize <project>` command that creates or updates memory files in `memory/internal/` based on the current codebase. If memory files do not exist, they are created; if they exist, they are updated.

#### Scenario: Memorize new project
- **WHEN** user runs `/synaphex/memorize myproject` and memory files do not exist
- **THEN** system analyzes the codebase and creates initial memory files in `memory/internal/` (e.g., `architecture.md`, `dependencies.md`, `security.md`)

#### Scenario: Update existing memory
- **WHEN** user runs `/synaphex/memorize myproject` and memory files exist
- **THEN** system updates existing memory files with any changes to the codebase

### Requirement: Link external project memory
The system SHALL provide `/synaphex/remember <parent_project> <child_project>` command that creates a symlink from the parent project's `memory/internal/` into the child project's `memory/external/` directory, named `<parent_project>_memory`. If a link already exists, it is updated to reflect the current state of the parent's memory.

#### Scenario: Link parent memory to child project
- **WHEN** user runs `/synaphex/remember parent-proj child-proj`
- **THEN** system creates `child-proj/memory/external/parent-proj_memory/` as a symlink to `parent-proj/memory/internal/`
- **AND** system confirms: "Linked parent-proj memory into child-proj"

#### Scenario: Update existing memory link
- **WHEN** user runs `/synaphex/remember parent-proj child-proj` and link already exists
- **THEN** system updates the existing symlink to point to the current state of parent-proj's memory
