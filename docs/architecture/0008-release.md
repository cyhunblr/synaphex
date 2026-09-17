# ADR 0008: Branch promotion and npm release channels

Status: accepted (release identity and licensing resolved; branch/channel
architecture revised before first automated publication). No publication is
performed by adopting this decision; GitHub environment configuration remains
out of band.

## Decision

Synaphex uses one-way protected branch promotion:

```text
feature/* or bugfix/* → dev → test → main
```

- `dev` is the integration branch and runs CI only.
- `test` accepts PRs only from `dev`, runs full CI, and can manually publish a
  prerelease under npm dist-tag `test`.
- `main` accepts PRs only from `test`, runs full CI, and can manually publish
  the committed stable version under npm dist-tag `latest`.

The dedicated `promotion-guard` check verifies the two restricted PR edges.
Feature and bugfix PRs remain valid into `dev`.

Both npm workflows use `workflow_dispatch`. A merge is never publication
authority by itself, and publication is not triggered by a branch push.

## Version authority

`package.json` owns stable version selection; `package-lock.json` must agree.
The production workflow accepts only `X.Y.Z`, publishes that exact version,
and never performs a version bump.

The test channel deterministically derives the next patch prerelease from the
stable package version and the GitHub run number:

```text
0.1.1 → 0.1.2-test.<github-run-number>
```

That version change is restricted to the ephemeral runner via
`npm version --no-git-tag-version --ignore-scripts`. It is neither committed
nor tagged. A registry collision fails the run; the workflow does not choose a
new coordinate automatically.

## Runtime and validation

Application support remains Node 20 and 22 on Linux, both covered by CI. The
manual release jobs use Node 22 and independently repeat release-critical
validation rather than treating an earlier CI result as publication authority.

The production path requires a pristine checkout, package name `synaphex`, a
stable package version, matching lockfile metadata, valid publish metadata and
licence, typecheck, tests, MCP stdio tests, and packed-product validation. The
test path has the same validation after its controlled metadata-only version
change.

## Exact-artifact rule

```text
build
  → npm pack once
  → preflight and packed-product validation on THAT tarball
  → record identity and hashes
  → registry preflight
  → upload THAT tarball
  → environment approval
  → download and verify THAT tarball
  → registry preflight again
  → npm publish <exact .tgz> --tag test|latest
```

Publishing from the checkout would repack it and could publish bytes that were
never validated. Both channels therefore publish an explicit `.tgz` and never
regenerate it between validation and publication.

Recorded provenance comprises package name and version, Git SHA, artifact
filename and byte size, SHA-256, SHA-512, npm/SRI integrity, and npm SHA-1
shasum. Production verifies the hashes before and after its publish command.

## Registry collision and failure policy

The registry check classifies the target coordinate:

| State | Meaning | Action |
| --- | --- | --- |
| `absent` | version not published | the only state that may continue |
| `published_match` | same version and SRI already exist | stop; do not republish |
| `published_differs` | same version, different bytes | hard conflict |
| `unavailable` | outage, auth, parse, or missing-integrity failure | fail closed |

The check runs in preparation and again after environment approval. `npm
whoami` must also succeed immediately before the second check and publish. No
workflow auto-increments, overwrites, unpublishes, deprecates, or rolls back.

## Bootstrap authentication

The initial automation uses two protected GitHub Environments:

```text
npm-test      secret NPM_TOKEN
npm-release   secret NPM_TOKEN
```

The publish jobs map those environment secrets to `NODE_AUTH_TOKEN` only for
`npm whoami` and the literal `npm publish` step. Preparation receives no
credential. All workflow permissions remain `contents: read`; token-based npm
publishing needs no GitHub `id-token: write` or content-write permission.

This is an explicit bootstrap contract, not the final authentication design.
After successful npm publication, production should migrate to npm Trusted
Publishing/OIDC in a separate reviewed change. That future migration must not
add a token fallback silently.

## Tags and GitHub Releases

npm publication is separate from Git tag and GitHub Release administration.
The current workflows do not create or push tags, create GitHub Releases,
modify a changelog, or bump a next development version. These concerns require
their own design after bootstrap publishing is proven.

## Package identity

```text
product   Synaphex
GitHub    cyhunblr/synaphex
npm       synaphex          (unscoped, public)
CLI       synaphex
licence   Apache-2.0
```

The npm name was previously used by the same maintainer for an unrelated
product, reaching historical 1.x–3.x versions before full unpublish. This
repository is not its semantic continuation. No release script derives a new
version from registry history, and npm's immutability rules mean no historical
coordinate may be reused.

This product began at `0.1.1` because its initially prepared `0.1.0`
coordinate became unavailable. `package.json`, not registry history, remains
the sole stable-version authority.

## Licensing

The package is Apache-2.0. `package.json` declares that SPDX identifier and the
root `LICENSE` contains the standard text. Both preflight and packed-product
validation require the licence evidence to ship with the package.

## Operational consequence

Before dispatching a release, maintainers must create the two GitHub
Environments, add their `NPM_TOKEN` secrets and approval rules, and confirm the
selected workflow ref is exactly `test` or `main` as appropriate. The workflow
also checks the branch and fails closed if a different ref is selected.

See [Branch promotion and npm releases](../development/releasing.md) for the
operator sequence.
