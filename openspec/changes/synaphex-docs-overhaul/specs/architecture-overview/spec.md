# Architecture Overview Capability

## ADDED Requirements

### Requirement: Explain system design and components

The system SHALL provide clear documentation of Synaphex architecture for developers and power users.

#### Scenario: User understands agent pipeline flow

- **WHEN** user reads "Agent Pipeline" section in ARCHITECTURE.md
- **THEN** diagram shows 8 agents and their sequence
- **AND** each agent's role is explained (1-2 sentences)
- **AND** data flow between agents is shown
- **AND** which agents are required vs optional is clear

#### Scenario: User understands state machine

- **WHEN** user reads "State Machine" section
- **THEN** state diagram shows all task states
- **AND** transitions between states are labeled with conditions
- **AND** which steps have prerequisites is documented
- **AND** completed_steps array semantics explained

#### Scenario: User understands memory organization

- **WHEN** user reads "Memory System" section
- **THEN** directory structure shown:
  - internal/ vs external/ directories
  - task\_<slug>/ organization
  - research/, patterns/ subdirectories
  - symlink-based inheritance via external/
- **AND** how agents read/write memory explained
- **AND** lifetime of memory files explained (created, updated, persisted)

#### Scenario: User understands escalation mechanism

- **WHEN** user reads "Question Escalation" section
- **THEN** flow diagram shows:
  - Coder embeds markers (SYNAPHEX_QUESTION, SYNAPHEX_ARCHITECTURAL)
  - Answerer detects and parses questions
  - Architectural questions escalate to user
  - User decision stored in answerer_escalation
  - Re-planning incorporates decision
- **AND** each step includes required data structures

#### Scenario: User understands data model

- **WHEN** user reads "Data Structures" section
- **THEN** key types documented:
  - TaskMeta (slug, status, completed_steps, iteration, answerer_escalation)
  - Agent config (provider, model, think, effort, mode)
  - Examination output (raw and compact formats)
  - Plan v{iteration} format
- **AND** JSON examples provided for each type
- **AND** where each file lives explained

### Requirement: Provide developer reference for system concepts

The system SHALL document key design decisions and constraints.

#### Scenario: Developer understands completed_steps validation

- **WHEN** developer reads "State Validation" section
- **THEN** state machine rules documented:
  - Required steps: create, examine, planner, coder, answerer, reviewer
  - Optional steps: researcher
  - Order constraints (e.g., planner must come after examine)
  - No step can run twice (unless re-planning with iteration)
- **AND** validateTaskSequence() logic explained
- **AND** error messages documented

#### Scenario: Developer understands question markers

- **WHEN** developer reads "Question Markers" section
- **THEN** both marker types documented:
  - SYNAPHEX_QUESTION: Technical questions (answerable)
  - SYNAPHEX_ARCHITECTURAL: Design questions (escalate)
- **AND** how Coder embeds markers explained
- **AND** regex pattern used by Answerer shown
- **AND** when to use each type explained

#### Scenario: Developer understands mode switching

- **WHEN** developer reads "Agent Modes" section
- **THEN** two modes documented:
  - Direct: API calls via Anthropic SDK
  - Delegated: IDE model (Copilot, Gemini, etc.)
- **AND** when each mode is appropriate
- **AND** config switches between modes
- **AND** limitations of each mode noted

### Requirement: Make architecture discoverable

The system SHALL help users find architecture details when needed.

#### Scenario: Architecture doc is linked from README

- **WHEN** user reads README.md
- **THEN** "Architecture" link in advanced section
- **AND** description: "System design, data model, state machine"
- **AND** link points to ARCHITECTURE.md

#### Scenario: Workflow guide links to architecture

- **WHEN** user reads workflow guide
- **THEN** where relevant, links to architecture sections
- **AND** e.g., "For details on state machine, see ARCHITECTURE.md"
- **AND** e.g., "For escalation flow, see ARCHITECTURE.md"

#### Scenario: CLI reference explains state machine rules

- **WHEN** CLI reference documents each command
- **THEN** "When to use" section references architecture
- **AND** e.g., "Can only run after examine (see state machine)"
