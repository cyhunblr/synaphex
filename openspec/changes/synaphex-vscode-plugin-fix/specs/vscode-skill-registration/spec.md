# VS Code Skill Registration Capability

## ADDED Requirements

### Requirement: Register synaphex MCP tools as IDE skills

The system SHALL expose synaphex MCP tools as `/synaphex:*` skills in VS Code IDE.

#### Scenario: User runs /synaphex:create command

- **WHEN** user types `/synaphex:create project-name` in VS Code
- **THEN** command is recognized as available skill
- **AND** skill autocomplete shows `/synaphex:create`
- **AND** command executes and creates project at `~/.synaphex/project-name/`

#### Scenario: User runs /synaphex:load command

- **WHEN** user types `/synaphex:load project-name` in VS Code
- **THEN** command is recognized as available skill
- **AND** project settings and memory are loaded
- **AND** output shows project configuration

#### Scenario: User runs /synaphex:settings command

- **WHEN** user types `/synaphex:settings project-name` in VS Code
- **THEN** command is recognized as available skill
- **AND** project agent configuration is displayed
- **AND** user can see current model and settings

### Requirement: MCP server properly starts in IDE environment

The system SHALL ensure MCP server is running when synaphex plugin is loaded.

#### Scenario: MCP server starts on VS Code plugin load

- **WHEN** VS Code extension loads synaphex plugin
- **THEN** MCP server process starts with stdio transport
- **AND** server successfully registers all tools
- **AND** IDE can communicate with MCP server

#### Scenario: Tool discovery works

- **WHEN** IDE queries available tools from MCP server
- **THEN** server responds with all 6 tools: create, load, memorize, remember, settings, update_settings
- **AND** each tool has valid input schema
- **AND** each tool has description

### Requirement: Skills are discoverable and properly named

The system SHALL expose skills with correct names and namespacing.

#### Scenario: Skills follow /synaphex:* naming pattern

- **WHEN** user looks for synaphex skills
- **THEN** all skills are named: `/synaphex:create`, `/synaphex:load`, `/synaphex:memorize`, `/synaphex:remember`, `/synaphex:settings`, `/synaphex:update-settings`
- **AND** skill names match tool names (with appropriate casing)
- **AND** all skills are grouped under synaphex namespace

#### Scenario: Skill descriptions are clear

- **WHEN** user hovers over skill in IDE
- **THEN** description shows purpose: "Create a new synaphex project", "Load existing project", etc.
- **AND** parameter descriptions are shown
- **AND** help text guides user to correct command usage
