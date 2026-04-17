# Quick Start Guide Capability

## ADDED Requirements

### Requirement: Provide 5-minute onboarding experience

The system SHALL enable a user to install, create a project, and run their first task in under 5 minutes.

#### Scenario: User completes full onboarding in 5 minutes

- **WHEN** user follows GETTING-STARTED.md from start to finish
- **THEN** time to complete is <5 minutes (measured with step timings)
- **AND** each step has clear instructions and copy-paste ready commands
- **AND** each step confirms success before moving to next

#### Scenario: User installs Synaphex

- **WHEN** user runs installation command from Quick Start
- **THEN** command is single line: `npm install -g synaphex` or `npx -y synaphex`
- **AND** installation completes in <1 minute
- **AND** success is confirmed with `--help` command

#### Scenario: User creates first project

- **WHEN** user runs project creation command
- **THEN** command is: `synaphex create my-first-project`
- **AND** project is created in ~/.synaphex/my-first-project
- **AND** success message shows project path

#### Scenario: User loads project into Claude Code

- **WHEN** user follows "Load Project" section
- **THEN** command shown: `npx -y synaphex setup claude`
- **AND** instructions for opening in IDE are provided
- **AND** screenshot shows expected result

#### Scenario: User runs their first task

- **WHEN** user follows "Run First Task" section
- **THEN** task command is provided with real example: "Add a README file"
- **AND** expected outputs are shown
- **AND** user sees agent responses in real time

#### Scenario: User knows what to do next

- **WHEN** user completes Quick Start
- **THEN** "Next Steps" section provides 3-4 options:
  - Read full Workflow Guide
  - Check Examples for their use case
  - Explore CLI Reference for advanced features
  - Get help with Troubleshooting

### Requirement: Provide zero-friction experience

The system SHALL remove all barriers to getting started.

#### Scenario: All code examples are copy-paste ready

- **WHEN** user sees a code example in Quick Start
- **THEN** example can be copied and pasted verbatim
- **AND** no variable substitution required (or clearly marked with < >)
- **AND** command works immediately after paste

#### Scenario: All prerequisites are listed upfront

- **WHEN** user starts Quick Start
- **THEN** "Prerequisites" section at top lists:
  - Required: Node 18+, npm 8+
  - Optional: Claude Code (for IDE integration)
  - Estimated time: 5 minutes
  - Difficulty: Beginner

#### Scenario: Visual progress indicators

- **WHEN** user reads Quick Start
- **THEN** each major section is numbered (Step 1, Step 2, etc.)
- **AND** checkboxes are provided to track progress
- **AND** progress bar shows estimated completion (optional but nice)

### Requirement: Make Quick Start discoverable

The system SHALL ensure users find Quick Start easily.

#### Scenario: Quick Start is linked from README

- **WHEN** user opens README.md
- **THEN** "Getting Started" link appears early (2nd or 3rd section)
- **AND** link points to GETTING-STARTED.md
- **AND** description says "5-minute setup guide"

#### Scenario: Installation doc links to Quick Start

- **WHEN** user reads INSTALLATION.md
- **THEN** after successful install, link to Quick Start is provided
- **AND** suggests "Now run your first task in 5 minutes"
