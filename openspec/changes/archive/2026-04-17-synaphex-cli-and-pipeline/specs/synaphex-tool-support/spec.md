## ADDED Requirements

**OpenSpec Alignment**: Like [OpenSpec](https://github.com/Fission-AI/OpenSpec), which supports 25+ tools and provides setup/configuration mechanisms, Synaphex provides multi-provider support and tool configuration without requiring users to manually manage installations.

### Requirement: Multi-provider agent support

The system SHALL support multiple AI provider backends for agents, not just Claude. Supported providers include Claude (Anthropic), Gemini (Google), and OpenAI. Each agent configuration specifies a provider, and the system routes execution to the appropriate backend.

#### Scenario: Configure agent with different provider

- **WHEN** user runs `/synaphex/settings myproject` and configures Coder with provider=Gemini

- **THEN** system accepts the provider and stores it in `settings.json`

- **AND** when pipeline runs, Coder uses Gemini API instead of Claude

#### Scenario: Supported providers

- **WHEN** user views provider options during `/synaphex/settings`

- **THEN** available providers are: Claude, Gemini, OpenAI

- **AND** each provider has its own model list and capability matrix

### Requirement: Delegated vs. Direct execution modes

The system SHALL support two execution modes: **Direct** (Synaphex calls APIs directly using credentials) and **Delegated** (IDE/tool returns prompt to user's IDE for that IDE's model to execute). This enables integration with IDEs like Antigravity, VSCode with Copilot, etc.

#### Scenario: Direct mode with Claude API

- **WHEN** agent is configured with mode=direct and provider=Claude

- **THEN** Synaphex calls Anthropic API directly using stored ANTHROPIC_API_KEY

- **AND** execution is immediate and transparent to the IDE

#### Scenario: Delegated mode with IDE model

- **WHEN** agent is configured with mode=delegated (e.g., for Antigravity)

- **THEN** Synaphex returns a formatted prompt to the IDE

- **AND** IDE executes the prompt using its native model (Gemini in Antigravity)

- **AND** IDE returns result to Synaphex for pipeline continuation

#### Scenario: Mode-aware model selection

- **WHEN** user configures agent with mode=delegated

- **THEN** available models are IDE-specific (e.g., Gemini models for Antigravity)

- **AND** system validates provider+mode+model compatibility

### Requirement: Per-provider capability matrix

The system SHALL maintain a capability matrix for each provider, defining which models support extended thinking and effort levels. Models are validated against this matrix during settings configuration.

#### Scenario: Claude capability matrix

- **WHEN** user configures Claude agent

- **THEN** available models include: Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5

- **AND** capability mapping:
  - Opus 4.6: thinking=true, adaptiveThinking=true, effort 0-4
  - Sonnet 4.6: thinking=true, adaptiveThinking=true, effort 0-4
  - Haiku 4.5: thinking=true, adaptiveThinking=false, effort via budget_tokens only

#### Scenario: Gemini capability matrix

- **WHEN** user configures Gemini agent

- **THEN** available models are Gemini-native (e.g., Gemini 2.0 Pro)

- **AND** capability constraints are provider-specific

#### Scenario: Validation against capability matrix

- **WHEN** user attempts invalid model/thinking/effort combo

- **THEN** system rejects configuration with explanation of what's supported

- **AND** user is prompted to select compatible values

### Requirement: Automated setup and configuration wizard

The system SHALL provide `/synaphex/setup <platform>` command that automatically configures Synaphex for the target IDE/platform, registering MCP servers, linking skills, and creating plugin bundles.

#### Scenario: Setup for Claude Code

- **WHEN** user runs `npx synaphex setup claude`

- **THEN** system:
  1. Detects Node.js version and paths
  2. Configures MCP server in `~/.claude.json` or `.mcp.json`
  3. Links plugin bundle to `~/.claude/plugins/synaphex`
  4. Registers skills in `~/.claude/commands/synaphex/`
  5. Confirms setup complete and prompts IDE reload

#### Scenario: Setup for Copilot/VSCode

- **WHEN** user runs `npx synaphex setup copilot`

- **THEN** system configures for VSCode environment with Copilot integration

- **AND** MCP server registered in VSCode settings

#### Scenario: Setup for Antigravity

- **WHEN** user runs `npx synaphex setup antigravity`

- **THEN** system configures for Antigravity IDE integration

- **AND** MCP server configured with delegated mode defaults

- **AND** Gemini-compatible models pre-selected if available

### Requirement: Tool credential management

The system SHALL support secure storage and retrieval of provider credentials (API keys) without embedding them in configuration files. Credentials are read from environment variables or secure storage.

#### Scenario: Claude API key configuration

- **WHEN** Synaphex runs in direct mode with Claude

- **THEN** system checks ANTHROPIC_API_KEY environment variable

- **AND** if missing, user is prompted to provide it or set it in IDE settings

- **AND** credentials are not stored in `settings.json`

#### Scenario: Gemini API key configuration

- **WHEN** Synaphex runs in direct mode with Gemini

- **THEN** system checks GOOGLE_API_KEY environment variable

- **AND** if missing, user is prompted via setup wizard

#### Scenario: Fallback to IDE credentials

- **WHEN** running in delegated mode

- **THEN** no separate credentials required; IDE handles authentication

- **AND** Synaphex returns prompt to IDE without needing API keys

### Requirement: Provider and model discovery

The system SHALL discover available providers and models at runtime, allowing dynamic updates as new providers or models become available.

#### Scenario: List available providers

- **WHEN** user accesses `/synaphex/settings` without saved config

- **THEN** system lists all supported providers (Claude, Gemini, OpenAI)

- **AND** user selects one to continue configuration

#### Scenario: List models for selected provider

- **WHEN** user selects provider during settings

- **THEN** system queries provider's capability matrix

- **AND** displays all available models with labels and capability summary

- **AND** user selects model, which unlocks appropriate thinking/effort options

### Requirement: Plugin and skill installation paths

The system SHALL provide multiple installation paths for maximum resilience across IDE versions, automatically detecting and configuring the correct path for the user's IDE.

#### Scenario: Plugin bundle installation (Modern)

- **WHEN** setup runs for Claude Code v4.6+

- **THEN** system installs plugin bundle at `~/.claude/plugins/synaphex`

- **AND** registers via `~/.claude.json` under mcpServers

#### Scenario: Standalone commands registration (Fallback A)

- **WHEN** plugin bundle installation unavailable

- **THEN** system registers skills at `~/.claude/commands/synaphex/`

- **AND** slash commands discovered via modern flat directory structure

#### Scenario: Legacy skills directory (Fallback B)

- **WHEN** Claude Code pre-v4.6 or alternative IDE

- **THEN** system registers skills at `~/.claude/skills/synaphex/`

- **AND** slash commands discovered via legacy directory structure

### Requirement: Post-setup verification

The system SHALL verify that setup completed successfully by checking for required files and MCP server registration.

#### Scenario: Verify setup completion

- **WHEN** setup wizard finishes

- **THEN** system checks:
  1. MCP server registered in config file
  2. Plugin directory created (if applicable)
  3. Skills linked or registered
  4. Node.js path accessible

- **AND** confirms "✨ SETUP COMPLETE! Reload your IDE."

#### Scenario: Detect setup issues

- **WHEN** verification finds missing pieces

- **THEN** system reports detailed error (e.g., "MCP server not found in ~/.claude.json")

- **AND** suggests remediation steps
