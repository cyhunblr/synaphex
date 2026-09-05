# Testing

How to validate a change before proposing it.

## Development index

- [Architecture](architecture.md)
- [Repository structure](repository-structure.md)
- **Testing**
- [CI](ci.md)
- [Releasing](releasing.md)
- [Architecture decisions](architecture-decisions.md)

## Standard local gates

Run these for any change:

```bash
npm run typecheck
npm run build
npm test
git diff --check
```

When a change touches externally observable behavior, the installed package, or install-time behavior, add:

```bash
npm run test:packed-product
```

Other available scripts:

| Script | Purpose |
| --- | --- |
| `npm run test:mcp-stdio` | Real stdio MCP protocol test alone |
| `npm run test:compile` | Compile tests to `.test-dist/` without running |
| `npm run release:preflight` | Version/tag/lockfile/metadata checks — read-only |
| `npm run release:prepare` | Full local release candidate — cannot publish |
| `npm run test:*-live` | Manual real-provider validation; never in CI |

## Which gates for which change

| Change type | Typecheck | Build | `npm test` | Packed product | Real provider |
| --- | :-: | :-: | :-: | :-: | :-: |
| Docs only | ✓ | ✓ | ✓ | — | — |
| Domain logic or core service | ✓ | ✓ | ✓ | — | — |
| MCP public surface (tool, schema, error) | ✓ | ✓ | ✓ | **✓** | — |
| Installer or registration | ✓ | ✓ | ✓ | **✓** | — |
| Provider adapter | ✓ | ✓ | ✓ | — | **manual** |
| Package metadata, `bin`, `files`, exports | ✓ | ✓ | ✓ | **✓** | — |
| Release scripts or workflow | ✓ | ✓ | ✓ | ✓ | — |

The docs row is not ceremony: docs changes have twice caught real drift between prose and implementation, and the gates are cheap.

