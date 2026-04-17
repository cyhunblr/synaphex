## ADDED Requirements

### Requirement: Examiner creates full task memory document
When a task pipeline runs, the Examiner SHALL create a comprehensive memory document capturing all relevant project context, codebase information, linked external memory, and task-specific details. This full document is saved as `memory/internal/task_sentence/task_sentence.md`.

#### Scenario: Examiner gathers full context
- **WHEN** Examiner runs at the start of task pipeline
- **THEN** Examiner reads:
  1. All memory files from `memory/internal/` (architecture, APIs, security, etc.)
  2. All relevant codebase files (modules, APIs, config files)
  3. All linked memory from `memory/external/{parent_project}_memory/`
  4. Task sentence and infer required context

#### Scenario: Full task memory preservation
- **WHEN** Examiner completes gathering
- **THEN** `memory/internal/task_sentence/task_sentence.md` is created containing:
  - Task objective and requirements
  - Relevant architecture from prior memory
  - Codebase structure and key files
  - API contracts and dependencies
  - Security or compliance constraints
  - Known issues or workarounds
  - External memory insights (from parent projects)

#### Scenario: Full memory available for reference
- **WHEN** Coder or other agents need detailed context
- **THEN** they can reference `task_sentence.md` for complete information
- **AND** full memory is not limited by context window constraints

### Requirement: Examiner creates compact task memory document
The Examiner SHALL also create a condensed version of task memory, optimized for inclusion in Coder's context window. This compact document prioritizes critical information and eliminates redundancy.

#### Scenario: Examiner generates compact version
- **WHEN** Examiner finishes full context gathering
- **THEN** Examiner creates `memory/internal/task_sentence/task_sentence_compact.md`
- **AND** compact version:
  1. Highlights only the most critical information
  2. Removes verbosity and explanatory text
  3. Uses concise bullet points and structured format
  4. Includes file paths and code locations for quick reference
  5. Fits within typical model context window (10K-20K tokens estimate)

#### Scenario: Compact memory prioritization strategy
- **WHEN** creating compact version from full memory
- **THEN** Examiner prioritizes in order:
  1. **Critical**: Architecture decisions relevant to this specific task
  2. **Key APIs**: Function signatures and module interfaces to be modified
  3. **Constraints**: Security, compliance, or performance requirements
  4. **Dependencies**: External or internal libraries being used
  5. **Known Issues**: Prior bugs or workarounds in affected code
  6. **File Locations**: Where to find relevant code files

#### Scenario: Coder receives compact context
- **WHEN** Planner passes plan to Coder
- **THEN** Coder is provided with `task_sentence_compact.md`
- **AND** Coder uses compact version as primary reference
- **AND** Coder can request full context (`task_sentence.md`) if more detail is needed

### Requirement: Task memory isolation prevents context bleed
Each task run creates isolated memory documents. Prior task memories are not auto-loaded into subsequent tasks, preventing context contamination.

#### Scenario: New task starts fresh
- **WHEN** user runs a second task on the same project
- **THEN** Examiner creates NEW `task_sentence.md` and `task_sentence_compact.md` files
- **AND** prior task memory documents remain in `memory/internal/task_sentence/` for reference
- **AND** new documents do not inherit prior task context (start clean)

#### Scenario: Prior task memory available for reference
- **WHEN** current task may benefit from learnings in prior task
- **THEN** Examiner explicitly reads prior `task_sentence.md` if relevant
- **AND** Examiner includes insights in new full memory document
- **AND** user can optionally reference prior task documents manually

### Requirement: Research findings integrated into compact memory
If Researcher findings are saved, Examiner SHALL incorporate relevant findings into the compact task memory to provide research context to Coder.

#### Scenario: Research informs compact memory
- **WHEN** Researcher saves findings and pipeline continues to Planner
- **THEN** Examiner reads findings from `memory/internal/research/`
- **AND** Examiner integrates critical findings into `task_sentence_compact.md`
- **AND** Coder can reference research solutions directly in compact memory

#### Scenario: Full research preserved separately
- **WHEN** Researcher findings are integrated into compact memory
- **THEN** original research files remain in `memory/internal/research/`
- **AND** Coder can request full research details if needed beyond compact summary

### Requirement: Context compaction is task-aware
The Examiner SHALL tailor compaction strategy based on the specific task sentence. Different tasks prioritize different information.

#### Scenario: Fix-oriented compaction
- **WHEN** task is a quick fix (bug fix task)
- **THEN** compact memory prioritizes:
  1. The specific bug description and affected code
  2. Prior related fixes in same module
  3. Minimal but sufficient context on architecture
  4. Test failure details or error messages

#### Scenario: Feature-oriented compaction
- **WHEN** task is a new feature
- **THEN** compact memory prioritizes:
  1. Architecture patterns for new features
  2. API contracts the feature must implement
  3. Integration points with existing code
  4. Performance or security constraints
