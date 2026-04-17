# Examples Library Capability

## ADDED Requirements

### Requirement: Provide 5+ real-world workflow examples

The system SHALL include complete, copy-paste ready examples for common scenarios.

#### Scenario: Simple feature example (no research, no escalation)

- **WHEN** user reads "Example 1: Simple Feature"
- **THEN** example task: "Add password reset endpoint"
- **AND** complete command sequence shown (create → examine → planner → coder → answerer → reviewer)
- **AND** each command's output included
- **AND** expected time to complete noted
- **AND** lessons learned documented

#### Scenario: Complex feature with research

- **WHEN** user reads "Example 2: Complex Feature with Research"
- **THEN** example task: "Integrate GraphQL subscriptions"
- **AND** includes researcher step with sample output
- **AND** shows how researcher findings influence planner
- **AND** documents which sections of plan reference research
- **AND** notes on handling unknown technologies

#### Scenario: Architectural decision example

- **WHEN** user reads "Example 3: Architectural Decision"
- **THEN** example task: "Implement real-time notifications"
- **AND** shows coder embedding SYNAPHEX_ARCHITECTURAL marker
- **AND** shows answerer escalation detection
- **AND** shows user decision update in task-meta.json
- **AND** shows re-planning (iteration 2) with decision incorporated
- **AND** complete workflow to resolution

#### Scenario: Multi-project inheritance example

- **WHEN** user reads "Example 4: Multi-Project Inheritance"
- **THEN** shows parent project with established patterns
- **AND** shows child project inheriting parent memory
- **AND** demonstrates task-remember command
- **AND** shows how child planner references parent patterns
- **AND** results are consistent with parent conventions

#### Scenario: Refactoring with re-planning example

- **WHEN** user reads "Example 5: Refactoring with Feedback"
- **THEN** shows coder implementation
- **AND** shows reviewer feedback requesting changes
- **AND** shows iteration 2: re-planning with feedback
- **AND** shows re-implementation addressing feedback
- **AND** shows final reviewer approval
- **AND** documents feedback loop mechanics

### Requirement: Each example is independently runnable

The system SHALL ensure users can reproduce any example exactly as documented.

#### Scenario: Example provides setup instructions

- **WHEN** user starts example
- **THEN** "Setup" section provides:
  - Project name to create
  - Task description to use
  - Working directory (real or mock codebase)
  - Estimated time to run example

#### Scenario: Example provides all required commands

- **WHEN** user executes example steps
- **THEN** every command shown is copy-paste ready
- **AND** command output shown matches expected results
- **AND** if output varies (e.g., timestamps), that's noted

#### Scenario: Example includes verification checklist

- **WHEN** example completes
- **THEN** "Verify Success" checklist provided
- **AND** includes: files created, task-meta.json state, output in memory
- **AND** user can confirm task worked correctly

#### Scenario: Example includes observations and insights

- **WHEN** example documents outputs
- **THEN** "Observations" section explains:
  - Why each agent produced this output
  - What user should notice
  - How to interpret results
  - Common variations and what they mean

### Requirement: Examples are discoverable and organized

The system SHALL make finding relevant examples easy.

#### Scenario: Examples organized by difficulty

- **WHEN** user opens EXAMPLES.md
- **THEN** examples grouped:
  - Level 1: Basic (example 1)
  - Level 2: Intermediate (examples 2, 3)
  - Level 3: Advanced (examples 4, 5)
- **AND** each level shows estimated complexity

#### Scenario: Examples discoverable by use case

- **WHEN** user searches or browses
- **THEN** table of contents lists examples by type:
  - Adding features
  - Integrating libraries
  - Making architecture decisions
  - Multi-project workflows
  - Iterating on feedback

#### Scenario: Each example links to related docs

- **WHEN** example section shown
- **THEN** "Learn more" section links to:
  - Relevant how-to guides
  - CLI reference for commands used
  - Architecture details for agents involved
  - Troubleshooting if issues arise
