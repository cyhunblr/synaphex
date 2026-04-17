# MCP Tool Integration Capability

## ADDED Requirements

### Requirement: MCP tools properly implement required interface

The system SHALL implement each MCP tool according to MCP specification.

#### Scenario: Create tool accepts project name parameter

- **WHEN** create tool is invoked with project name
- **THEN** tool validates project name (lowercase, alphanumeric, hyphens, underscores)
- **AND** tool creates directory at ~/.synaphex/{project-name}/
- **AND** tool writes settings.json and meta.json
- **AND** tool writes memory/ directory structure
- **AND** tool returns success response

#### Scenario: Load tool returns project configuration

- **WHEN** load tool is invoked with existing project name
- **THEN** tool reads settings.json and meta.json
- **AND** tool returns agent configuration and project metadata
- **AND** tool includes memory summary

#### Scenario: Settings tool displays current configuration

- **WHEN** settings tool is invoked with project name
- **THEN** tool reads settings.json
- **AND** tool formats output as readable table
- **AND** tool shows: agents, models, think, effort settings

### Requirement: Tool errors are handled gracefully

The system SHALL provide clear error messages when tool calls fail.

#### Scenario: Create tool handles existing project

- **WHEN** create tool is invoked for existing project
- **THEN** tool returns error message (not crash)
- **AND** error message explains project exists
- **AND** error message suggests deletion or renaming

#### Scenario: Load tool handles missing project

- **WHEN** load tool is invoked for non-existent project
- **THEN** tool returns error message
- **AND** error message suggests creating project first
- **AND** error message suggests listing available projects

### Requirement: Tool invocation from IDE works end-to-end

The system SHALL allow IDE to invoke tools and receive responses.

#### Scenario: Tool invocation completes successfully

- **WHEN** IDE invokes synaphex tool via MCP
- **THEN** tool executes without hanging
- **AND** tool returns response within timeout
- **AND** response includes success/error status
- **AND** response includes action result or error message

#### Scenario: Multiple tools can be called in sequence

- **WHEN** IDE calls create, then load, then settings tools
- **THEN** each tool executes successfully
- **AND** responses are correct for each tool
- **AND** no state corruption occurs
