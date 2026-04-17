## ADDED Requirements

### Requirement: Remove file-tools.ts and consolidate into agents

The system SHALL delete src/lib/file-tools.ts. Its functions (read_file, list_files, search_code) are Examiner's tools and shall be integrated into src/agents/examiner.ts.

#### Scenario: file-tools consolidation

- **WHEN** codebase refactors file-tools.ts

- **THEN** functions migrate to agents/examiner.ts as part of EXAMINER_TOOLS definition

- **AND** src/lib/file-tools.ts is deleted

- **AND** src/commands/task-examine.ts imports tools from agents/examiner.ts instead

### Requirement: Remove memory-scaffold.ts and consolidate logic

The system SHALL delete src/lib/memory-scaffold.ts. Its memory initialization logic shall be integrated into src/commands/create.ts and src/commands/memorize.ts.

#### Scenario: memory-scaffold consolidation

- **WHEN** refactoring memory scaffolding

- **THEN** default memory structure creation moves to create.ts (for new projects)

- **AND** memory update logic moves to memorize.ts (for existing projects)

- **AND** src/lib/memory-scaffold.ts is deleted

### Requirement: Remove write-memory.ts MCP tool

The system SHALL remove the standalone `write_memory` MCP tool from index.ts and commands. Memory writing shall be agent-internal; agents write memory directly without exposing it as a separate CLI command.

#### Scenario: write-memory removal

- **WHEN** agents need to write memory (e.g., Researcher saving findings)

- **THEN** agents call internal writeMemory() helper

- **AND** /synaphex:write-memory command is removed from index.ts

- **AND** src/commands/write-memory.ts is deleted or repurposed as internal utility

### Requirement: Rename task commands

The system SHALL rename task-related commands to clarify agent roles:

- task-start.ts → task-create.ts (initialize task)

- task-plan.ts → task-planner.ts (Planner agent)

- task-implement.ts → task-coder.ts (Coder agent)

- task-review.ts → task-reviewer.ts (Reviewer agent)

#### Scenario: Command name updates

- **WHEN** refactoring command names

- **THEN** /synaphex:task-start becomes /synaphex:task-create

- **AND** /synaphex:task-plan becomes /synaphex:task-planner

- **AND** /synaphex:task-implement becomes /synaphex:task-coder

- **AND** /synaphex:task-review becomes /synaphex:task-reviewer

- **AND** src/index.ts updated with new tool names

- **AND** old names removed or deprecated with warning

### Requirement: Code reduction metrics

Phase 3 code cleanup SHALL result in:

- Reduction from 27 files to ~20 files in src/

- Removal of ~500 LOC of redundant code

- Improved code cohesion (tools stay with agents, not separate files)

#### Scenario: Code size validation

- **WHEN** Phase 3 refactoring complete

- **THEN** wc -l src/\*_/_.ts shows ~500 fewer lines

- **AND** file structure is cleaner with fewer src/lib/ utilities
