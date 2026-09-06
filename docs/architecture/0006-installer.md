# ADR 0006: Installer and provider MCP registration

Status: accepted (Phase 6B1)

```text
npm install -g synaphex  →  synaphex install  →  provider host launches Synaphex MCP
```

## Public terminal surface

Exactly two commands: `synaphex install` and `synaphex uninstall`. Project, task
and agent operations stay MCP/provider-host operations — a terminal equivalent
would create a second orchestration surface. `synaphex-mcp-stdio` remains a
package-internal binary.

## Runtime audit (not assumptions)

Every mechanism below was verified against the installed runtime, in a
temporary HOME, without touching the developer's real configuration.

| runtime | version | official mechanism | config it writes |
| --- | --- | --- | --- |
| codex | 0.153.0 | `codex mcp add/list --json/remove` | `~/.codex/config.toml` `[mcp_servers.<name>]` |
| claude | 2.1.260 | `claude mcp add --scope user`, `remove -s user` | `~/.claude.json` `mcpServers` |
| agy | 1.1.26 | `agy mcp add/list/remove` | `~/.gemini/config/mcp_config.json` `mcpServers` |

All three honour a `HOME` override, which is what makes isolated testing
possible. Synaphex never hand-edits any of these files: the provider owns its
schema and may migrate it.

## Host matrix

> **Superseded by ADR 0007 (Phase 6B1.1).** The VS Code surfaces claimed below
> were withdrawn: a shared per-provider MCP registration cannot truthfully
> encode a VS Code host context. The supported matrix is CLI-only —
> `openai/cli`, `anthropic/cli`, `google/cli`.

```text
OpenAI     CLI            (VS Code withdrawn, see ADR 0007)
Anthropic  CLI            (VS Code withdrawn, see ADR 0007)
Google     CLI            (Antigravity / agy)
```

No Gemini CLI, no Antigravity IDE. An audit test asserts no Gemini identifier
appears anywhere in the installer.

**Capability distinction:** Synaphex being able to *call* Antigravity as an
agent provider (an executor concern) is not the same capability as Antigravity
*hosting* Synaphex over MCP (this concern). Hosting is supported; agent
execution is unavailable because its invocation-scoped policy cannot currently
be enforced. See ADR 0011.

## VS Code surfaces are covered by the CLI registration

Neither CLI offers a VS Code-specific MCP scope, so the question was whether the
extensions read the CLI config. Inspecting the installed extensions settled it:

```text
anthropic.claude-code  reads ~/.claude.json  mcpServers
openai.chatgpt         reads CODEX_HOME/.codex  mcp_servers
```

Both share their CLI's global configuration. Neither contributes an MCP setting
of its own, and Synaphex therefore never edits VS Code's `settings.json` or
`mcp.json` — that is not a verified mechanism for these extensions.

A consequence had to be handled honestly: the registration name is a single key
in one shared config, and registering `--host-surface vscode` after
`--host-surface cli` **replaces** the first entry (verified directly). Two
distinct host contexts cannot coexist for one provider.

Phase 6B1 first handled this by collapsing a both-surfaces selection onto the
CLI registration. ADR 0007 replaced that with the stricter and more honest
answer: since no VS Code host context can be truthfully encoded at all, the VS
Code surface is simply unsupported, and the MCP server fails closed if launched
with one.

## Launcher: absolute interpreter, absolute entrypoint

Registration does **not** use the npm bin shim. A shim starts with
`#!/usr/bin/env node`, which resolves whatever `node` is first on the host's
PATH — and a GUI-launched VS Code often does not inherit the install-time shell
PATH. This was reproduced: under a PATH where an old system Node won, the shim
died with a `SyntaxError` before the transport opened, while
`absolute node + absolute script` started cleanly.

So the launcher is `process.execPath` plus the entrypoint resolved from the
installed package's own location — never a build directory, never a source
checkout, never `node_modules`. A missing entrypoint fails closed with
`SYNAPHEX_LAUNCHER_NOT_FOUND` rather than registering a dead path.

## Ownership fingerprint and collision policy

A registration is recognised as Synaphex-managed when its launcher points at a
Synaphex MCP entrypoint **and** carries exactly this surface's immutable host
context. The fingerprint is behavioural: no secret token, no credential.

```text
absent    → register
current   → no-op (no duplicate)
outdated  → refresh (Synaphex-owned, stale launcher or args)
foreign   → REFUSE, PROVIDER_MCP_REGISTRATION_CONFLICT, leave untouched
unknown   → refuse, report
```

An entry that has drifted to an unknown command is never overwritten by install
and never deleted by uninstall, no matter that it is named `synaphex`. This is
not hypothetical: the development machine carries a hand-written `synaphex`
entry pointing at `dist/index.js` with no host arguments, and the fingerprint
classifies it `foreign` exactly as intended.

## Host context is registration-time, never client-supplied

Every registration bakes in `--host-provider` and `--host-surface`. An MCP
client cannot supply or override them, preserving the Phase-3A trust boundary.

## Plan before mutation

`detect → plan → confirm → mutate`. Building a plan performs no mutation, which
is what makes both the terminal flow and the tests deterministic; a cancelled
confirmation simply discards it. Business logic lives in `InstallationPlanner`
and `InstallerService`, so the installer is fully testable without a TTY — the
terminal layer only asks questions.

Detection is by direct runtime invocation with `shell: false`, never by
inferring availability from a configuration file.

## Partial failure

Registrations are independent: a host that fails neither aborts the remaining
work nor rolls back a host that already succeeded. Every host gets its own line,
so a partial success is reported as exactly that.

```text
OpenAI CLI        configured
Anthropic CLI     failed: ...
Google CLI        registration unsupported
```

Uninstall behaves the same way, and continues past an individual cleanup
failure.

## Synaphex-owned state

`synaphex install` prepares `~/.synaphex` directories and lets the managers
create their own defaults. Every managed file is written with an exclusive
atomic create, so reinstall never overwrites a user value.

Registering a provider host deliberately configures **no** agent. Provider host
installation and logical agent configuration are separate concerns:
`agent_config.jsonc` stays authoritative, unconfigured agents stay unconfigured,
and no model is invented because a host became available.

## Installation manifest

`state/installation.json` records provider, surface, registration name, the
registered launcher argv and a timestamp — no token, credential or secret. It
tells `uninstall` where to look, but is **not** authority for deletion: the
external registration must still match the ownership fingerprint, so a stale
manifest can never cause a foreign server to be removed.

## What the installer never does

It never installs provider CLIs, VS Code, extensions or auth helpers; never logs
in or out; never reads, stores or copies credentials; never invokes a model
(only version probes and MCP management commands are issued); and never uses a
shell — arguments are structured arrays with `shell: false`, output is bounded,
and provider stderr is summarised rather than dumped.

## Verification

The registered launcher is spawned as a provider host would, from `/`, the
system temp directory and an unrelated project, with a minimal environment (no
`NODE_PATH`, no source checkout). It completes MCP `initialize` and `tools/list`
and serves all **29** tools in every case, for every supported host surface.

The three real runtimes each accept the generated registration in an isolated
HOME, round-trip the exact launcher and host context, treat re-registration as a
no-op, and remove cleanly.

## MCP surface

Unchanged at **29** tools. Installation is a terminal bootstrap operation,
deliberately outside MCP.
