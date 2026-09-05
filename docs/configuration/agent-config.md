# Agent configuration

`~/.synaphex/agent_config.jsonc` decides **where each agent runs**. It never
decides what an agent may do — that is the role contract, fixed in code.

## Structure

```jsonc
{
  "version": 1,
  "agents": {
    "questioner": { "status": "unconfigured" },
    "researcher": { "status": "unconfigured" },
    "examiner": { "status": "unconfigured" },
    "planner": { "status": "unconfigured" },
    "coder": { "status": "unconfigured" },
    "reviewer": { "status": "unconfigured" }
  }
}
```

That is exactly what a fresh install writes. Agent keys are **lowercase**, and
all six begin unconfigured.

> Installing a provider host does **not** configure any agent. Registering
> where Synaphex runs and choosing where an agent runs are separate decisions.

## Agent states

| State | Shape | Meaning |
| --- | --- | --- |
| Unconfigured | `{ "status": "unconfigured" }` | The agent cannot be invoked |
| Configured | `{ "status": "configured", ... }` | Ready to run on the given target |
| Removed | `{ "status": "removed", ... }` | Its provider configuration was removed |

There is no `null` form; an unconfigured agent is an object with a `status`.

## Configuring an agent

```jsonc
{
  "version": 1,
  "agents": {
    "researcher": {
      "status": "configured",
      "provider": "openai",
      "surface": "cli",
      "model": "gpt-5.6-sol"
    }
  }
}
```

### Fields

| Field | Required | Valid values | If invalid |
| --- | --- | --- | --- |
| `status` | Yes | `unconfigured`, `configured`, `removed` | Refused |
| `provider` | When configured | `openai`, `anthropic`, `google` | Refused |
| `surface` | When configured | `cli` (see below) | Refused |
| `model` | When configured | Any non-empty provider model id | Refused |

`provider` names the runtime that **executes** the agent. It is unrelated to
which provider is hosting Synaphex — an Anthropic host routinely runs agents on
OpenAI.

### `model` is always required

Every configured agent must name a model. Synaphex never picks one, and the
installer never assigns one. An agent configured without a model is refused
before anything runs.

Model identifiers belong to your provider and change over time. Use one your
provider currently supports.

### `surface` in v0.1

`cli` is the only executable surface.

`vscode` is accepted by the configuration schema, but an agent configured that
way **cannot run**: the invocation is refused at routing, before any provider is
contacted (`AGENT_TARGET_SURFACE_UNSUPPORTED`).

> Do not configure `surface: "vscode"`. Synaphex will not silently redirect it
> to a CLI — rewriting your configuration would change your intent — so the
> agent simply fails when you invoke it.

### Optional settings

`settings` exists in the domain model, but **v0.1 supports no optional settings
for any provider**. Supplying one is refused (`INVALID_AGENT_SETTING`).

Omit the field. Agents run with their provider's own defaults.

## Examples

### A mixed configuration

Different agents on different providers is normal and often desirable:

```jsonc
{
  "version": 1,
  "agents": {
    "questioner": { "status": "unconfigured" },
    "researcher": {
      "status": "configured",
      "provider": "anthropic",
      "surface": "cli",
      "model": "claude-model-id"
    },
    "examiner": { "status": "unconfigured" },
    "planner": {
      "status": "configured",
      "provider": "anthropic",
      "surface": "cli",
      "model": "claude-model-id"
    },
    "coder": {
      "status": "configured",
      "provider": "openai",
      "surface": "cli",
      "model": "gpt-5.6-sol"
    },
    "reviewer": { "status": "unconfigured" }
  }
}
```

You do not have to configure every agent. Configure the ones you intend to
invoke.

### Google is not an executable target

Google is a fully supported **MCP host**, but not currently an executable agent
target. This configuration is accepted by the schema and then **fails when
invoked**:

```jsonc
// NOT EXECUTABLE in v0.1 — shown only to mark the boundary.
{
  "coder": {
    "status": "configured",
    "provider": "google",
    "surface": "cli",
    "model": "some-model"
  }
}
```

See [Google / Antigravity](../providers/google-antigravity.md) for why.

## When a provider is removed

Removing a provider's configuration does not leave agents pointing at a runtime
that is no longer configured. Affected agents move to a `removed` state that
records what happened:

```jsonc
{
  "coder": {
    "status": "removed",
    "reason": "provider_removed",
    "previousProvider": "openai"
  }
}
```

A `removed` agent behaves like an unconfigured one — it cannot be invoked — but
tells you *why* rather than looking like you never set it up. Configure it again
to restore it.

## No credentials, ever

No field in this file holds an API key, token, or password, and none will be
added. Authentication belongs to your provider runtimes.

## Next

- [Agent behavior](agent-behavior.md)
- [Rules](rules.md)
- Related: [providers and routing](../concepts/providers-and-routing.md)
- Previous: [configuration overview](overview.md)
