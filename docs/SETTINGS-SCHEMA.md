# Settings Schema

Complete reference for `settings.json` agent configuration.

## Overview

`settings.json` configures which AI models Synaphex uses for each agent in the pipeline.

**Location**: `~/.synaphex/<project>/settings.json`

**Created**: Automatically when you run `/synaphex:create <project>`

## Schema

### Top-Level Structure

```json
{
  "version": 1,
  "createdAt": "2026-04-18T00:00:00Z",
  "agents": {
    "examiner": { ... },
    "researcher": { ... },
    "planner": { ... },
    "coder": { ... },
    "answerer": { ... },
    "reviewer": { ... }
  }
}
```

### Agent Configuration

Each agent has the same schema:

```json
{
  "provider": "claude",
  "model": "claude-opus-4-7",
  "think": true,
  "effort": 3,
  "mode": "delegated"
}
```

#### Fields

| Field      | Type    | Required | Values                                         |
| ---------- | ------- | -------- | ---------------------------------------------- |
| `provider` | string  | Yes      | "claude", "gemini", "openai"                   |
| `model`    | string  | Yes      | e.g., "claude-opus-4-7", "gemini-3.1-pro-high" |
| `think`    | boolean | Yes      | true, false                                    |
| `effort`   | integer | Yes      | 0, 1, 2, 3, 4                                  |
| `mode`     | string  | Yes      | "direct", "delegated"                          |

### Provider-Specific Models

#### Anthropic (Claude)

**Direct API** (use in CLI, servers):

- `claude-opus-4-7` — Most capable, full thinking support
- `claude-sonnet-4-6` — Balanced, full thinking support
- `claude-haiku-4-5-20251001` — Fast, no thinking support

**Antigravity IDE** (delegated mode):

- `claude-opus-4-6-thinking` — Opus with thinking
- `claude-sonnet-4-6-thinking` — Sonnet with thinking

**VS Code Extensions**:

- `claude-opus-4-6-vscode` — Claude Code extension
- `claude-sonnet-4-6-vscode` — Claude Code extension
- `claude-haiku-4-5-vscode` — Claude Code extension
- `copilot-claude-haiku-4-5` — GitHub Copilot Chat

#### Google Gemini

- `gemini-3.1-pro-high` — Highest quality
- `gemini-3.1-pro-low` — Faster
- `gemini-3-flash` — Very fast
- `copilot-gemini-3-flash` — Copilot Chat integration
- `copilot-gemini-3.1-pro` — Copilot Chat integration

#### OpenAI

- `gpt-oss-120b` — Open-source option
- `copilot-gpt-4o` — Copilot Chat
- `copilot-gpt-5-mini` — Copilot Chat
- `copilot-gpt-5.2` — Copilot Chat with thinking
- Various Copilot Chat models

### Thinking Support

#### `think` Field

Boolean indicating whether the model uses extended thinking.

**Rules**:

- ✓ `true` allowed for: Opus, Sonnet, Gemini Pro, GPT-5.2
- ✗ `false` required for: Haiku, Gemini Flash, GPT-4o, Copilot variants (except noted above)

#### `effort` Field

Integer from 0-4 controlling thinking depth (when `think: true`).

**Mapping**:

- `0` — No thinking / disabled
- `1` — Light thinking (5,000 budget tokens)
- `2` — Medium thinking (15,000 budget tokens)
- `3` — Heavy thinking (25,000 budget tokens)
- `4` — Maximum thinking (32,000 budget tokens)

**Constraints**:

- `effort > 0` requires `think: true`
- `effort` max depends on model (see Model Capabilities table)

### Mode Field

#### "direct"

AI API called directly by Synaphex (used in CLI, servers).

```json
{
  "provider": "anthropic",
  "model": "claude-opus-4-7",
  "mode": "direct"
}
```

#### "delegated"

AI model accessed through IDE or platform (VS Code, Antigravity, Copilot).

```json
{
  "provider": "claude",
  "model": "claude-opus-4-6-thinking",
  "mode": "delegated"
}
```

## Default Configuration

When you create a new project, Synaphex applies sensible defaults based on agent role:

