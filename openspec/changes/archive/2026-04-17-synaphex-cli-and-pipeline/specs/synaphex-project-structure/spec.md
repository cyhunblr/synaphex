## ADDED Requirements

### Requirement: Global `.synaphex/` project directory

The system SHALL organize all Synaphex projects in a central `.synaphex/` directory. Each project is a subdirectory under `.synaphex/` containing `settings.json` and a `memory/` directory.

#### Scenario: Project directory structure

- **WHEN** `/synaphex/create myproject` is executed

- **THEN** directory structure is created as:

  ```
  .synaphex/
  └── myproject/
      ├── settings.json
      └── memory/
          ├── internal/
          └── external/
  ```

#### Scenario: Multiple projects coexist

- **WHEN** user creates multiple projects (e.g., `myproject`, `another-project`)

- **THEN** each project has its own subdirectory under `.synaphex/`

- **AND** projects are isolated from each other

### Requirement: Project-level `settings.json`

Each project SHALL have a `settings.json` file containing agent configurations. This file is the single source of truth for project-specific settings and can only be modified via `/synaphex/settings <project>`.

#### Scenario: Default settings on project creation

- **WHEN** a new project is created

- **THEN** `settings.json` is initialized with default agent configurations

- **AND** default config includes all 6 agents (Examiner, Researcher, Planner, Coder, Answerer, Reviewer) with sensible defaults

#### Scenario: Settings structure

- **WHEN** settings are configured

- **THEN** `settings.json` contains:

  ```json
  {
    "agents": {
      "examiner": { "provider": "claude", "model": "...", "think": false, "effort": 0 },
      "researcher": { ... },
      "planner": { ... },
      "coder": { ... },
      "answerer": { ... },
      "reviewer": { ... }
    }
  }
  ```

### Requirement: Per-project memory directories

Each project SHALL have a `memory/` directory with two subdirectories: `internal/` (editable memory) and `external/` (linked memory from other projects). Memory is stored as Markdown files organized by topic.

#### Scenario: Memory directory structure

- **WHEN** a project is created or memorized

- **THEN** `memory/internal/` contains topic-based Markdown files (e.g., `architecture.md`, `api.md`, `security.md`)

- **AND** `memory/external/` is initially empty

- **AND** `memory/external/` receives symlinked memory from other projects via `/synaphex/remember`

#### Scenario: Memory organization by topic

- **WHEN** `/synaphex/memorize` analyzes a project

- **THEN** memory files are organized by logical topic (e.g., by module, concern, or technology)

- **AND** each file is focused and maintainable

#### Scenario: Task-specific memory directory

- **WHEN** a task pipeline runs

- **THEN** Examiner creates `memory/internal/task_sentence/` subdirectory

- **AND** saves `task_sentence.md` (full context) and `task_sentence_compact.md` (condensed)

- **AND** research findings (if saved) go to `memory/internal/research/<topic>.md`

### Requirement: Project naming conventions

Project names SHALL be valid directory names (alphanumeric, hyphens, underscores, no spaces). Project names become part of symlink names in external memory.

#### Scenario: Valid project name

- **WHEN** user creates `/synaphex/create my-project`

- **THEN** project is created as `.synaphex/my-project/`

#### Scenario: Invalid project name

- **WHEN** user creates `/synaphex/create "my project"` (with space)

- **THEN** system rejects the name and suggests a valid alternative: `my-project`
