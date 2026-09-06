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
| `model` | When configured | A model in Synaphex's provider/surface catalog | Refused |
| `settings` | No | Settings declared for that exact model | Refused |

`provider` names the runtime that **executes** the agent. It is unrelated to
which provider is hosting Synaphex — an Anthropic host routinely runs agents on
OpenAI.

### `model` is always required

Every configured agent must name a model explicitly supported by this Synaphex
version for its provider and surface. The catalog is static and offline: it is
not a list of every provider model, and it does not inspect your account or
subscription. A missing or unknown model on an executable target is refused
before anything runs.

This version supports `gpt-5.6-sol` for `openai` + `cli` and
`claude-sonnet-4-5` for `anthropic` + `cli`.

### `surface` in v0.1

`cli` is the only executable surface.

`vscode` remains readable in historical configuration, but Configure does not
offer it as a target. An agent configured that way **cannot run**: invocation is
refused at routing before any provider is contacted
(`AGENT_TARGET_SURFACE_UNSUPPORTED`).

> Do not configure `surface: "vscode"`. Synaphex will not silently redirect it
> to a CLI — rewriting your configuration would change your intent — so the
> agent simply fails when you invoke it.

### Optional settings

Settings are scoped to one provider, surface and model. This version supports
one optional setting for `openai` + `cli` + `gpt-5.6-sol`:

```jsonc
"settings": { "reasoning_effort": "high" }
```

Allowed values are `low`, `medium`, `high`, and `xhigh`. Synaphex maps an
explicit value to Codex's `model_reasoning_effort` invocation override. If the
field or setting is omitted, no override is emitted and the provider's native
default applies. Anthropic's supported model currently exposes no optional
setting. Unknown names, invalid values, and settings copied to another model
are rejected.

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
      "model": "claude-sonnet-4-5"
    },
    "examiner": { "status": "unconfigured" },
    "planner": {
      "status": "configured",
      "provider": "anthropic",
      "surface": "cli",
      "model": "claude-sonnet-4-5"
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

Historical unknown model values are parsed and shown without being rewritten,
but fail executable-target validation. Configure preserves such a value until
you explicitly select a supported replacement.

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
