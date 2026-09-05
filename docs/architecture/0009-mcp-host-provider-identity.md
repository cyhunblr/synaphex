# ADR 0009: MCP host identity is provider-only

Status: accepted (Phase 8B). Supersedes ADR 0007.

```text
MCP HOST      provider runtime identity only
AGENT TARGET  provider + execution surface
```

These are different questions and no longer share a type.

## What ADR 0007 got wrong

ADR 0007 restricted MCP hosts to CLI surfaces so that a registration asserting
`--host-surface cli` would be truthful. The Phase-8A audit disproved that
premise directly:

```text
Claude extension's own bundled binary → `mcp get synaphex` → ✔ Connected
                                        args: --host-surface cli

OpenAI extension's own bundled codex  → `mcp list --json` → same registration
                                        args: --host-surface cli
```

The Claude extension spawns its CLI with `settingSources:["user","project",
"local"]` — **including** the user scope where `synaphex` is registered. So a VS
Code session loads and connects to the CLI-labelled registration, and the server
asserts a surface that is false for that launch.

Restricting the *installer* never enforced anything, because the constraint does
not live in the installer.

## The decision

The UI origin of an MCP launch is not observable, so Synaphex stops claiming it.

```ts
interface McpHostContext {
  readonly provider: AgentProvider;   // no surface field exists
}
```

One registration is now correct from either launch origin:

```text
synaphex-mcp-stdio --host-provider openai
```

`--host-surface` is **refused**, not ignored — silently accepting it would let a
stale or hand-written registration keep implying a surface Synaphex no longer
honours.

## Routing

Every executable v0.1 route is a provider CLI route:

| host | target | outcome |
| --- | --- | --- |
| `X` | `X` / cli | `same_provider_configured_cli` |
| `X` | `Y` / cli | `cross_provider_cli` |
| any | any / vscode | `AGENT_TARGET_SURFACE_UNSUPPORTED` |

`same_provider_native` was **removed**, not deprecated: it required
`host.surface === "vscode"`, which is no longer expressible, so it could never
be produced again. Leaving it would advertise a capability that cannot exist.

## The silent downgrade is gone

The old router checked cross-provider *first*, so a `vscode` target on a
cross-provider route was rewritten to `cli` and executed — running something the
user never configured. The target-surface check now runs before anything else,
so a VS Code target fails deterministically before any availability lookup or
provider call.

Synaphex does **not** rewrite the user's configured surface from `vscode` to
`cli`. That would change their intent; it returns a precise error instead.

## Consequence: same-provider execution from a VS Code launch

If the VS Code extension launches Synaphex and an agent is configured for that
same provider's CLI, Synaphex spawns the provider **CLI as an external
process**. It does not reuse the interactive VS Code session. That is the
truthful v0.1 behaviour.

## Installer

Hosts are selected by provider; there is no surface question, because offering
one would offer a distinction the installer cannot deliver.

Ownership classification:

```text
--host-provider X                      current
--host-provider X --host-surface cli   outdated  → migrate (our own legacy shape)
Synaphex entrypoint, different path    outdated  → refresh (ordinary upgrade)
--host-surface vscode                  foreign   → never touched
different provider / extra flags       foreign   → never touched
foreign command                        foreign   → never touched
```

Only the exact legacy shape Synaphex itself wrote qualifies for migration.
Foreign-collision safety is unchanged.

The installation manifest keeps `surface` as an optional legacy field so old
records stay readable for migration; it is never authority.

## Google

Host `google` (Antigravity) remains supported and was real-tested in 6B2.
Target `google/cli` remains **recognised but not executable**: the Antigravity
policy resolver fails closed for every combination, which this phase did not
weaken.

## NativeHostExecutionUnavailable

Retained as defence in depth in the dispatcher, now unreachable through the
router. `InvalidProviderRouteError` still guards the unknown-provider default.
