# Anthropic (Claude Code)

Anthropic participates in Synaphex in two independent ways:

| Role | Status |
| --- | --- |
| **MCP host** — Claude Code runs Synaphex | Supported |
| **Agent target** — Synaphex runs agents on Claude Code | Supported, `cli` only |

## Anthropic as an MCP host

`synaphex install` registers Synaphex through Claude Code's own official MCP
management commands, at user scope.

Host identity is **provider-only**: the registration says `anthropic`. Claude
Code's CLI and its VS Code extension read the same user-scope configuration, so
either can launch the same Synaphex server, and Synaphex does not infer which
one did.

**Minimum version for host registration:** `claude` 2.1.260 — the version whose
MCP registration behaviour was verified directly.

## Anthropic as an agent target

```jsonc
{
  "planner": {
    "status": "configured",
    "provider": "anthropic",
    "surface": "cli",
    "model": "claude-sonnet-4-5"
  }
}
```

This target currently declares no optional model settings in Synaphex. The
provider-native defaults apply.

Catalog version 1 recommends `claude-opus-5` and `claude-sonnet-5`. It also
supports the current Fable 5/5.1, Opus 4.5-4.8, Sonnet 4.5/4.6, and Haiku 4.5
identifiers listed in the [catalog evidence](../reference/model-catalog.md).
The official `claude-sonnet-4-5` alias remains supported for compatibility with
the accepted live-tested configuration.

`anthropic` + `cli` is executable. Synaphex launches the Claude Code CLI as an
external process for that invocation.

**Minimum version for agent execution:** `claude` 2.1.248. See
[compatibility](../reference/compatibility.md) for the canonical version matrix.

> The two minimums differ on purpose. Hosting Synaphex and executing agents are
> different capabilities with independently verified requirements. Meeting the
> registration minimum satisfies both.

`anthropic` + `vscode` is **not** an executable target. Existing persisted
values remain readable and are refused before any provider runs; new authoring
rejects them.

### From the VS Code extension

If Claude Code's VS Code extension launched Synaphex, and an agent targets
`anthropic` + `cli`, Synaphex starts the **Claude Code CLI as a separate
process**. It does not reuse the open editor session.

## Execution policy

Synaphex asks the provider to enforce an execution policy per invocation. Claude
Code exposes tool-permission and restriction controls that let Synaphex enforce
read-only versus workspace-write behaviour, and network access, for a single
invocation.

That is why `anthropic` targets execute: the guarantee Synaphex promises can
actually be enforced by the runtime.

## Authentication

> Synaphex does not store, request, or manage provider credentials. Authenticate
> with the Claude Code CLI itself.

`synaphex install` does not install Claude Code or sign you in.

## Related

- [OpenAI (Codex)](openai-codex.md)
- [Google (Antigravity)](google-antigravity.md)
- [Agent configuration](../configuration/agent-config.md)
- [Providers and routing](../concepts/providers-and-routing.md)
- [First setup](../getting-started/first-setup.md)
