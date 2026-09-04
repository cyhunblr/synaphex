# ADR 0001: Google CLI runtime is Antigravity CLI

Status: accepted

Synaphex initially evaluated Gemini CLI as the callable runtime for agents configured with `provider = google` and `surface = cli`. Consumer Google-account authentication through that Gemini CLI path was no longer supported, so retaining it would not provide the required provider-owned authentication experience.

Gemini CLI support has therefore been removed completely. The deterministic callable mapping is:

- `openai + cli` → Codex CLI
- `anthropic + cli` → Claude Code CLI
- `google + cli` → Antigravity CLI (`agy`)

Antigravity IDE is not a callable Synaphex runtime. Only Antigravity CLI is callable. This decision does not add a runtime discriminator to agent configuration; Google has one supported callable CLI.
