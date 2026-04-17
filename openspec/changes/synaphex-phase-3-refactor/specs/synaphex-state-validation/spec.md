## ADDED Requirements

### Requirement: Task state tracking via completed_steps

The system SHALL track task progress by maintaining `completed_steps: string[]` in task-meta.json. Each command appends its name when successfully completed.

#### Scenario: completed_steps array grows

- **WHEN** user runs task-create, then task-examine, then task-planner

- **THEN** task-meta.json completed_steps evolves:
  - After task-create: `["create"]`
  - After task-examine: `["create", "examine"]`
  - After task-planner: `["create", "examine", "planner"]`

#### Scenario: Optional step tracked

- **WHEN** user runs task-researcher after task-examine

- **THEN** "researcher" appended to completed_steps

- **AND** if user skips researcher, it does not appear in array

### Requirement: Validate required step ordering

Before executing any command, system SHALL verify that all required prior steps have completed. If not, reject with helpful error message.

**Required sequence**: create → examine → planner → coder → answerer → reviewer
**Optional steps**: remember (before examine), researcher (between examine and planner)

#### Scenario: Cannot run planner before examine

- **WHEN** user runs `/synaphex:task-planner myproject task_name` but completed_steps = ["create"]

- **THEN** system rejects with error: "Cannot run task-planner: task-examine not completed yet. Required order: create → examine → planner → coder → answerer → reviewer"

#### Scenario: Cannot run coder before planner

- **WHEN** user runs `/synaphex:task-coder myproject task_name` but completed_steps = ["create", "examine"]

- **THEN** system rejects with error: "Cannot run task-coder: task-planner not completed yet."

#### Scenario: Can skip optional researcher

- **WHEN** user runs `/synaphex:task-planner myproject task_name` with completed_steps = ["create", "examine"] (no researcher)

- **THEN** system permits execution (researcher is optional)

### Requirement: Optional step validation

Optional steps (remember, researcher) can be skipped. System SHALL allow running next required step regardless of optional step completion.

#### Scenario: Skip remember step

- **WHEN** user runs `/synaphex:task-examine myproject task_name` without running task-remember

- **THEN** system permits execution

- **AND** completed_steps does not include "remember"

#### Scenario: Skip researcher step

- **WHEN** user runs `/synaphex:task-planner myproject task_name` after examine, without running task-researcher

- **THEN** system permits execution

- **AND** planner proceeds normally

### Requirement: Validate cannot repeat steps

System SHALL prevent running the same step twice (e.g., cannot run task-examine twice for same task).

#### Scenario: Prevent re-running step

- **WHEN** user runs `/synaphex:task-examine myproject task_name` and "examine" is already in completed_steps

- **THEN** system rejects with error: "task-examine already completed for this task. To re-examine, create a new task."

### Requirement: Task status reflects progress

`status` field in task-meta.json SHALL reflect current phase: "created", "examining", "examined", "planning", "planned", "implementing", "implemented", "answering", "answered", "reviewing", "reviewed", "complete", or "failed".

#### Scenario: Status updates with steps

- **WHEN** user runs task-examine

- **THEN** status = "examining" (before start)

- **AND** after success, status = "examined"

### Requirement: Validation error messages are helpful

Validation errors SHALL clearly explain:

1. What step failed

2. What prior steps are required

3. Which optional steps can be skipped

4. Next valid action

#### Scenario: Clear error message

- **WHEN** validation fails

- **THEN** error message is:

  ```
  ❌ Cannot run task-coder: task-planner not completed yet.

  Required workflow order:
    1. create ✓
    2. examine ✓
    3. [remember] (optional)
    4. [researcher] (optional)
    5. planner ✗ (required next)
    6. coder
    7. [answerer] (optional)
    8. reviewer

  Run: /synaphex:task-planner myproject <task_name>
  ```
