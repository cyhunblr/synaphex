# ADR 0001: Google CLI runtime is Antigravity CLI

Status: accepted

Synaphex initially evaluated Gemini CLI as the callable runtime for agents configured with `provider = google` and `surface = cli`. Consumer Google-account authentication through that Gemini CLI path was no longer supported, so retaining it would not provide the required provider-owned authentication experience.

Gemini CLI support has therefore been removed completely. The deterministic callable mapping is:

- `openai + cli` → Codex CLI
- `anthropic + cli` → Claude Code CLI
- `google + cli` → Antigravity CLI (`agy`)

Antigravity IDE is not a callable Synaphex runtime. Only Antigravity CLI is callable. This decision does not add a runtime discriminator to agent configuration; Google has one supported callable CLI.

## Antigravity provider hardening audit (`agy 1.1.26`)

Status: Antigravity is **not** accepted for any ExecutionPolicy. Synaphex fails closed.

### What the runtime actually exposes

The complete `agy 1.1.26` flag surface is `--add-dir`, `--agent`, `--continue`,
`--conversation`, `--dangerously-skip-permissions`, `--disable-slash-commands`,
`--effort`, `--input-format`, `--json-schema`, `--log-file`, `--mode`,
`--model`, `--new-project`, `--output-format`, `--print`/`-p`,
`--print-timeout`, `--project`, `--prompt-interactive` and `--sandbox`. The
parser is Go `flag`-based and rejects anything else outright
(`flags provided but not defined`), so this list is exhaustive. There is no
`--strict`, `--settings`, `--config`, `--policy`, `--permission-mode`,
`--allowed-tools`, `--deny` or `--no-mcp`.

### `--mode` is a behavioral guard, not a permission boundary

The shipped mode descriptions are `'default': standard behavior.
'accept-edits': auto-approve file edits, prompt for commands. 'plan': research
and plan without making changes`, and `plan` is surfaced as
"Plan mode: research & plan only". These describe agent behavior.

Tool authorization is a separate, persistent mechanism: permission grants in
`~/.gemini/antigravity-cli/settings.json` (`permissions.allow` / `ask` / `deny`
plus `toolPermission`), with rule grammar
`^(command|read_file|write_file|read_url|mcp|execute_url|unsandboxed)\s*\(.*\)$`.
Because `write_file(...)` is an ordinary grant — and the runtime explicitly
"respect[s] write_file permissions allowlisted in `settings.json` under
`permission.allow`, so pre-approved file writes no longer prompt for review" —
a persistent allow rule can authorize a write regardless of `--mode`.

### How headless writes are governed

Headless runs consult the same persistent grants. Where no grant applies, the
CLI soft-denies (`Print mode: soft-denying tool confirmation %q at step %d`) and
"prints a stderr notice naming the allow-rule needed to permit them". Denial by
absence of a grant is not the same as denial by policy: whatever the user's or
an administrator's persistent configuration already allows proceeds silently,
and `--mode` was itself historically ignored headless
("Fixed `--mode` being ignored in headless `-p` runs").

Every control that would be needed — tool execution policy (`always-proceed`,
`request-review`, `strict`, `proceed-in-sandbox`), non-workspace file access,
internet access policy, permission grants, command allow/denylist, browser
allowlist and sandbox mode — is a persistent global or project-level setting.
`strict` is a settings value, not a CLI flag, and admin controls can override
these server-side (`applyAdminControlsOverridesLocked: Enforcing ToolPermission`).

### `unsandboxed(...)`

`unsandboxed(...)` is retired in 1.1.26: "Unsandboxed is no longer valid and the
rule will be ignored", and `unsandboxed is no longer a valid rule, use
command() instead`. It is therefore not the live escape path — but its
replacement, `command(...)`, is an ordinary persistent grant that Synaphex can
neither observe nor scope per invocation.

### Decision

Synaphex must never mutate or inspect provider-owned Antigravity settings or
credentials, so it cannot bind source-modification, command, MCP or network
denial to a single invocation. `--mode` and `--sandbox` are retained in the
command construction as defense-in-depth, but classified as behavioral guards.

Both `read_only` and `workspace_write` are refused:

- `read_only` — the immutable source-modification contract cannot be enforced.
- `workspace_write` — persistent `command(...)`, `read_url(...)` and `mcp(...)`
  grants could silently authorize paths that bypass Synaphex's `git_push` and
  `ci` host actions and its separately controlled `network` capability.

Rejected as non-solutions: an ephemeral workspace copy (does not constrain
shell, network or MCP side effects), symlink arrangements, prompt wording,
post-run `git diff` detection and after-the-fact reverts — none is prevention.

Antigravity becomes acceptable only if the runtime gains an invocation-scoped
restricted policy mechanism, comparable to Claude Code's `--restricted`, that
overrides persistent `permissions.allow` rules.
