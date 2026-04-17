## ADDED Requirements

**OpenSpec Context**: Synaphex's task pipeline mirrors [OpenSpec](https://github.com/Fission-AI/OpenSpec)'s specification-driven development workflow. Examiner → Researcher → Planner establishes the spec and plan before Coder implements, ensuring alignment on requirements before code is written.

### Requirement: Examiner agent reads project context
The Examiner agent SHALL read all project files relevant to the task, all memory files in `memory/internal/` and optionally linked memory in `memory/external/`, and compile a comprehensive knowledge base. Examiner has authority to update `memory/internal/` with new or revised memory files.

#### Scenario: Examiner reads memory and codebase
- **WHEN** pipeline starts with Examiner
- **THEN** Examiner reads all files in `memory/internal/` to understand prior context
- **AND** Examiner reads relevant codebase files based on task sentence
- **AND** Examiner can read linked memory from `memory/external/{parent_project}_memory/` if needed

#### Scenario: Examiner compiles knowledge base
- **WHEN** Examiner finishes reading
- **THEN** Examiner creates `memory/internal/task_sentence/task_sentence.md` (full context) and `task_sentence_compact.md` (condensed for Coder)
- **AND** compact version prioritizes critical information and fits within Coder's context window

### Requirement: Researcher agent conducts optional internet search
The Researcher agent is optional and only runs if user selects "yes" to activation prompt. If activated, Researcher SHALL conduct internet research based on the task sentence, identify solutions, and ask user whether to save findings to `memory/internal/research/` directory or discard.

#### Scenario: Researcher finds relevant solutions
- **WHEN** Researcher is activated for task "implement OAuth 2.0 flow"
- **THEN** Researcher searches the internet for OAuth 2.0 implementation patterns
- **AND** Researcher reports findings and asks: "Save findings to memory? [yes/no]"

#### Scenario: User discards research findings
- **WHEN** user answers "no" to save findings
- **THEN** research is discarded and not persisted to memory
- **AND** pipeline continues to Planner

#### Scenario: User saves research findings
- **WHEN** user answers "yes" to save findings
- **THEN** findings are saved to `memory/internal/research/<topic>.md`
- **AND** pipeline continues to Planner

### Requirement: Planner agent creates implementation plan
The Planner agent SHALL read the knowledge base from Examiner (and Researcher findings if available), create a detailed implementation plan, and present it to the user for approval before Coder begins work. Plan MUST cover all requirements from the task sentence.

#### Scenario: Planner creates and presents plan
- **WHEN** Planner receives context from Examiner
- **THEN** Planner creates a step-by-step implementation plan
- **AND** Planner presents plan to user with request for approval: "Proceed with this plan? [yes/no]"

#### Scenario: User approves plan
- **WHEN** user answers "yes"
- **THEN** pipeline continues to Coder with the approved plan

#### Scenario: User rejects plan
- **WHEN** user answers "no"
- **THEN** Planner re-evaluates and presents alternative plan OR user is asked to clarify requirements

### Requirement: Coder agent implements according to plan
The Coder agent SHALL implement the approved plan. If Coder encounters confusion, struggles, or hits a bottleneck, Coder MAY query Answerer for clarification. Coder MUST provide full context (current state, specific question) in each Answerer query. Coder continues implementing after receiving Answerer's response.

#### Scenario: Coder implements feature
- **WHEN** Coder receives plan from Planner
- **THEN** Coder begins implementing according to the plan
- **AND** Coder writes code, commits, and tracks progress

#### Scenario: Coder queries Answerer for help
- **WHEN** Coder encounters a blocker or needs clarification
- **THEN** Coder formulates a specific question with full context
- **AND** Coder sends query to Answerer and waits for response
- **AND** Coder continues implementation based on Answerer's guidance

#### Scenario: Coder completes implementation
- **WHEN** Coder finishes all planned work
- **THEN** Coder passes result to Answerer (if Reviewer is active) or reports completion

### Requirement: Answerer agent provides guidance
The Answerer agent SHALL answer questions from Coder. If a question concerns architecture or plan changes, Answerer SHALL forward the question to the user for decision. Otherwise, Answerer provides technical guidance directly. Answerer is stateless per query; Coder must provide full context.

#### Scenario: Answerer answers technical question
- **WHEN** Coder asks "How should I structure the authentication module?"
- **THEN** Answerer provides technical guidance based on project context
- **AND** response includes rationale for recommendations

#### Scenario: Answerer escalates architectural decision
- **WHEN** Coder asks "Should we use a monolithic or microservices architecture?"
- **THEN** Answerer recognizes this as an architecture decision
- **AND** Answerer escalates to user: "This requires an architectural decision. Option A: ... Option B: ..."
- **AND** Answerer waits for user choice before responding to Coder

### Requirement: Reviewer agent examines code
The Reviewer agent is optional and only runs if user selects "agent performs review" or chooses "ask when reached". Reviewer SHALL examine implemented code for correctness, quality, and adherence to requirements. If issues are found, Reviewer SHALL provide feedback to Planner, triggering a re-planning loop.

#### Scenario: Reviewer finds no issues
- **WHEN** Reviewer examines code
- **THEN** Reviewer confirms: "Code review passed. Ready for deployment."
- **AND** pipeline completes successfully

#### Scenario: Reviewer finds issues and loops back
- **WHEN** Reviewer identifies problems (bugs, missing requirements, quality issues)
- **THEN** Reviewer sends detailed feedback to Planner: "Issues found: [list]"
- **AND** Planner receives feedback and revises plan
- **AND** Coder re-implements according to revised plan
- **AND** pipeline loops: Coder → Answerer → Reviewer

#### Scenario: Reviewer loop limit reached
- **WHEN** pipeline has looped Reviewer→Planner→Coder 3 times (max iterations)
- **THEN** system stops automatic looping and prompts user: "Review loop limit reached. Manual intervention needed: [options]"

### Requirement: Pipeline orchestration with optional stages
The system SHALL execute agents in order: Examiner → [Researcher if enabled] → Planner → Coder → Answerer → [Reviewer if enabled]. Examiner and Planner are mandatory. Researcher and Reviewer are optional based on user choices. Coder and Answerer are always present.

#### Scenario: Full pipeline with all optional stages
- **WHEN** user enables both Researcher and Reviewer
- **THEN** pipeline runs: Examiner → Researcher → Planner → Coder → Answerer → Reviewer
- **AND** all agents complete their phases in order

#### Scenario: Pipeline without optional stages
- **WHEN** user disables Researcher and Reviewer
- **THEN** pipeline runs: Examiner → Planner → Coder → Answerer (no Reviewer)
- **AND** implementation completes without review loop
