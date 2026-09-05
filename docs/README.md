# Synaphex documentation

Synaphex is a user-orchestrated multi-agent framework. It gives six logical
agents — QUESTIONER, RESEARCHER, EXAMINER, PLANNER, CODER, REVIEWER — durable
project state, explicit permissions, and reviewable source changes. **You decide
what runs next.** Nothing inside Synaphex chooses for you.

New here? Start with [installation](getting-started/installation.md).

## Where to start

| If you are… | Read in this order |
| --- | --- |
| **New to Synaphex** | [Installation](getting-started/installation.md) → [first setup](getting-started/first-setup.md) → [first workflow](getting-started/first-workflow.md) → concepts as needed |
| **Hitting a problem** | [Troubleshooting](#troubleshooting) → [error reference](reference/errors.md) → the relevant [workflow](#workflows) |
| **Configuring agents or providers** | [Configuration](configuration/overview.md) → your [provider guide](#providers) → [compatibility](reference/compatibility.md) |
| **Evaluating what it guarantees** | [Security model](security/security-model.md) → [permissions](security/permissions.md) → [compatibility](reference/compatibility.md) |
| **Contributing or maintaining** | [Architecture](development/architecture.md) → [repository structure](development/repository-structure.md) → [testing](development/testing.md) → [CI](development/ci.md) → [releasing](development/releasing.md) → [ADRs](development/architecture-decisions.md) |

## Documentation map

```text
docs/
├── getting-started/     first successful use
├── concepts/            mental model and semantics
├── workflows/           operational sequences
├── configuration/       exact JSONC configuration
├── providers/           provider-specific host and target behaviour
├── security/            guarantees, trust assumptions, limitations
├── reference/           exact interfaces, codes, layout, support matrices
├── troubleshooting/     symptom to safe resolution
├── development/         maintainer architecture, testing, release
└── architecture/        architecture decision records (history)
```

The first eight are **user-facing**. `development/` and `architecture/` are
**maintainer-facing**.

## Getting started

First successful use, in order.

- [Installation](getting-started/installation.md) — install the package and register it with your providers
- [First setup](getting-started/first-setup.md) — configure agents and understand the config files
- [First workflow](getting-started/first-workflow.md) — a project, a task, and a real agent invocation

## Core concepts

The mental model. Read these when behaviour surprises you.

- [The Synaphex model](concepts/synaphex-model.md) — why there is no orchestrator agent
- [Agents](concepts/agents.md) — the six roles and what each may do
- [Projects, tasks, sessions](concepts/projects-tasks-sessions.md) — state and ownership
- [Memory](concepts/memory.md) — durable context, governed by EXAMINER
- [Plans](concepts/plans.md) — drafts, acceptance, and revision authority
- [Rules and permissions](concepts/rules-and-permissions.md) — role contracts versus rules
- [Providers and routing](concepts/providers-and-routing.md) — how an agent reaches a provider

## Workflows

Operational sequences for real work.

- [Research workflow](workflows/research-workflow.md)
- [Planning and coding](workflows/planning-and-coding.md)
- [CODER change sets](workflows/coder-change-sets.md) — capture, review, apply, reject
- [Review, complete, archive](workflows/review-complete-archive.md)
- [Interrupted-apply recovery](workflows/interrupted-apply-recovery.md)

## Configuration

Exact file formats under `~/.synaphex`.

- [Overview](configuration/overview.md) — the three config files
- [Agent configuration](configuration/agent-config.md) — provider, surface, model per agent
- [Agent behaviour](configuration/agent-behavior.md) — `outputFields` for RESEARCHER, CODER, REVIEWER
- [Rules](configuration/rules.md) — decisions, scopes, and precedence
- [Configure GUI](configuration/configure-gui.md) — `synaphex configure`, the local configuration app

## Providers

Provider-specific hosting and target behaviour.

- [OpenAI Codex](providers/openai-codex.md)
- [Anthropic Claude](providers/anthropic-claude.md)
- [Google Antigravity](providers/google-antigravity.md) — supported host; agent execution fails closed

## Security

What Synaphex enforces, what it trusts, and what it does not protect against.

- [Security model](security/security-model.md) — trust boundaries and the threat table
- [CODER isolation](security/coder-isolation.md) — where the staging boundary stops
- [Permissions](security/permissions.md) — role contracts and fail-closed rules
- [Credentials and auth](security/credentials-and-auth.md) — provider-owned auth, environment inheritance

## Reference

Canonical, exact detail. Look things up here.

- [CLI](reference/cli.md) — `synaphex install`, `synaphex configure`, `synaphex uninstall`
- [MCP tools](reference/mcp-tools.md) — the complete tool surface
- [Errors](reference/errors.md) — every public error code
- [Filesystem layout](reference/filesystem-layout.md) — `~/.synaphex`
- [Compatibility](reference/compatibility.md) — OS, Node, providers, versions, support boundaries

## Troubleshooting

Symptom-driven. Each page opens with a symptom table.

- [Installation](troubleshooting/installation.md)
- [Providers and agent execution](troubleshooting/providers.md)
- [Sessions and locks](troubleshooting/sessions-and-locks.md)
- [CODER and change sets](troubleshooting/coder-and-change-sets.md)

## Development

For maintainers and contributors.

- [Architecture](development/architecture.md) — layers, invariants, invocation pipeline
- [Repository structure](development/repository-structure.md) — where each responsibility lives
- [Testing](development/testing.md) — gates, layers, and what to run when
- [CI](development/ci.md) — jobs, matrices, and why Linux only
- [Releasing](development/releasing.md) — exact-artifact publishing and Trusted Publishing
- [Architecture decisions](development/architecture-decisions.md) — how to read the ADRs

## Architecture decision records

[`docs/architecture/`](architecture/) holds ten ADRs recording **architectural
decision history** — including decisions later reversed. They are not
introductory reading, and a superseded ADR is kept deliberately because the
reasoning for reversing it is the valuable part.

Read them through [architecture decisions](development/architecture-decisions.md),
which indexes all ten with their status and supersession chain.

## v0.1 support boundaries

The short version:

- **Linux only.** macOS and Windows are not claimed.
- **Node 20 and 22** verified; `engines` declares `>=20`.
- **All three providers can host** Synaphex over MCP.
- **Agent execution: OpenAI and Anthropic `cli` targets only.** Google/Antigravity is recognised but fails closed, because Synaphex cannot enforce an invocation-scoped execution policy on it.
- **`vscode` is not an executable agent target** for any provider.
- **CODER requires a clean committed Git baseline**, and applying a change set **stages** the result — no commit, no push.
- **No Node SDK.** Synaphex is a CLI and MCP application; package exports are closed.
- **Local state is plaintext.** There is no application-level encryption.

[Compatibility](reference/compatibility.md) holds the canonical matrix and the
full boundary table.

---

[Product README](../README.md)
