# ADR 0008: Release and CD

Status: accepted (Phase 7B; identity and licensing resolved in Phase 7C) —
machinery implemented and locally verified; **no release has been performed**,
and out-of-band configuration remains.

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

## Package identity

```text
product   Synaphex
GitHub    cyhunblr/synaphex
npm       synaphex          (unscoped, public)
CLI       synaphex
licence   Apache-2.0
```

The name stays **unscoped**. This repository is the new Synaphex product; it is
not a semantic continuation of anything that previously held the name.

### Why 0.1.0 despite historical 1.x–3.x

The npm name `synaphex` was previously used by the same maintainer for an
unrelated product ("Project memory management for Claude Code"), reaching
`3.2.0` across 36 versions. That package has since been **fully unpublished**
(registry reports `Unpublished on 2026-09-05T09:35:17.872Z`).

This product therefore starts at `0.1.0`. A Phase-7B registry snapshot recorded
that no `0.x` version had ever existed — that is **historical evidence gathered
before the unpublish**, and the now-absent registry entry cannot re-prove it.
The actual first publish is the final authority.

npm never permits reusing a previously published `name@version`, so no
historical version may be selected. Nothing in the release tooling derives a
version from registry state; `package.json` is the sole authority, and a test
asserts the release scripts never consult `dist-tags`, `versions` or `latest`.

## Licensing

Apache-2.0, declared as the SPDX identifier in `package.json` with the
unmodified standard text in a root `LICENSE`. npm includes a root `LICENSE` in
the tarball regardless of the `files` allowlist, and both the preflight and the
packed-product gate assert it ships — a declared identifier without the text
would publish a claim the package cannot substantiate.

No paraphrase, no added restrictions, no dual licensing.

## First-ever publish bootstrap

The package must exist before a Trusted Publisher can be configured for it, so
the first publish is deliberately outside automated CD. There is **no
token-based fallback branch in CI** — adding one would put a long-lived
credential into the exact place this design keeps it out of.

A full unpublish also starts an npm **24-hour cooldown** before the name accepts
a new version. That window is not modelled, detected or guessed from local
state: npm is authoritative and simply rejects an early attempt.

```text
1. wait out npm's 24-hour post-unpublish cooldown
2. produce and validate the exact candidate
      npm run release:prepare
   which builds, packs ONCE, runs the preflight and the packed-product gate
   against that exact tarball, and prints its sha256 and SRI
3. review the printed checksum and package contents
4. publish that exact artifact from a maintainer-authenticated npm CLI:
      npm publish <exact .tgz>
   never `npm publish` from the checkout, which would repack
5. package `synaphex` now exists
6. configure npm Trusted Publishing for:
        owner       cyhunblr
        repository  synaphex
        workflow    .github/workflows/release.yml
        environment npm-release
7. create/review the GitHub `npm-release` Environment and its reviewers
8. every subsequent release runs through tokenless OIDC CD
```

### Credential policy

Bootstrap authentication is a **maintainer-authenticated npm CLI** and nothing
more. Whatever credential the maintainer's own npm security policy requires
stays entirely outside this project: Synaphex does not store it, read it, place
it in scripts or CI, or record its value anywhere. Automated CD remains
tokenless OIDC.

## What is NOT automated

```text
version bumps        tag creation        GitHub Release creation
unpublish/deprecate  npm account setup   trusted-publisher registration
```
