# How-To Guide Capability

## ADDED Requirements

### Requirement: Provide task-focused documentation

The system SHALL organize documentation by common user tasks ("How do I...?").

#### Scenario: User finds "How to create a project"

- **WHEN** user searches for "create project" or reads HOW-TO-GUIDE.md
- **THEN** section "How to create a project" is found
- **AND** section includes: purpose, steps, example, expected output
- **AND** links to relevant CLI reference provided

#### Scenario: User finds "How to run a simple task"

- **WHEN** user looks for basic task execution
- **THEN** "How to run a simple task" section found
- **AND** includes: no research, no escalation scenario
- **AND** copy-paste ready commands provided
- **AND** expected agent outputs shown

#### Scenario: User finds "How to research unfamiliar technology"

- **WHEN** user encounters unknown library/framework in code
- **THEN** "How to research unfamiliar tech" section provides guidance
- **AND** shows when to use researcher agent
- **AND** example task: "Integrate Triton inference server"
- **AND** explains what research output looks like

#### Scenario: User finds "How to handle architectural questions"

- **WHEN** user encounters escalation during coder phase
- **THEN** "How to handle escalations" section provides steps
- **AND** explains SYNAPHEX_ARCHITECTURAL marker
- **AND** shows how to update task-meta.json with decision
- **AND** explains re-planning loop (iteration 2, etc.)

#### Scenario: User finds "How to link multi-project memory"

- **WHEN** user wants child project to inherit parent patterns
- **THEN** "How to link memory" section explains process
- **AND** command sequence shown: create parent, create child, task-remember
- **AND** example shows accessing parent patterns in child planner

#### Scenario: User finds "How to debug errors"

- **WHEN** task fails or produces unexpected output
- **THEN** "How to debug" section provides checklist
- **AND** includes: check task-meta.json, review completed_steps, examine logs
- **AND** links to troubleshooting guide for common errors

### Requirement: Each how-to includes working examples

The system SHALL provide copy-paste ready code and commands for every task.

#### Scenario: How-to includes exact command

- **WHEN** how-to describes a task
- **THEN** exact command is shown in code block
- **AND** command has no placeholders (or clearly marked: <project_name>)
- **AND** user can copy-paste and run immediately

#### Scenario: How-to shows expected output

- **WHEN** how-to describes command execution
- **THEN** expected output is shown
- **AND** output helps user confirm success
- **AND** common variations are noted (e.g., "If you see X instead of Y, that means Z")

#### Scenario: How-to includes troubleshooting tip

- **WHEN** how-to task completed
- **THEN** "If it doesn't work" note is provided
- **AND** describes most common failure mode
- **AND** explains how to recover

### Requirement: How-tos are discoverable

The system SHALL make finding task-based help easy.

#### Scenario: Table of contents lists all how-tos

- **WHEN** user opens HOW-TO-GUIDE.md
- **THEN** table of contents at top lists all tasks
- **AND** links jump to sections
- **AND** tasks are grouped logically (Setup, Basic Tasks, Advanced, Troubleshooting)

#### Scenario: Each how-to links to related resources

- **WHEN** how-to section completed
- **THEN** "See also" links provided to:
  - Related CLI commands in reference
  - Relevant workflow guide sections
  - Example projects
  - Error messages if something goes wrong
