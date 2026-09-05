# First setup

Installing the npm package puts Synaphex on your machine. This step connects it
to your provider runtimes and prepares its configuration.

## Run the installer

```bash
synaphex install
```

The installer asks which provider runtimes should host Synaphex, shows you what
it intends to do, and changes nothing until you confirm:

```text
Configure OpenAI? [y/N] y
Configure Anthropic? [y/N] y
Configure Google? [y/N] n

Synaphex will configure:

  OpenAI
  Anthropic

Synaphex will not install provider software or manage authentication.

Proceed? [y/N] y
Synaphex installation

Anthropic       configured
OpenAI          configured

Synaphex state    ready
```

Answering `n` at the confirmation prompt leaves your system untouched.

### What the installer does

1. Detects which supported provider runtimes are installed, by running their
   version commands directly.
2. Builds a plan. Building the plan changes nothing.
3. Asks you to confirm.
4. Registers the Synaphex MCP server with each selected provider, using that
   provider's own official MCP commands.
5. Creates or refreshes Synaphex's configuration files under `~/.synaphex`.

Each provider is handled independently. If one fails, the others still complete
and you get a per-provider summary rather than an all-or-nothing result.

### What it does not do

- It does not install Codex, Claude Code, Antigravity, VS Code, or extensions.
- It does not log you in, read tokens, or store credentials.
- It does not overwrite an MCP registration it does not own, even one named
  `synaphex`. That is reported as a conflict and left in place.
- It does not configure any agent. Registering a host and configuring an agent
  are separate decisions.

## Provider hosts

There are three, identified by provider runtime alone:

| Host | Runtime |
| --- | --- |
| OpenAI | `codex` |
| Anthropic | `claude` |
| Google | `agy` (Antigravity) |

There is no CLI-versus-VS-Code choice. A provider's CLI and its VS Code
extension share a single MCP registration, so Synaphex registers once per
provider and does not claim to know which one launched it.

## Authenticate your providers

Synaphex expects the providers you selected to already be usable.

Sign in to each provider runtime using its own mechanism, before you expect
agent execution to work. Synaphex never stores, reads, or forwards credentials,
and no Synaphex configuration file has a field for one.

Registration itself does not require authentication, so `synaphex install` can
succeed before you have signed in.

## Configuration files

Setup creates three files in `~/.synaphex`:

| File | Purpose |
| --- | --- |
| `agent_config.jsonc` | Which provider and model each agent runs on. |
| `agent_behavior.jsonc` | Which result fields each agent may persist. |
| `rules.jsonc` | Global permissions for agent-to-agent calls and actions. |

### `agent_config.jsonc`

Maps each of the six agents to an execution target. Every agent starts
`unconfigured`, and installing a provider host configures none of them — that
choice is yours.

```jsonc
{
  "version": 1,
  "agents": {
    "researcher": {
      "status": "configured",
      "provider": "openai",
      "surface": "cli",
      "model": "your-model-id"
    }
  }
}
```

Rules that matter:

- Every configured agent must name a `model`. Synaphex never invents one.
- `surface` must be `"cli"`. A `"vscode"` target is refused before execution
  rather than quietly redirected.
- `provider` may be `openai`, `anthropic`, or `google` — but `google` execution
  currently fails closed, so an agent targeting it will not run.
- `settings` is optional. Omit it to use the provider's own defaults.

### `agent_behavior.jsonc`

Lists the `outputFields` each agent is allowed to persist. A result carrying a
field that is not listed is rejected before anything is written, so narrowing
this list narrows what an agent can record.

It cannot widen anything. Role contracts are fixed in code and are not
configurable here.

### `rules.jsonc`

Controls whether one agent may call another, and whether a requested action may
run. Decisions are `allow`, `ask`, or `deny`, resolved most-specific-first:

```text
task  >  project  >  global  >  default deny
```

Anything not matched by a rule is denied. An `ask` decision requires a one-time
approval and never becomes a standing grant. Rules cannot widen a role contract:
a prohibition fixed in code stays denied even if a rule says `allow`.

## How these files are maintained

Ownership is split, and it is worth knowing before your first reinstall:

- **Values are yours.** Reinstalling preserves them exactly.
- **Comments are Synaphex's.** They are regenerated from the current templates
  on every `synaphex install`, so they stay accurate as the product changes.

The practical consequence: formatting, key ordering, and comments may change on
reinstall, and **comments you add yourself are not preserved**. Your semantic
values are.

If a configuration file is invalid — broken syntax, an unknown field, or an
agent configured without a model — Synaphex **fails closed**. It reports the
problem and leaves your file exactly as it is, rather than replacing your work
with defaults.

## Verify it worked

Ask your provider to list its MCP servers; `synaphex` should appear. Then start
a session with that provider and ask it to call a read-only Synaphex tool, for
example `synaphex_get_agent_config`. A successful call confirms the provider can
launch and talk to Synaphex.

## Next

- [First workflow](first-workflow.md) — run a task end to end.
