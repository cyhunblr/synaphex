# ADR 0008: Release and CD

Status: accepted (Phase 7B) — machinery implemented and locally verified; **no
release has been performed**, and out-of-band configuration remains.

```text
CI   every PR and main push        fork-safe, zero secrets
CD   a maintainer-created v tag    human-approved, OIDC, no stored token
```

## Version authority

`package.json` owns the version. Nothing infers it.

```text
maintainer edits version  →  CI  →  merge to main  →  tag vX.Y.Z  →  release
```

A Git tag only **confirms** the committed decision; it can never supply it. The
preflight fails closed when `tag != v${package.json.version}`, when
`package-lock.json` disagrees (either the top-level or the root-package entry),
or when the tag's commit is not contained in `origin/main` — a valid tag on a
detached or fork commit is not release authority.

There is deliberately no `npm version`, no `git tag` creation, no
Conventional-Commits inference and no semantic-release. Version and tag are
maintainer actions, audited as absent from the workflow.

## Prereleases deferred

Only stable `X.Y.Z` is accepted. Supporting `0.2.0-beta.1` would mean choosing a
dist-tag policy that does not exist yet, so the preflight rejects prerelease
strings rather than guessing a channel.

## Runtimes

Application support stays **Node 20 and 22 on Linux** — `ci.yml` proves both.
The release job pins a newer runtime because Trusted Publishing requires it:

```text
runner   ubuntu-latest
node     22
npm      11.10.0   (pinned, not `latest`)
```

npm is pinned explicitly because Trusted Publishing behaviour depends on the npm
version, and a publish-critical job must not drift with whatever
`actions/setup-node` happens to ship.

## Direct OIDC publish, not staged publishing

Chosen: tag → verification → GitHub Environment approval → OIDC publish.

npm staged publishing would add a *second* human gate on the registry side. The
Environment already provides a deliberate human checkpoint before any
irreversible action, and staged publishing cannot bootstrap a package that does
not yet exist — so it would add operational complexity without changing the
safety property that matters. Revisit if multi-package or multi-approver
releases ever appear.

## The exact-artifact rule

```text
npm pack  (exactly once)
   → validate THAT tarball
   → upload THAT tarball + SHA256SUMS
   → publish THAT tarball
```

`npm publish .` would **repack**, publishing bytes nothing validated. The
workflow publishes an explicit `.tgz` path, packs exactly once, and re-verifies
`sha256sum --check` in the publish job before the irreversible step. Audited.

Validation reuses the Phase-7A gate through `--tarball`, so there is one
packed-product implementation, not a weaker release-only copy.

## Registry collision and rerun behaviour

npm versions are immutable, so a rerun must never blindly republish. The
registry check classifies four states:

| state | meaning | action |
| --- | --- | --- |
| `absent` | version not published | publish may proceed |
| `published_match` | `dist.integrity` equals this artifact's SRI | already released |
| `published_differs` | same version, different bytes | hard conflict |
| `unavailable` | outage, auth or parse failure | **fail closed** |

The integrity comparison is real, not aspirational: npm exposes
`dist.integrity` as `sha512-<base64>`, and the same value is derivable locally
from the tarball — verified against the live registry during this phase. An
ambiguous registry failure is never read as "safe to publish".

## Provenance

Generated automatically by Trusted Publishing for a public repository and
package. It is never disabled: `NPM_CONFIG_PROVENANCE=false`, `--no-provenance`
and `provenance: false` are all audited as absent. `repository.url` was set to
the canonical GitHub URL, which provenance requires.

## No long-lived credential

The workflow carries `id-token: write` on the publish job only. `NPM_TOKEN`,
`NODE_AUTH_TOKEN`, `secrets.NPM*` and `_authToken` are audited as absent from
both workflows, and CI is separately audited to hold no `id-token` and no
`npm publish` — so PR CI stays fork-safe.

Least privilege throughout: `contents: read` by default; only the publish job
adds OIDC; nothing currently needs `contents: write`.

## GitHub Release automation: deferred

Not implemented in this slice. npm publication is irreversible while GitHub
Release creation can fail, so sequencing publish-then-release leaves a failure
mode needing idempotent repair. That repair logic is only worth writing once a
real release has happened and the rerun semantics above are observed in
practice. Releases can be created manually from the uploaded artifact
meanwhile. Revisit after the first successful publish.

## Failure policy

No automatic rollback. `npm unpublish`, `npm deprecate` and dist-tag rollback
are audited as absent. A published version is a permanent release record; the
operational response to a bad release is **fix forward with a new version**.

## First-ever publish bootstrap

npm reports that **`synaphex` already exists**, owned by `ceyhunbilir`, at
version `3.2.0` — a *different* product ("Project memory management for Claude
Code"), last published 2026-04-20. No `0.x` version exists.

This is a product-identity decision, not an implementation detail: publishing
this Synaphex into that package would replace an unrelated package's meaning at
a *lower* version than its `latest`. The maintainer must decide whether to reuse
the name (and how to sequence versions against 3.2.0), or publish under a
different or scoped name.

A trusted publisher cannot be configured before a package exists — but this
package does exist, so the bootstrap is simpler than the general case:

```text
1. resolve the package-identity decision above
2. resolve the licensing decision (below)
3. build and validate the exact tarball locally
     npm run build && npm pack
     node scripts/release/release-preflight.mjs --tag vX.Y.Z --tarball <tgz>
     npm run test:packed-product -- --tarball <tgz>
4. maintainer authenticates to npm interactively, with 2FA, and publishes
   THAT exact tarball (never `npm publish .`)
5. configure npm Trusted Publishing for:
        owner       cyhunblr
        repository  synaphex
        workflow    .github/workflows/release.yml
        environment npm-release
6. restrict or remove classic publish tokens on the npm account
7. every subsequent release runs through OIDC CD
```

## Licensing is an unresolved policy gate

`license` is currently `UNLICENSED`. Public source visibility does not itself
choose a distribution licence, and no licence was invented here. The preflight
reports this as a **POLICY** blocker and exits non-zero, so automation cannot
make an irreversible public-distribution decision on the maintainer's behalf.

Once a licence is chosen, adding it to `package.json` (and a `LICENSE` file)
clears the gate with no tooling change.

## What is NOT automated

```text
version bumps        tag creation        GitHub Release creation
unpublish/deprecate  npm account setup   trusted-publisher registration
```
