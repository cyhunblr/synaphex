# Installation Guide Capability

## ADDED Requirements

### Requirement: Provide platform-specific installation instructions

The system SHALL provide clear, step-by-step installation instructions for macOS, Linux, and Windows.

#### Scenario: User installs on macOS via npm

- **WHEN** user follows macOS section of INSTALLATION.md
- **THEN** prerequisites are listed (Node 18+, npm 8+)
- **AND** installation command is provided: `npm install -g synaphex` or `npx -y synaphex`
- **AND** verification command confirms installation works
- **AND** troubleshooting tips are provided if verification fails

#### Scenario: User installs on Linux via npm

- **WHEN** user follows Linux section of INSTALLATION.md
- **THEN** same format as macOS (prerequisites, command, verify, troubleshoot)
- **AND** any Linux-specific issues are noted (permissions, paths, etc.)

#### Scenario: User installs on Windows via npm

- **WHEN** user follows Windows section of INSTALLATION.md
- **THEN** same format as macOS/Linux
- **AND** PowerShell and cmd.exe paths are documented
- **AND** any Windows-specific issues are noted

### Requirement: Document local development setup

The system SHALL explain how to clone, build, and run Synaphex for local development.

#### Scenario: Developer clones and builds locally

- **WHEN** developer follows "Local Development" section
- **THEN** clone command is provided: `git clone https://github.com/cyhunblr/synaphex`
- **AND** build steps are documented: `npm install`, `npm run build`
- **AND** test command is provided: `npm test`
- **AND** run command is documented: `npx -y ./` or equivalent

#### Scenario: Developer loads plugin in IDE

- **WHEN** developer follows IDE plugin setup section
- **THEN** instructions for Claude Code, VSCode, and Antigravity are provided
- **AND** each includes: plugin path, reload command, verification

### Requirement: Verify installation success

The system SHALL provide methods to confirm Synaphex is installed and working.

#### Scenario: User verifies installation

- **WHEN** user runs verification command (e.g., `npx -y synaphex --help`)
- **THEN** help text is displayed
- **AND** version number is shown
- **AND** list of available commands is displayed

#### Scenario: User checks MCP server connectivity

- **WHEN** user runs MCP health check
- **THEN** server status is reported (connected/disconnected)
- **AND** available tools are listed
- **AND** if disconnected: troubleshooting steps are provided

### Requirement: Troubleshoot common installation issues

The system SHALL provide recovery steps for common installation failures.

#### Scenario: Node version too old

- **WHEN** user has Node < 18 installed
- **THEN** error message from npx includes this issue
- **AND** INSTALLATION.md has section "Node version too old"
- **AND** section explains how to upgrade Node (nvm, homebrew, etc.)

#### Scenario: Permission denied errors (Linux/macOS)

- **WHEN** user gets permission errors during installation
- **THEN** troubleshooting section explains sudo use and alternative approaches
- **AND** links to npm permissions documentation provided

#### Scenario: IDE plugin not showing up

- **WHEN** plugin is installed but not visible in IDE
- **THEN** troubleshooting checklist is provided
- **AND** includes: reload IDE, clear cache, check plugin path, verify .claude/plugins folder
