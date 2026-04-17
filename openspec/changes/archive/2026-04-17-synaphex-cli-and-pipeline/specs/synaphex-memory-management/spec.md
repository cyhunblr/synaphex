## ADDED Requirements

**OpenSpec Context**: Like [OpenSpec](https://github.com/Fission-AI/OpenSpec)'s proposal/design/specs/tasks artifact structure, Synaphex organizes project knowledge as topic-based Markdown files. Memory becomes a living specification of the project, updated as understanding evolves through tasks.

### Requirement: Topic-based internal memory organization
The system SHALL organize memory files in `memory/internal/` by topic (e.g., `architecture.md`, `api.md`, `security.md`, `dependencies.md`). Each memory file is a standalone Markdown document focused on a specific concern or module. Memory is updated by Examiner or users as needed.

#### Scenario: Memory file creation on first memorize
- **WHEN** `/synaphex/memorize myproject` is run for the first time
- **THEN** system analyzes codebase and creates topic-based Markdown files in `memory/internal/`
- **AND** each file documents a specific aspect (e.g., architecture patterns, API endpoints, security considerations)

#### Scenario: Memory file topics include codebase topics
- **WHEN** analyzing a C++/Python/ROS project as specified (c++, python, ros 1, noetic, security)
- **THEN** memory topics MAY include: `architecture.md`, `cpp-modules.md`, `python-scripts.md`, `ros-nodes.md`, `security-considerations.md`, `dependencies.md`, `noetic-specifics.md`
- **AND** user can customize topic structure based on project needs

#### Scenario: Examiner updates memory during task
- **WHEN** a task pipeline runs and Examiner reads codebase
- **THEN** Examiner MAY update existing memory files or create new ones based on task context
- **AND** updates preserve prior knowledge while adding new insights

### Requirement: External memory as symlinked project memory
The system SHALL organize external memory in `memory/external/` as symlinks to parent projects' `memory/internal/` directories. Each link is named `<parent_project>_memory` and points to the parent's internal memory.

#### Scenario: External memory symlink structure
- **WHEN** `/synaphex/remember parent-proj child-proj` is executed
- **THEN** `child-proj/memory/external/parent-proj_memory/` is created as a symlink
- **AND** symlink points to `parent-proj/memory/internal/`
- **AND** child project can read (but not modify) parent's memory

#### Scenario: Multiple external memory links
- **WHEN** a project links memory from multiple parent projects
- **THEN** `memory/external/` contains multiple symlinks: `parent1_memory/`, `parent2_memory/`, etc.
- **AND** Examiner can read from any external link as needed

#### Scenario: Symlink update on parent memory change
- **WHEN** parent project memory changes and child runs a task
- **THEN** Examiner automatically reads the latest parent memory through the symlink
- **AND** no manual sync is needed

### Requirement: Memory compaction for context window efficiency
The system SHALL support memory compaction by Examiner. Full memory is preserved in `memory/internal/` for reference; compact versions are created per-task for Coder consumption.

#### Scenario: Full vs. compact task memory
- **WHEN** Examiner creates task summary
- **THEN** `memory/internal/task_sentence/task_sentence.md` contains full context
- **AND** `memory/internal/task_sentence/task_sentence_compact.md` contains condensed version
- **AND** Coder uses compact version to stay within context window

#### Scenario: Compact memory prioritization
- **WHEN** Examiner creates compact summary
- **THEN** compact version prioritizes:
  1. Critical architecture decisions relevant to task
  2. API/interface changes needed
  3. Known issues or workarounds
  4. File locations and module organization
  5. Security or compliance constraints

### Requirement: Research findings stored separately
The system SHALL store Researcher findings in `memory/internal/research/` as separate Markdown files. Each finding is saved with a topic name (e.g., `oauth-2-implementation.md`).

#### Scenario: Researcher saves findings
- **WHEN** Researcher completes research and user opts to save
- **THEN** findings are saved to `memory/internal/research/<topic>.md`
- **AND** findings include sources, implementation patterns, and trade-offs

#### Scenario: Discarded research findings
- **WHEN** Researcher finishes but user opts not to save
- **THEN** findings are NOT persisted to memory
- **AND** pipeline continues without storing research output

### Requirement: Task-specific memory isolation
The system SHALL create isolated memory directories for each task to preserve task-specific context. Task memory is stored in `memory/internal/task_sentence/` and NOT polluted with prior task contexts.

#### Scenario: Separate task memory directories
- **WHEN** multiple tasks are run on the same project
- **THEN** each task creates separate `task_sentence.md` and `task_sentence_compact.md` files
- **AND** older task memories are preserved for reference (e.g., timestamped or named by task)
- **AND** each new task uses fresh Examiner analysis

#### Scenario: Memory reuse across tasks
- **WHEN** a new task runs
- **THEN** Examiner reads stable memory from `memory/internal/` (architecture, APIs, etc.)
- **AND** Examiner creates new task-specific memory combining stable + current codebase state
