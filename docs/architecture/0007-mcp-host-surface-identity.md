# ADR 0007: MCP host-surface identity

> **SUPERSEDED by ADR 0009 (Phase 8B).** The premise below -- that restricting
> registration to CLI makes the asserted surface truthful -- was disproved: both
> VS Code extensions load and connect to the CLI-labelled registration. MCP host
> identity is now provider-only.

Status: superseded (was Phase 6B1.1)

```text
Supported MCP host surfaces: CLI only.

openai/cli      supported
anthropic/cli   supported
google/cli      supported

*/vscode        unsupported — cannot be truthfully encoded
```

## The ambiguity

Phase 6B1 registered `--host-provider` and `--host-surface` into each
provider's MCP configuration. The audit then found that each provider keeps
**one** MCP registration store, shared by its CLI and its VS Code extension and
keyed by server name:

```text
openai     ~/.codex/config.toml      [mcp_servers.synaphex]   ← CLI + chatgpt extension
anthropic  ~/.claude.json            mcpServers.synaphex      ← CLI + claude-code extension
```

Registering `--host-surface vscode` after `--host-surface cli` **replaces** the
first entry (verified directly). One registration cannot truthfully be both
surfaces, so the claimed 5-target matrix was not honest.

## Evidence

All captured from the installed runtimes, in isolated HOMEs, with no model
invocation, authentication or network.

**Codex.** The VS Code extension bundles its *own* `codex` binary
(`0.151.0-alpha.7.2`) beside the CLI's `0.153.0`. Both send the same downstream
MCP client name:

```text
CLI       clientInfo.name = codex-mcp-client   (version 0.153.0)
VS Code   clientInfo.name = codex-mcp-client   (version 0.151.0-alpha.7.2)
```

Only the build version differs, which is a packaging artifact and not a surface
signal. The strings `codex-tui` and `codex_vscode` do exist in the binary, but
they are **API originator** values used for auth and telemetry — they never
appear in MCP `clientInfo`.

**Claude Code.** Captured live by registering an instrumented MCP server and
letting each runtime health-check it:

```text
CLI          clientInfo {name:"claude-code", version:"2.1.260"}   CLAUDE_CODE_ENTRYPOINT=sdk-cli
VS Code bin  clientInfo {name:"claude-code", version:"2.1.261"}   CLAUDE_CODE_ENTRYPOINT=claude-vscode
```

Identical client name. The only observed surface signal is the
`CLAUDE_CODE_ENTRYPOINT` environment variable.

## Why clientInfo cannot validate the surface

`clientInfo.name` is constant across surfaces for both providers, so it carries
no surface information at all — there is nothing to validate against. Version
strings differ, but they track builds, not surfaces, and would break on any
update.

`CLAUDE_CODE_ENTRYPOINT` does differ, but it is host-controlled ambient
environment rather than MCP protocol identity: anything spawning the server can
set it, and it exists for one provider only. Treating it as authority would
reintroduce exactly the inference the Phase-3A model rejects. It is diagnostic
information, not authority.

No PID, parent-process or terminal-vs-Electron heuristic was considered: the
architecture already rejected PID-derived host identity.

## Why multiple registrations are unsafe

Two differently-named entries *can* coexist:

```text
synaphex-cli      --host-surface cli
synaphex-vscode   --host-surface vscode
```

But neither runtime offers any per-surface enable, filter or scope. Verified
directly: `claude mcp list` from a **CLI** session lists *both* servers. A CLI
session would therefore connect to a server asserting `--host-surface vscode`,
and nothing in the protocol could detect the mismatch — the precise false host
identity the trust model forbids. Claude's `local|user|project` scopes and
Codex's global-only config are project scopes, not surface scopes.

## Decision (Outcome B)

Only the CLI surface can be truthfully represented, so the installer supports
CLI hosts only for v0.x. VS Code host registration is unsupported and deferred,
reported with a precise reason rather than silently relabelled as CLI.

Defence in depth: `SUPPORTED_HOST_COMBINATIONS` in the MCP entrypoint was
narrowed to the three CLI combinations, so the **server itself** fails closed if
launched with any `vscode` surface — even from a hand-written registration the
installer never produced.

```text
$ synaphex-mcp-stdio --host-provider anthropic --host-surface vscode
[synaphex-mcp] fatal: unsupported host combination: anthropic/vscode
```

## Callable target vs MCP host

These stay separate, and this decision touches only the second:

```text
MCP host surface   openai/cli, anthropic/cli, google/cli
callable target    openai, anthropic, google — CLI and VS Code targets both intact
```

An agent may still be configured with `surface: "vscode"` as an execution
target; a stdio protocol test continues to assert that a native VS Code target
fails closed through the production dispatch path, now from a CLI host.

## Does the HostRuntime model need revising?

No. `{provider, surface}` remains correct for the *callable target* domain,
where CLI and VS Code are genuinely different execution surfaces. The mismatch
is narrower than Outcome C: for MCP **host** identity, the real host is the
provider runtime, and its surface is not observable. Restricting the supported
host set expresses that without changing the type.

If a provider later ships per-surface MCP scoping or a distinguishable client
identity, VS Code hosts can be re-enabled by extending the supported set — no
architectural revision required.

## Google

Unchanged: `google/cli` only (Antigravity `agy`). No Antigravity IDE surface, no
Gemini CLI. The shared-surface ambiguity never applied here.

## Ownership semantics

Unchanged. Foreign registrations are refused, Synaphex-owned current ones are a
no-op, and Synaphex-owned outdated ones refresh safely. The ownership
fingerprint still requires the exact host context, so a stale `vscode`
registration from an earlier build classifies as `outdated` and is replaced.

## MCP surface

Unchanged at **29** tools.
