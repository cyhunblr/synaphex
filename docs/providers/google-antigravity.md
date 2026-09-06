# Google (Antigravity)

Google's support is **asymmetric**, and the asymmetry is the most important
thing on this page:

| Role | Status |
| --- | --- |
| **MCP host** — Antigravity runs Synaphex | **Supported** |
| **Agent target** — Synaphex runs agents on Antigravity | **Not currently executable** |

You can use Synaphex from Antigravity today. You cannot currently run an agent
*on* it.

Google means **Antigravity** (`agy`). Gemini CLI is not a supported Synaphex
runtime.

## Antigravity as an MCP host

Supported and verified end to end.

`synaphex install` registers Synaphex through Antigravity's own official MCP
management commands. Host identity is **provider-only**: the registration says
`google`.

**Minimum version for host registration:** `agy` 1.1.26. See
[compatibility](../reference/compatibility.md) for the canonical version matrix.

### Headless approval behaviour

Running `agy` in headless mode auto-denies MCP tool calls unless an approval
mechanism is in play — Synaphex tool calls included. That is Antigravity's own
permission UX, not a Synaphex setting, and it applies to every MCP server it
hosts.

If you hit it, consult Antigravity's documentation for how it expects tool
approvals to be granted in your setup. This guide deliberately does not
recommend changing global permission settings on your behalf.

## Google as an agent target

```jsonc
// NOT EXECUTABLE in v0.1 — shown only to mark the boundary.
{
  "researcher": {
    "status": "configured",
    "provider": "google",
    "surface": "cli",
    "model": "some-model"
  }
}
```

New authoring rejects that configuration. A historically persisted value is
still parsed and displayed unchanged, but invocation **fails closed**: no
provider runs, and the invocation reports
`PROVIDER_EXECUTION_POLICY_UNSUPPORTED`.

### Why it fails closed

When Synaphex runs an agent, it asks the provider runtime to enforce an
execution policy for that single invocation — what the agent may modify, and
whether it may reach the network.

OpenAI and Anthropic runtimes expose controls that make that enforceable per
invocation. Synaphex could not identify an equivalent invocation-scoped
mechanism in Antigravity.

> Synaphex refuses to run an agent whose execution policy it cannot enforce.
> Running it anyway would mean claiming a source and network guarantee it could
> not actually deliver.

This is deliberate fail-closed behaviour, not an unfinished integration. It is
the same principle that makes CODER stage its work and makes apply refuse on
drift: where a guarantee cannot be enforced, Synaphex declines rather than
pretending.

Configure `openai` or `anthropic` targets instead, and keep using Antigravity as
your host.

## Not supported

| | Status |
| --- | --- |
| Gemini CLI as a runtime | Not supported |
| Antigravity IDE as a host surface | Not a Synaphex host integration |
| `google` + `vscode` target | Not supported |

## Authentication

> Synaphex does not store, request, or manage provider credentials. Authenticate
> with Antigravity itself.

## Related

- [OpenAI (Codex)](openai-codex.md)
- [Anthropic (Claude Code)](anthropic-claude.md)
- [Providers and routing](../concepts/providers-and-routing.md)
- [First setup](../getting-started/first-setup.md)
