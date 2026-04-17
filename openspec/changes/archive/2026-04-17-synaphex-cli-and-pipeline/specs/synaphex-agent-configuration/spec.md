## ADDED Requirements

### Requirement: Agent configuration with provider, model, effort, and think options
The system SHALL store per-agent configuration in `settings.json` with fields: `provider`, `model`, `effort`, and `think`. All 6 agents (Examiner, Researcher, Planner, Coder, Answerer, Reviewer) have independent configurations. The `/synaphex/settings <project>` command allows interactive configuration of these fields.

#### Scenario: Configure Coder agent
- **WHEN** user runs `/synaphex/settings myproject` and selects Coder
- **THEN** system prompts for:
  - Provider: [Claude] (Claude models exclusive in Phase 2)
  - Model: [Haiku 4.5 / Sonnet 4.6 / Opus 4.6]
  - Think: [Yes / No] (extended thinking)
  - Effort: [0-4] (effort level, if supported by model)

#### Scenario: Configure Answerer agent for high capability
- **WHEN** user configures Answerer with Opus 4.6, Think=Yes, Effort=4
- **THEN** system saves: `{"provider": "claude", "model": "opus-4-6", "think": true, "effort": 4}`

#### Scenario: Configure Examiner with default settings
- **WHEN** project is created
- **THEN** Examiner defaults to: `{"provider": "claude", "model": "sonnet-4-6", "think": false, "effort": 0}`

### Requirement: Model capability matrix and validation
The system SHALL enforce a capability matrix that defines which features are supported by each Claude model. Models with limited capabilities MUST have `effort` and `think` options clamped or rejected.

#### Scenario: Haiku 4.5 capability constraints
- **WHEN** user attempts to configure Haiku 4.5 with Think=Yes or Effort>0
- **THEN** system rejects configuration and displays error:
  "Haiku 4.5 does not support extended thinking or effort levels. Use Think=No, Effort=0."

#### Scenario: Sonnet 4.6 capability constraints
- **WHEN** user configures Sonnet 4.6
- **THEN** Think option is available (Yes/No)
- **AND** Effort is NOT available or clamped to 0
- **AND** system displays: "Sonnet 4.6 does not support effort levels beyond 0."

#### Scenario: Opus 4.6 full capability
- **WHEN** user configures Opus 4.6
- **THEN** all options are available: Think (Yes/No), Effort (0-4)
- **AND** no constraints are applied

#### Scenario: Effort scale 0-4
- **WHEN** user selects effort level for Opus 4.6
- **THEN** valid range is 0 (minimal), 1, 2, 3, 4 (maximum reasoning effort)

### Requirement: Default agent configurations on project creation
When a new project is created, all agents receive sensible default configurations based on their role. Examiner and Planner default to Sonnet 4.6; Coder defaults to Haiku 4.5 (fast/cheap); Answerer defaults to Opus 4.6 (high capability).

#### Scenario: Default config for new project
- **WHEN** `/synaphex/create myproject` is executed
- **THEN** `settings.json` initializes with:
  - Examiner: Sonnet 4.6, Think=No, Effort=0
  - Researcher: Sonnet 4.6, Think=No, Effort=0
  - Planner: Sonnet 4.6, Think=No, Effort=0
  - Coder: Haiku 4.5, Think=No, Effort=0
  - Answerer: Opus 4.6, Think=Yes, Effort=4
  - Reviewer: Sonnet 4.6, Think=No, Effort=0

#### Scenario: User overrides defaults
- **WHEN** user runs `/synaphex/settings myproject` to customize
- **THEN** new configurations replace defaults in `settings.json`
- **AND** subsequent pipeline runs use new configurations

### Requirement: Configuration persistence and reload
Agent configurations in `settings.json` are persistent and automatically loaded when `/synaphex/load` is called or when a pipeline is invoked.

#### Scenario: Load and reuse configuration
- **WHEN** user loads project with `/synaphex/load myproject`
- **THEN** system reads `settings.json` and all agent configurations are available
- **AND** configurations persist across multiple task runs

#### Scenario: Update affects all subsequent runs
- **WHEN** user updates Coder model from Haiku 4.5 to Sonnet 4.6 via `/synaphex/settings`
- **THEN** all future task runs use Sonnet 4.6 for Coder
- **AND** old tasks are not affected (their context is separate)

### Requirement: Interactive settings validation
The `/synaphex/settings <project>` command MUST validate all configurations before saving and reject invalid model/effort/think combinations.

#### Scenario: Validation on save
- **WHEN** user completes agent configuration and confirms save
- **THEN** system validates all 6 agents against the capability matrix
- **AND** if invalid combination found, system displays error and prompts to fix
- **AND** only valid configurations are saved to `settings.json`

#### Scenario: User corrects invalid configuration
- **WHEN** system rejects Haiku 4.5 with Think=Yes
- **THEN** system prompts user to choose a model that supports extended thinking
- **AND** user is redirected to configuration for that agent
