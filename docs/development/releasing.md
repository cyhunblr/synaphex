# Branch promotion and npm releases

Maintainer documentation for the protected branch flow and the two manually
invoked npm workflows. npm publication is irreversible; do not dispatch either
workflow until its environment, approval policy, and credential are ready.

## Development index

- [Architecture](architecture.md)
- [Repository structure](repository-structure.md)
- [Testing](testing.md)
- [CI](ci.md)
- **Releasing**
- [Architecture decisions](architecture-decisions.md)

## Branch topology

```text
feature/* or bugfix/*
          ↓ pull request
         dev        integration; CI only
          ↓ dev → test pull request
         test       release candidate; CI plus manual npm test channel
          ↓ test → main pull request
         main       production; CI plus manual npm latest channel
```

`.github/workflows/promotion-guard.yml` supplies the stable
`promotion-guard` check. A PR into `test` must come from `dev`; a PR into
`main` must come from `test`. Feature work continues to enter through `dev`.

## Common release safety properties

Both npm workflows are `workflow_dispatch` only, require Node 22, and request
only `contents: read`. Their preparation jobs:

1. reject the wrong branch;
2. run typecheck, tests, and MCP stdio validation;
3. use `npm run release:prepare` to build, pack once, run preflight, and run the
   packed-product suite against that exact tarball;
4. record package name, version, Git SHA, filename, byte size, SHA-256,
   SHA-512, SRI integrity, and npm SHA-1 shasum;
5. fail closed unless `npm view <name>@<version>` proves the coordinate absent;
6. upload the one validated `.tgz` for the environment-gated publish job.

The publish job downloads and re-hashes that artifact, runs `npm whoami`, and
re-checks registry state immediately before publishing the literal tarball.
It never publishes from the checkout and never repacks between validation and
publish.

Registry ambiguity is not absence. An existing coordinate, differing or
matching bytes, missing integrity, authentication failure, or registry/network
failure all stop the workflow.

## Test prerelease channel

Workflow: `.github/workflows/npm-test.yml`

```text
trigger       manual workflow_dispatch on test
environment   npm-test
dist-tag      test
install       npm install synaphex@test
```

The stable version in `package.json` remains the source input. The runner
increments its patch component and appends the GitHub run number:

```text
0.1.1 → 0.1.2-test.<github-run-number>
```

`npm version --no-git-tag-version --ignore-scripts` changes `package.json` and
`package-lock.json` only inside the ephemeral runner. The workflow verifies
those are the only tracked changes. It does not commit the prerelease version,
create a tag, or retry with a different version after a registry collision.

## Production channel

Workflow: `.github/workflows/release.yml`

```text
trigger       manual workflow_dispatch on main
environment   npm-release
dist-tag      latest
```

Production publishes the exact stable `X.Y.Z` already committed in
`package.json`; it never bumps or invents a version. Preparation requires a
pristine checkout, package name `synaphex`, matching lockfile metadata, valid
publish metadata and licence, the full validation suite, an unused registry
coordinate, and a single exact artifact. The tarball is hashed again after the
publish command to prove the local artifact remained byte-identical.

## GitHub configuration required before dispatch

Create these protected GitHub Environments manually:

| Environment | Secret | Used for |
| --- | --- | --- |
| `npm-test` | `NPM_TOKEN` | prerelease publication with dist-tag `test` |
| `npm-release` | `NPM_TOKEN` | stable publication with dist-tag `latest` |

Configure appropriate required reviewers for each environment. Do not commit a
token or add a repository-level fallback. The workflows map the environment
secret to `NODE_AUTH_TOKEN` only for `npm whoami` and `npm publish`; preparation
and artifact verification do not receive it.

This token contract is the bootstrap architecture. After npm publication is
proven, production should migrate to npm Trusted Publishing/OIDC in a separate
reviewed change. Until then the workflows intentionally request no
`id-token: write` permission.

## Not automated

The workflows do not create or push Git tags, create GitHub Releases, edit a
changelog, bump the next development version, configure npm/GitHub credentials,
unpublish, deprecate, or roll back a dist-tag. Branch merges and workflow
dispatches remain explicit maintainer actions.

## Maintainer sequence

For a test candidate:

1. merge reviewed work into `dev` after CI passes;
2. open the `dev` → `test` PR and require CI plus `promotion-guard`;
3. merge it, then manually dispatch **npm test channel** from `test`;
4. review/approve `npm-test` and verify the published prerelease explicitly.

For production:

1. open the `test` → `main` PR and require CI plus `promotion-guard`;
2. ensure `package.json` and `package-lock.json` already carry the intended
   stable version;
3. merge it, then manually dispatch **npm production release** from `main`;
4. review/approve `npm-release` and verify the published `latest` version.

## Related

- [ADR 0008: Release and CD](../architecture/0008-release.md)
- [CI](ci.md)
- [Compatibility](../reference/compatibility.md)
