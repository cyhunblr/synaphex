# Architecture decisions

How to read and extend `docs/architecture/`.

## Development index

- [Architecture](architecture.md)
- [Repository structure](repository-structure.md)
- [Testing](testing.md)
- [CI](ci.md)
- [Releasing](releasing.md)
- **Architecture decisions**

## How to read ADRs

> **ADRs preserve decision history. Current implementation plus the latest applicable ADR define the current system.**

Three rules follow from that:

1. **Later ADRs supersede earlier conflicting ones.** ADR 0009 explicitly supersedes ADR 0007, and says so in its status line.
2. **Where historical ADR prose conflicts with current code, the code is authoritative** for *what the system does today*.
3. **That does not make a superseded ADR worthless.** It records why a decision was made and, just as usefully, why it was later found wrong. ADR 0009 opens with "What ADR 0007 got wrong" — that reasoning is the most valuable part of the pair, and deleting 0007 would destroy it.

Do not treat an ADR as stale merely because it is old. Check its status line first.

## Current ADRs

| # | Title | Status | Governs |
| --- | --- | --- | --- |
| [0001](../architecture/0001-google-cli-runtime.md) | Google CLI runtime is Antigravity CLI | Accepted | Which binary the `google` provider means — `agy`, not the earlier Gemini CLI |
| [0002](../architecture/0002-mcp-transport-layer.md) | MCP is a transport/interface layer, not an orchestrator | Accepted (Phase 1) | Why no scheduler exists; MCP translates, it does not coordinate |
| [0003](../architecture/0003-coder-staging-workspace.md) | CODER staging workspace and durable change sets | Accepted (Phases 5A–5C) | Isolated clone, change-set immutability, apply as a separate path |
| [0004](../architecture/0004-recoverable-process-lock.md) | Recoverable process lock | Accepted (Phase 5D) | Owner records, liveness probing, generation-safe recovery, no TTL |
| [0005](../architecture/0005-task-lifecycle.md) | Deterministic task lifecycle | Accepted (Phase 6A) | `active → completed → archived`; no reopen or unarchive |
| [0006](../architecture/0006-installer.md) | Installer and provider MCP registration | Accepted (Phase 6B1) | Official provider commands only; never installs or authenticates providers |
| [0007](../architecture/0007-mcp-host-surface-identity.md) | MCP host-surface identity | **Superseded** by 0009 | Historical: host identity as provider + surface |
| [0008](../architecture/0008-release.md) | Release and CD | Accepted (Phase 7B; identity and licensing resolved in 7C) | Exact-artifact publishing, Trusted Publishing, bootstrap |
| [0009](../architecture/0009-mcp-host-provider-identity.md) | MCP host identity is provider-only | Accepted (Phase 8B) | Provider-only host context; removal of the silent `vscode → cli` downgrade |
| [0010](../architecture/0010-package-and-config-surface.md) | Package surface and configuration lifecycle | Accepted (Phase 8C) | Closed `exports`; parse/validate/preserve/render config lifecycle |

## Superseded and removed concepts

Maintainer-facing evolution, so nobody reintroduces a decision that was deliberately reversed. This is the right place for it — user-facing concept docs describe only the current system.

| Former concept | Current state | Where |
| --- | --- | --- |
| Host identity as **provider + surface** | Replaced by **provider-only** identity. Providers share one MCP registration between CLI and VS Code, and the surfaces are not distinguishable over the protocol | ADR 0009 supersedes 0007 |
| Silent `vscode → cli` **host downgrade** | Removed. A `vscode` *target* is refused outright with `AGENT_TARGET_SURFACE_UNSUPPORTED` | ADR 0009 |
| `same_provider_native` route | Removed. Remaining routes are `same_provider_configured_cli` and `cross_provider_cli` | ADR 0009 |
| **Gemini CLI** as the Google runtime | Replaced by Antigravity (`agy`). Gemini adapters were removed from the tree | ADR 0001 |
| Google as an executable agent target | Recognized but **fails closed** — no invocation-scoped policy is enforceable | ADR 0001, [compatibility](../reference/compatibility.md#google--antigravity) |

If you find yourself proposing one of these again, read the ADR first — each was reversed for a reason that is still true.

## Writing a new ADR

**Numbering.** Zero-padded four digits, next in sequence, with a kebab-case slug: `NNNN-short-topic.md`. The next number is `0011`.

**Structure.** There is no rigid template, and the existing files do not pretend otherwise — each opens with a level-1 title `# ADR NNNN: <decision>` followed by a `Status:` line, then uses **topic-specific headings** that suit the decision. ADR 0004 has "Lock age is never evidence"; ADR 0009 has "What ADR 0007 got wrong". That is intentional: a forced Context/Decision/Consequences skeleton tends to produce filler sections.

A minimal shape consistent with the repository:

```markdown
# ADR NNNN: <the decision>

Status: accepted (Phase X) | superseded by ADR MMMM

## Why
What forced the decision. The constraint, not the feature request.

## The decision
What was chosen, stated so it can be checked against code.

## <topic sections>
The reasoning that matters — including what was rejected and why.

## Consequences
What this makes impossible, and what debt it accepts.
```

**Status line.** Say the phase, and name the superseding ADR when applicable so the supersession chain is readable from the file itself.

**Superseding.** Add the new ADR, set the old one's status to `superseded`, and state in the new one *what the old one got wrong*. **Do not delete or rewrite the superseded ADR** — the record of a reversed decision is the point.

> This phase does not add an ADR. If your change needs one, that is a separate deliberate step.

## When a change needs an ADR

Write one when a change would:

- alter an architectural invariant listed in [architecture](architecture.md#architectural-invariants);
- change the public MCP surface shape or the public error boundary;
- change how provider identity, routing, or execution policy is decided;
- change durable state layout or ownership semantics;
- change the release or packaging contract;
- reverse an earlier ADR.

Ordinary bug fixes, refactors, and documentation do not need one.

## Related

- [Architecture](architecture.md)
- [Repository structure](repository-structure.md)
