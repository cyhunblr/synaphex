# OpenAI (Codex)

OpenAI participates in Synaphex in two independent ways. Keep them separate:

| Role | Status |
| --- | --- |
| **MCP host** — Codex runs Synaphex | Supported |
| **Agent target** — Synaphex runs agents on Codex | Supported, `cli` only |

You can use either without the other.

## OpenAI as an MCP host

`synaphex install` registers the Synaphex MCP server through Codex's own
official MCP management commands. You do not register it by hand.

Host identity is **provider-only**: the registration says `openai`, and nothing
more. Codex's CLI and its VS Code extension share one MCP registration, so both
can launch the same Synaphex server — and Synaphex does not infer, or claim to
know, which one did.

**Minimum version for host registration:** `codex` 0.153.0. That is the version
whose MCP registration behaviour was verified directly.

## OpenAI as an agent target

```jsonc
{
  "coder": {
    "status": "configured",
    "provider": "openai",
    "surface": "cli",
    "model": "gpt-5.6-sol"
  }
}
```

`openai` + `cli` is executable. Synaphex launches the Codex CLI as an external
process for that invocation.

`openai` + `vscode` is **not** an executable target. Configuring it is accepted
by the schema and then refused at routing, before any provider runs.

### From the VS Code extension

If Codex's VS Code extension launched Synaphex, and an agent targets
`openai` + `cli`, Synaphex starts the **Codex CLI as a separate process**.

It does not reuse the open VS Code session or panel. The editor conversation and
the agent invocation are unrelated processes.

## Execution policy

When Synaphex runs an agent, it asks the provider to enforce an execution policy
for that single invocation: what the agent may modify, and whether it may reach
the network.

Codex exposes controls that let Synaphex enforce that policy per invocation, so
`openai` targets execute normally. Source-modification scope comes from the
agent's role — CODER works in an isolated staging clone, everyone else is
read-only — and network access is governed by the `network` action rule.

## Authentication

> Synaphex does not store, request, or manage provider credentials. Authenticate
> with the Codex CLI itself.

`synaphex install` does not install Codex, sign you in, or read your
credentials. Registration works whether or not you are currently signed in;
execution requires that you are.

## Related

- [Anthropic (Claude Code)](anthropic-claude.md)
- [Google (Antigravity)](google-antigravity.md)
- [Agent configuration](../configuration/agent-config.md)
- [Providers and routing](../concepts/providers-and-routing.md)
- [First setup](../getting-started/first-setup.md)
