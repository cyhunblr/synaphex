# Manual Workflow Testing Capability

## ADDED Requirements

### Requirement: Execute complete 8-step task workflow end-to-end

The system SHALL allow users to run a complete task pipeline from initialization through review without errors, documenting each step.

#### Scenario: Create task and initialize state

- **WHEN** user runs `task-create` with task description
- **THEN** task directory is created with task-meta.json
- **AND** completed_steps includes "create"
- **AND** slug is generated and returned

#### Scenario: Examine codebase and generate context

- **WHEN** user runs `task-examine` after create
- **THEN** examiner analyzes codebase at specified path
- **AND** raw and compact examination files are saved
- **AND** output is suitable for downstream agents

#### Scenario: Run researcher for knowledge gaps

- **WHEN** user runs `task-researcher` with examined context
- **THEN** researcher identifies knowledge gaps in task
- **AND** research findings are saved to memory/internal/research/{topic}.md
- **AND** completed_steps includes "researcher"

#### Scenario: Plan implementation with planner

- **WHEN** user runs `task-planner` after examine (or after researcher)
- **THEN** planner generates detailed implementation plan
- **AND** plan accounts for examined context and any research
- **AND** plan-v{iteration}.md is saved

#### Scenario: Implement code with coder

- **WHEN** user runs `task-coder` with plan and context
- **THEN** coder implements code directly
- **AND** question markers are embedded (SYNAPHEX_QUESTION, SYNAPHEX_ARCHITECTURAL)
- **AND** implementation-log-v{iteration}.md is saved

#### Scenario: Answer coder questions with answerer

- **WHEN** user runs `task-answerer` after coder
- **THEN** answerer detects questions in implementation
- **AND** questions are answered or escalated based on type
- **AND** if escalation: answerer_escalation is set in task-meta.json

#### Scenario: Review implementation with reviewer

- **WHEN** user runs `task-reviewer` after answerer
- **THEN** reviewer provides feedback on code quality
- **AND** if issues found: reviewer provides guidance for re-work
- **AND** completed_steps includes "reviewer"

### Requirement: Document workflow with examples and screenshots

The system SHALL provide clear documentation of each workflow run including commands, outputs, and observations.

#### Scenario: Document simple workflow (no research, no escalation)

- **WHEN** running task: "Add password reset endpoint"
- **THEN** each step (create, examine, planner, coder, answerer, reviewer) is executed
- **AND** command used is recorded
- **AND** command output is captured
- **AND** completion time is noted
- **AND** observations are documented in manual-testing-log.md

#### Scenario: Document research workflow

- **WHEN** running task: "Integrate GraphQL subscriptions"
- **THEN** workflow includes researcher step
- **AND** researcher output is captured and analyzed
- **AND** memory file creation is verified
- **AND** impact on planner/coder is noted

#### Scenario: Document escalation workflow

- **WHEN** running task: "Implement real-time notifications"
- **THEN** coder embeds architectural questions
- **AND** answerer detects and escalates questions
- **AND** escalation format (ESCALATE/CONTEXT) is validated
- **AND** user decision process is documented

#### Scenario: Document multi-project workflow

- **WHEN** creating child task that links parent memory
- **THEN** task-remember is used before task-examine
- **AND** symlink creation is verified
- **AND** child's access to parent memory is confirmed
- **AND** planner leverages parent memory in plan

### Requirement: Validate UX clarity and command output quality

The system SHALL ensure user can understand what each command is doing and what outputs mean.

#### Scenario: Verify command descriptions are clear

- **WHEN** user sees help text for each tool
- **THEN** tool purpose is immediately clear
- **AND** required parameters are documented
- **AND** example usage is provided

#### Scenario: Verify output is readable and actionable

- **WHEN** command completes
- **THEN** success/failure is immediately obvious
- **AND** file paths are clear and absolute
- **AND** token usage is displayed (if applicable)
- **AND** next steps are suggested

#### Scenario: Verify error messages guide user to resolution

- **WHEN** command fails (e.g., wrong step order)
- **THEN** error message explains what went wrong
- **AND** error message suggests how to fix it
- **AND** user is not left guessing

### Requirement: Track and report any issues encountered during manual testing

The system SHALL document all issues found during manual workflow execution for tracking.

#### Scenario: Report UX issues (unclear commands, poor output formatting)

- **WHEN** issue is encountered during workflow
- **THEN** issue is logged with: scenario, step, command, error/observation
- **AND** issue is categorized as: blocker, important, nice-to-have
- **AND** issue is recorded in manual-testing-log.md for future v2.1.x prioritization

#### Scenario: Report functional issues (commands fail, state corruption)

- **WHEN** functional issue is encountered
- **THEN** full error stack trace is captured
- **AND** reproduction steps are documented
- **AND** issue is marked as blocker if workflow cannot complete

#### Scenario: Report performance observations (slow commands, high token usage)

- **WHEN** performance anomaly is observed
- **THEN** execution time and token counts are recorded
- **AND** observation is noted for comparison with 14.4 benchmarking
