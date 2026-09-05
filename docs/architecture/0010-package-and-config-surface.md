# ADR 0010: Package surface and configuration lifecycle

Status: accepted (Phase 8C)

## Synaphex v0.1 is an application, not a Node SDK

```text
published contract:  synaphex  +  synaphex-mcp-stdio
supported library API:  none
```

`src/index.ts` re-exported ~213 symbols, including internals such as
`RecoverableProcessLock` and `ChangeSetApplyManager`. Nothing in the product
needed that: no source module imports the barrel, neither bin references it, and
only two tests used it. Publishing `main`/`types` would nonetheless have
presented all of it as a stable import contract — one nobody intended to support
and which would constrain every later refactor.

The package therefore declares:

```json
{ "exports": {} }
```

with no `main` and no `types`. Verified empirically before adopting it: this
blocks **both** the root import and every deep path
(`ERR_PACKAGE_PATH_NOT_EXPORTED`), while bins keep working because their
internal modules load by relative path. An external-consumer test installs the
real tarball into a separate package and asserts exactly that.

`dist/index.js` still ships as an internal build artifact. The requirement is
that it is not *advertised*, not that it is physically absent, and two tests
still consume the barrel in-repo. Exposing a real SDK later would be a
deliberate design decision, not an accident of a re-export.

## Configuration file lifecycle

```text
values    user-owned        preserved across reinstall
comments  maintainer-owned  regenerated from current templates
```

Three files are managed:

```text
~/.synaphex/agent_config.jsonc
~/.synaphex/agent_behavior.jsonc
~/.synaphex/rules.jsonc
```

Before this phase, `agent_config.jsonc` and `rules.jsonc` carried **zero**
comments and `agent_behavior.jsonc` was never created — the accepted design was
never implemented.

### Canonical regeneration, not line patching

```text
parse existing JSONC  →  validate  →  re-render canonical document  →  write
```

Whole-file regeneration keeps comments truthful as the product changes and makes
the result deterministic, rather than dependent on how a file was previously
edited. Repeated reinstall is byte-stable once canonical.

**Stated plainly: user-added comments are not preserved.** Only semantic values
are. Formatting, key order and indentation are normalised too. Tests compare by
value, never by bytes, because the bytes are meant to change.

### Fail closed on invalid configuration

A file that cannot be parsed, has the wrong version, contains an unknown field,
names an unknown agent, or configures an agent without a model is **refused
before any write**, with the original bytes left exactly as they are. Replacing
a broken config with defaults would destroy work the user meant to keep.

Unknown fields are **rejected**, not preserved and not dropped: canonical
regeneration renders from parsed values, so an unrecognised key would silently
vanish. Refusing tells the user instead of losing their data.

A configuration problem does not fail the provider registrations that already
succeeded; it is reported on its own line and sets a non-zero exit code.

### Comments state only what is true

Templates reflect v0.1 reality after ADR 0009: `cli` targets are supported,
`vscode` targets are refused before execution, and the Google target is
recognised but currently fails closed. `git_push` and `ci` are described as
classified but not executed. Rule precedence is documented as
`task > project > global > default deny`, with `allow | ask | deny`.

Templates contain no credential, token or API-key field, not even as an example.
Authentication is provider-owned. A test enforces this.

Agents start `unconfigured`, and installing a provider host configures none of
them: every configured agent must name a model, and no model is ever invented.