| Agent      | Model                      | Think | Effort |
| ---------- | -------------------------- | ----- | ------ |
| examiner   | claude-sonnet-4-6-thinking | false | 2      |
| researcher | claude-sonnet-4-6-thinking | true  | 3      |
| planner    | claude-opus-4-6-thinking   | true  | 3      |
| coder      | claude-sonnet-4-6-thinking | false | 2      |
| answerer   | gemini-3-flash             | false | 1      |
| reviewer   | claude-opus-4-6-thinking   | true  | 3      |

**Rationale**:

- Fast agents (examiner, coder) use Sonnet without thinking
- Deep thinking agents (planner, reviewer) use Opus with thinking
- Research uses Sonnet with thinking for comprehensive exploration
- Answering uses Flash for quick responses

## Customization Examples

### Minimize Cost (Fast Agents)

Use Haiku for all agents:

```json
{
  "examiner": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "think": false,
    "effort": 0,
    "mode": "direct"
  },
  "coder": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "think": false,
    "effort": 0,
    "mode": "direct"
  }
  // ... other agents
}
```

### Maximize Quality (Heavy Thinking)

Use Opus with maximum thinking:

```json
{
  "planner": {
    "provider": "anthropic",
    "model": "claude-opus-4-7",
    "think": true,
    "effort": 4,
    "mode": "direct"
  },
  "reviewer": {
    "provider": "anthropic",
    "model": "claude-opus-4-7",
    "think": true,
    "effort": 4,
    "mode": "direct"
  }
  // ... other agents
}
```

### VS Code Integration (Delegated Mode)

Use Claude Code extension models:

```json
{
  "examiner": {
    "provider": "claude",
    "model": "claude-sonnet-4-6-vscode",
    "think": false,
    "effort": 2,
    "mode": "delegated"
  },
  "planner": {
    "provider": "claude",
    "model": "claude-opus-4-6-vscode",
    "think": true,
    "effort": 3,
    "mode": "delegated"
  }
  // ... other agents
}
```

### Multi-Provider Mix

Use different providers for different agents:

```json
{
  "examiner": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "think": false,
    "effort": 2,
    "mode": "direct"
  },
  "researcher": {
    "provider": "google",
    "model": "gemini-3.1-pro-high",
    "think": true,
    "effort": 3,
    "mode": "direct"
  },
  "planner": {
    "provider": "anthropic",
    "model": "claude-opus-4-7",
    "think": true,
    "effort": 3,
    "mode": "direct"
  }
  // ... other agents
}
```

## Model Capabilities Reference

| Model               | Provider | Thinking | Max Effort |
| ------------------- | -------- | -------- | ---------- |
| claude-opus-4-7     | Claude   | Yes      | 4          |
| claude-sonnet-4-6   | Claude   | Yes      | 4          |
| claude-haiku-4-5    | Claude   | No       | 0          |
| gemini-3.1-pro-high | Gemini   | Yes      | 4          |
| gemini-3.1-pro-low  | Gemini   | No       | 0          |
| gemini-3-flash      | Gemini   | No       | 0          |
| gpt-oss-120b        | OpenAI   | No       | 0          |
| copilot-gpt-5.2     | OpenAI   | Yes      | 3          |
| copilot-gpt-4o      | OpenAI   | No       | 0          |

## Validation

Synaphex validates settings on project load and task execution.

### Common Errors

#### Error: "Model does not support thinking"

```
Model 'claude-haiku-4-5-20251001' does not support thinking (think: true)
```

**Fix**: Set `think: false` for Haiku or switch to Opus/Sonnet.

#### Error: "Effort > 0 requires think: true"

```
Effort > 0 requires think: true for effort level 2
```

**Fix**: Either set `think: true` or reduce `effort` to 0.

#### Error: "Effort exceeds model maximum"

```
Effort must be between 0 and 0 for 'claude-haiku-4-5-20251001', got 2
```

**Fix**: Reduce effort to 0 or use a model supporting thinking.

## Editing settings.json

You can edit `settings.json` directly in any text editor:

```bash
# VS Code
code ~/.synaphex/my-project/settings.json

# nano
nano ~/.synaphex/my-project/settings.json

# vim
vim ~/.synaphex/my-project/settings.json
```

Changes take effect on the next task execution.

## Command-Line Overrides

Currently, settings must be edited in the JSON file. IDE integrations may support per-task overrides in future versions.

See [Troubleshooting Guide](./TROUBLESHOOTING.md) for help with settings issues.
