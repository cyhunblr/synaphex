# Validated model catalog

Synaphex v0.1 ships catalog version `1`: a static, offline product authority.
It does not query a provider account, infer entitlements, or accept arbitrary
model strings. A catalog entry is executable only when its target runtime is
ready and runtime validation still accepts its target, model, and settings.

`recommended` is the default product shortlist. `supported` means the same
execution contract is certified, without making it a default recommendation.
Provider/account availability remains an independent runtime concern.

## Evidence method

The accepted rows below satisfy all of these checks:

- the provider documents the model as current;
- the provider CLI documents full model selection;
- the provider's structured-output mechanism covers the model family;
- the existing invocation-scoped target policy remains model-independent;
- every exposed setting has a known adapter binding; and
- deterministic adapter tests pass the exact model unchanged through the
  structured-result command path.

Evidence sources checked for catalog version 1:

- OpenAI's [Codex model list](https://developers.openai.com/codex/models),
  [Codex configuration reference](https://developers.openai.com/codex/config-reference),
  [model catalog](https://developers.openai.com/api/docs/models), the
  individual API model capability pages, and installed `codex exec --help`
  from Codex CLI 0.153.0.
- Anthropic's [current models](https://platform.claude.com/docs/en/models/overview),
  [model IDs and versioning](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions),
  [model status](https://platform.claude.com/docs/en/about-claude/model-deprecations),
  [structured-output compatibility](https://platform.claude.com/docs/en/build-with-claude/structured-outputs),
  [effort capability guide](https://platform.claude.com/docs/en/build-with-claude/effort),
  [Claude Code CLI reference](https://code.claude.com/docs/en/cli-usage), and
  installed `claude --help` from Claude Code 2.1.260.

In the table, `current`, `CLI`, `schema`, `policy`, and `test` are the five
positive checks above. `RE` means model-scoped `reasoning_effort`; `E` means
model-scoped Claude `effort`. The exact certified values are listed below.
`none` means Synaphex exposes no user-configurable model setting.

## Accepted candidates

| Model ID | Provider | Target | Current | CLI | Schema | Policy | Settings | Test | Tier | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `gpt-5.6-sol` | OpenAI | `codex_cli` | yes | documented exact command | Codex output schema | enforced | RE | adapter matrix | recommended | Flagship, established Synaphex path |
| `gpt-6-astra` | OpenAI | `codex_cli` | yes | documented exact command | Codex output schema | enforced | RE | adapter matrix | supported | Fully compatible; account rollout is observational |
| `gpt-5.6-terra` | OpenAI | `codex_cli` | yes | documented exact command | Codex output schema | enforced | RE | adapter matrix | supported | Fully compatible balanced model |
| `gpt-5.6-luna` | OpenAI | `codex_cli` | yes | documented exact command | Codex output schema | enforced | RE | adapter matrix | supported | Fully compatible cost-sensitive model |
| `gpt-5.5` | OpenAI | `codex_cli` | yes, other model | documented exact command | Codex output schema | enforced | RE | adapter matrix | supported | Previous-generation current Codex model; compatible but not a default recommendation |
| `claude-opus-5` | Anthropic | `claude_code_cli` | yes | full IDs supported | listed compatible | enforced | E | adapter matrix | recommended | Anthropic's general starting point for complex agentic work |
| `claude-sonnet-5` | Anthropic | `claude_code_cli` | yes | full IDs supported | listed compatible | enforced | E | adapter matrix | recommended | Current speed/intelligence recommendation |
| `claude-fable-5-1` | Anthropic | `claude_code_cli` | yes | full IDs supported | listed compatible | enforced | E | adapter matrix | supported | Current specialized high-capability model |
| `claude-fable-5` | Anthropic | `claude_code_cli` | yes | full IDs supported | listed compatible | enforced | E | adapter matrix | supported | Active and compatible |
| `claude-opus-4-8` | Anthropic | `claude_code_cli` | yes | full IDs supported | listed compatible | enforced | E | adapter matrix | supported | Active and compatible |
| `claude-opus-4-7` | Anthropic | `claude_code_cli` | yes | full IDs supported | listed compatible | enforced | E | adapter matrix | supported | Active and compatible |
| `claude-opus-4-6` | Anthropic | `claude_code_cli` | yes | full IDs supported | listed compatible | enforced | E | adapter matrix | supported | Active and compatible |
| `claude-opus-4-5-20251101` | Anthropic | `claude_code_cli` | yes | full IDs supported | listed compatible | enforced | E | adapter matrix | supported | Active pinned legacy model |
| `claude-sonnet-4-6` | Anthropic | `claude_code_cli` | yes | full IDs supported | listed compatible | enforced | E | adapter matrix | supported | Active and compatible |
| `claude-sonnet-4-5` | Anthropic | `claude_code_cli` | yes, legacy alias | official alias supported | listed compatible | enforced | none | adapter matrix and prior live smoke | supported | Existing official alias retained without rewrite |
| `claude-haiku-4-5-20251001` | Anthropic | `claude_code_cli` | yes | full IDs supported | listed compatible | enforced | none | adapter matrix | supported | Active and compatible |

The adapter-matrix tests are deterministic rather than billable live tests.
They prove exact identifier pass-through, structured schema construction,
policy argument construction, and refusal before process execution for an
uncataloged model. The previously accepted provider live smokes remain evidence
for the shared provider boundary, not an account-wide model-discovery system.

## Rejected candidates

| Model ID | Provider | Current/schema evidence | CLI evidence | Decision |
| --- | --- | --- | --- | --- |
| `gpt-5.4` | OpenAI | Retired from ChatGPT-sign-in Codex on 2026-08-31 | May remain API-key accessible | Rejected: not active on Synaphex's subscription-based Codex product surface |
| `gpt-5.4-mini` | OpenAI | Retired from ChatGPT-sign-in Codex on 2026-08-31 | May remain API-key accessible | Rejected: not active on Synaphex's subscription-based Codex product surface |
| `gpt-5.2` | OpenAI | Deprecated in ChatGPT-sign-in Codex | Historical/API-key paths do not widen the product catalog | Rejected: deprecated on the relevant product surface |
| `gpt-5.3-codex` | OpenAI | Deprecated in ChatGPT-sign-in Codex | Historical/API-key paths do not widen the product catalog | Rejected: deprecated on the relevant product surface |
| `gpt-5.3-codex-spark` | OpenAI | Research preview | Exact Codex command documented | Rejected: preview and Pro-account restricted, so not a stable v0.1 product target |
| `gpt-5.6` | OpenAI | Alias of `gpt-5.6-sol` | Generic alias accepted by Codex | Rejected as a duplicate authoring choice; canonical ID only |
| `claude-mythos-5-1` | Anthropic | Structured outputs supported | No general Claude Code target evidence | Rejected: limited Project Glasswing availability |
| `claude-mythos-5` | Anthropic | Structured outputs supported | No general Claude Code target evidence | Rejected: limited Project Glasswing availability |
| `claude-mythos-preview` | Anthropic | Structured outputs supported, model deprecated | No general Claude Code target evidence | Rejected: deprecated preview and restricted availability |

Retired Claude IDs were not executable candidates: the current-status check
eliminates them before the remaining compatibility checks.

## Settings and lifecycle

OpenAI's API capability is not the Codex CLI configuration contract. The API
pages and Codex configuration reference were intersected model by model. Every
accepted OpenAI model has this certified domain:

| Model | ChatGPT-sign-in Codex class | Exact invocation | Certified `reasoning_effort` |
| --- | --- | --- | --- |
| `gpt-6-astra` | recommended/current | `codex -m gpt-6-astra` | `low`, `medium`, `high`, `xhigh` |
| `gpt-5.6-sol` | recommended/current | `codex -m gpt-5.6-sol` | `low`, `medium`, `high`, `xhigh` |
| `gpt-5.6-terra` | recommended/current | `codex -m gpt-5.6-terra` | `low`, `medium`, `high`, `xhigh` |
| `gpt-5.6-luna` | recommended/current | `codex -m gpt-5.6-luna` | `low`, `medium`, `high`, `xhigh` |
| `gpt-5.5` | current “Other model” | `codex -m gpt-5.5` | `low`, `medium`, `high`, `xhigh` |

`reasoning_effort` maps only to the invocation override
`model_reasoning_effort`. `none` and `max` appear on some API models but are
not values in the documented Codex target contract. `minimal` appears in the
generic Codex configuration domain but is absent from these models' documented
API domains, so it is not certified. Omission emits no override.

Claude effort is also model-scoped. The canonical matrix is:

| Model | Tier | Certified `effort` values |
| --- | --- | --- |
| `claude-opus-5` | recommended | `low`, `medium`, `high`, `xhigh`, `max` |
| `claude-sonnet-5` | recommended | `low`, `medium`, `high`, `xhigh`, `max` |
| `claude-fable-5-1` | supported | `low`, `medium`, `high`, `xhigh`, `max` |
| `claude-fable-5` | supported | `low`, `medium`, `high`, `xhigh`, `max` |
| `claude-opus-4-8` | supported | `low`, `medium`, `high`, `xhigh`, `max` |
| `claude-opus-4-7` | supported | `low`, `medium`, `high`, `xhigh`, `max` |
| `claude-opus-4-6` | supported | `low`, `medium`, `high`, `max` |
| `claude-opus-4-5-20251101` | supported | `low`, `medium`, `high` |
| `claude-sonnet-4-6` | supported | `low`, `medium`, `high`, `max` |
| `claude-sonnet-4-5` | supported | none |
| `claude-haiku-4-5-20251001` | supported | none |

An explicit Claude value maps to exactly `--effort <value>` for one process.
Omission emits no `--effort` flag, preserving provider-native behavior. The
compound `ultracode` mode is deliberately not represented as an effort scalar;
it requires a separate future capability if Synaphex adopts it.

Security arguments such as sandbox, tool, network, and role-policy controls
are executor-owned and can never be authored as model settings.

When a model is absent from a later catalog, an existing persisted value is
still parsed and displayed unchanged as unvalidated, but cannot execute. New
authoring rejects it. No automatic replacement or migration occurs.