**Real provider validation never runs in CI** — see [provider strategy](#provider-test-strategy).

## Baseline

At the time of this release branch, `npm test` runs 816 tests and the packed-product suite runs 60 checks, with 31 MCP tools and 63 public error codes.

> Treat those numbers as a snapshot, not a contract. What matters is the **capability invariant**: the stdio smoke test pins the complete MCP tool list by name, and the reference docs pin the complete public error set — so adding or removing either fails a test rather than drifting silently. A test count that only ever goes up proves nothing; a pinned surface does.

## Test layers

| Layer | What it proves | Where |
| --- | --- | --- |
| Domain and contract | Role contracts, rules, error shapes | `test/*.test.ts` |
| Core service | Invocation, staging, apply, locks, ownership races | `test/*.test.ts` |
| MCP surface | Tool schemas, validation, mutation isolation | `test/mcp-*.test.ts` |
| Real stdio protocol | A genuine child process driven by the official MCP client | `test/mcp-stdio-smoke.test.ts` |
| Provider adapters | Argument construction, policy, decoding, sanitization | `test/*-cli-*.test.ts` |
| Installer | Registrars, planner, config lifecycle | `test/*installer*`, `test/*registration*` |
| Packed product | The shipped tarball and global install | `scripts/ci/packed-product-smoke.mjs` |
| Live | Real provider runtimes, manual only | `test/live/` |

## Packed-product testing

This suite exists because **three real defects were invisible to source tests** and appeared only under `npm pack` → `npm install -g` → global bin shim. It validates the artifact a user actually installs.

What it covers, verified from the script:

- `npm pack` produces a tarball, and its **contents are audited** — `dist/` and `LICENSE` present; `src/`, `test/`, `.test-dist/` absent.
- Installation into an **isolated npm prefix**, not the developer's global environment.
- Both bins exist in that prefix and **resolve to the installed package, not the checkout**.
- The MCP shim actually starts — a regression guard against the silent-exit-0 entrypoint bug class.
- MCP `initialize` and the **full tool listing** over real stdio.
- The installer driven against **fake provider CLIs**, on both a **pipe and a PTY** — a readline stall reproduced only under one of them.
- A **zero-byte provider config** is handled rather than misclassified as unverifiable.
- **Foreign registrations are preserved**, and unrelated MCP servers survive uninstall.
- Config and `~/.synaphex` state survive reinstall and uninstall; canonical comments are refreshed while values are preserved.
- Behavior is independent of the current working directory.

Run it locally with `npm run test:packed-product`. It accepts `--tarball <path>` so the release workflow can validate the exact artifact it will publish.

## Provider test strategy

- **CI requires no provider credentials.** No API keys, no model invocation, no provider auth. The only network access in CI is the dependency install.
- **Provider CLIs are faked** where install-time behavior matters (`scripts/ci/fake-provider-cli.mjs`).
- **Adapter tests use injected process runners**, so argument construction and result decoding are verified without spawning anything.
- **Real provider E2E is manual and controlled** — `test/live/`, run deliberately by a maintainer against real authenticated runtimes.

Provider CLIs change independently of Synaphex, so compatibility drift is a real risk. A scheduled non-blocking compatibility workflow is a **deferred post-v0.1 idea, not implemented CI**. Nothing today detects provider drift automatically.

## Security regression categories

When touching these areas, add coverage in the same category — this is where the expensive bugs have been:

| Category | Example coverage |
| --- | --- |
| Foreign registration preservation | Installer must never overwrite a registration it cannot prove is its own |
| Public error allowlisting | `MCP_EXPOSED_ERROR_CODES` boundary; unexposed codes collapse to `INTERNAL_ERROR` |
| Provider error wrapping | Pre-execution refusals keep identity; unexpected provider errors stay wrapped |
| Stderr sanitization | Token and API-key patterns redacted before surfacing |
| CODER staging isolation | No remotes, isolated `HOME`, no hooks, source untouched |
| Ownership and lifecycle fencing | Commit-boundary revalidation; force-release races |
| Apply recovery | `base_clean` / `exact_applied` / `divergent` classification exactness |
| Immutable role restrictions | Forbidden edges unreachable from configuration |

**Mutation testing has repeatedly earned its keep here.** Several gates passed while the invariant was broken — an unsafe rename-based restore, a readline stall the PTY tolerated, a downgrade path that still existed. If a test is meant to bind a security invariant, break the implementation deliberately and confirm the test fails.

## MCP public-surface discipline

An MCP tool is public product surface. The count is 29 today; **"29 forever" is not a rule** — the discipline is.

Adding, removing, or changing a tool requires:

1. Schema review — input shape, required fields, identifier formats.
2. Authority and security review — which authority style, what it can mutate, correct annotations.
3. Updating the stdio smoke test's pinned tool list.
4. Updating [the MCP tools reference](../reference/mcp-tools.md).
5. A packed-product run, since the tool list is asserted over a real install.

> **No generic shell or filesystem escape hatch.** The absence of an arbitrary command tool is a security property of the surface, not an unfinished feature.

## Public error discipline

`MCP_EXPOSED_ERROR_CODES` is a deliberate diagnosability boundary, not a convenience list.

- **Expose** a domain error only when it is safe, stable, and *actionable* — the user can do something specific with it.
- **Keep wrapped** anything unexpected, internal, or provider-originated. `AGENT_EXECUTION_FAILED` is generic on purpose: provider stderr can carry credentials.
- Adding a public code requires a test asserting it **at the MCP boundary** (not just the allowlist constant) plus a row in [the errors reference](../reference/errors.md).
- Never widen exposure to make debugging easier. Diagnostics belong on the server's stderr.

## Provider integration discipline

Before a new provider or target capability ships, prove:

| Requirement | Why |
| --- | --- |
| Routing correctness | Host and target combinations resolve as intended |
| **Invocation-scoped policy enforceability** | The decisive one — see below |
| Authentication stays provider-owned | Synaphex stores no credentials |
| Network policy semantics | `allow` / `ask` / `deny` map correctly |
| Error sanitization and wrapping | No credential leakage through diagnostics |
| Version and capability detection | Registration and execution floors are separate |
| Packed-product behavior | If installation or registration is affected |

**If the required execution policy cannot be enforced for a single invocation, fail closed.** Google/Antigravity is the current worked example: it exposes only persistent provider-owned settings, so no per-invocation read-only or workspace-write contract can be established, and every execution attempt is refused with `PROVIDER_EXECUTION_POLICY_UNSUPPORTED`. Shipping it as "mostly safe" would have meant claiming a guarantee that does not exist.

## Related

- [CI](ci.md)
- [Errors reference](../reference/errors.md)
- [Security model](../security/security-model.md)
