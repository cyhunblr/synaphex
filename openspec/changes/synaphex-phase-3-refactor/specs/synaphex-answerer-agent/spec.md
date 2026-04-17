## ADDED Requirements

### Requirement: Task answerer analyzes Coder questions
The system SHALL provide `/synaphex:task-answerer <project_name> <task_name>` command that runs Answerer agent to examine Coder's embedded questions, answer technical questions, and escalate architectural decisions to user.

#### Scenario: Answerer finds and answers technical questions
- **WHEN** user runs `/synaphex:task-answerer myproject task_name` after task-coder
- **THEN** Answerer reads code files searching for question markers:
  - `# SYNAPHEX_QUESTION: <question>` (technical)
  - `# SYNAPHEX_ARCHITECTURAL: <question>` (architectural)
- **AND** Answerer answers technical questions independently: "Here's how to handle this..."
- **AND** returns answers inline with code/context

#### Scenario: Answerer identifies no questions
- **WHEN** Coder completed without embedded questions
- **THEN** Answerer confirms: "No questions found. Code is complete and well-understood."
- **AND** appends "answerer" to completed_steps

### Requirement: Answerer escalates architectural decisions
When Answerer encounters architectural decision questions, it SHALL pause, explain the decision, present options, and set escalation flag in task-meta.json waiting for user input.

#### Scenario: Architectural escalation trigger
- **WHEN** Answerer encounters: `# SYNAPHEX_ARCHITECTURAL: Should we use singleton pattern for database connection?`
- **THEN** Answerer recognizes this as architectural decision (not technical Q&A)
- **AND** pauses processing

#### Scenario: Answerer sets escalation in task-meta
- **WHEN** Answerer pauses on architectural decision
- **THEN** system updates task-meta.json:
  ```json
  {
    "answerer_escalation": {
      "question": "Should we use singleton pattern for database connection?",
      "context": "Database initialization happens in main.rs. Need persistent connection...",
      "options": [
        "Yes: singleton ensures one connection, safer resource management",
        "No: pass connection as parameter, more testable and flexible"
      ]
    }
  }
  ```
- **AND** returns escalation prompt to user

#### Scenario: User provides clarification
- **WHEN** user reads escalation prompt and updates task-meta.json with their decision
- **THEN** user can trigger `/synaphex:task-planner myproject task_name` to re-plan with clarification
- **AND** Planner reads user decision and adjusts plan if refactor needed

### Requirement: Answerer question detection
Answerer SHALL detect question markers (SYNAPHEX_QUESTION, SYNAPHEX_ARCHITECTURAL) in code and understand context from surrounding code.

#### Scenario: Answerer detects all marker types
- **WHEN** Coder embeds questions like:
  ```rust
  // SYNAPHEX_QUESTION: What's the best way to handle null values here?
  let value = data.get("key");
  
  // SYNAPHEX_ARCHITECTURAL: Should this be async?
  fn process_data(data: HashMap) {}
  ```
- **THEN** Answerer finds both markers and distinguishes question types

### Requirement: Answerer answers independently
For non-architectural questions, Answerer SHALL provide direct answers and continue without pausing.

#### Scenario: Technical answer provided without escalation
- **WHEN** Answerer finds: `# SYNAPHEX_QUESTION: How to handle Result<T, E>?`
- **THEN** Answerer provides answer: "Use the ? operator or match on Result..."
- **AND** continues processing other questions
- **AND** does not escalate

### Requirement: Answerer optional step
Task answerer MAY be skipped if Coder's code is self-contained and needs no clarification.

#### Scenario: Skip answerer if no questions
- **WHEN** Coder completed without question markers
- **AND** user runs `/synaphex:task-reviewer myproject task_name` without task-answerer
- **THEN** system permits execution (answerer is optional)
