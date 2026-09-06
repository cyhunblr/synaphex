# ADR 0011: Provider capability taxonomy

- Status: accepted
- Catalog: version 1

## Decision

Provider support is represented by separate canonical concepts:

- `ProviderIntegrationCapability` owns the provider runtime, host surfaces,
  and execution targets;
- `HostSurfaceCapability` describes an MCP-hosting surface and is never a
  callable target;
- `ExecutionTargetCapability` describes callable support, invocation-scoped
  execution policy, models, and an unavailable reason;
- `ModelCapability` attaches a model ID and support tier to one target; and
- `SettingCapability` allowlists a typed, scoped setting and its internal
  executor binding.

Definitions are product authority. Runtime installation/version and recorded
MCP registration are observations in separate objects. An observation can make
an otherwise supported target not ready, but can never add a target, model, or
setting to the authority.

Validation has three boundaries: persistence parsing preserves historical
values, authoring accepts only active catalog entries, and execution revalidates
the persisted target/model/settings immediately before provider routing.

The legacy persistence tuple `{ provider, surface, model, settings? }` remains
unchanged. New callable configurations persist `surface: "cli"`; the richer
target ID is internal.

## Consequences

- Codex CLI and Claude Code CLI are supported execution targets independent of
  whether their MCP host registration is recorded.
- OpenAI and Anthropic VS Code integrations are host surfaces only.
- Antigravity remains a supported MCP host with an unavailable execution
  target and no executable models.
- Unknown historical models and historical `vscode` targets remain readable
  and unchanged, but are non-executable; new authoring rejects them.
- Configure projects the canonical catalog and observations but is not itself
  capability authority.
- Model-specific Codex and Claude effort domains and their invocation bindings
  live in the same registry used by authoring and runtime validation; provider
  generic enums cannot widen a model's certified values.

See [the catalog evidence](../reference/model-catalog.md).
