# Filesystem layout

All durable Synaphex state lives under `~/.synaphex`. This page documents the
stable parts of that layout and marks the parts you should not treat as API.


## Reference index

- [CLI](cli.md)
- [MCP tools](mcp-tools.md)
- [Errors](errors.md)
- **Filesystem layout**
- [Compatibility](compatibility.md)

## Persistent vs temporary state

| | Persistent state | Temporary execution state |
| --- | --- | --- |
| Location | `~/.synaphex` | System temp directory |
| Lifetime | Until you delete it | One invocation |
| Survives `uninstall`? | Yes | Not applicable |
| Stable path? | Yes, as documented below | **No** |

Staging clones and provider scratch directories are created under the system
temp directory with randomized names and removed afterwards. **Their paths are an
implementation detail** — never script against them.

## Global layout

```text
~/.synaphex/
├── agent_config.jsonc        # which provider/surface/model backs each agent
├── agent_behavior.jsonc      # outputFields for researcher, coder, reviewer
├── rules.jsonc               # global rule decisions
├── projects/                 # one directory per registered project
└── state/                    # Synaphex-managed internal state
    ├── installation.json
    ├── sessions/
    ├── task-bindings/
    └── .lock-quarantine/
```

The three `.jsonc` files are **yours to edit**. See [configuration](../configuration/overview.md).

## Synaphex-managed internal state

> **Do not hand-edit anything under `state/`.** These files carry ownership and
> installation authority. Editing them can invalidate a live session claim.

| Path | Contents |
| --- | --- |
| `state/installation.json` | Which provider registrations Synaphex owns; used by `uninstall` to avoid touching foreign entries |
| `state/sessions/` | Live session records |
| `state/task-bindings/` | Which session currently claims each task, plus the binding lock |
| `state/.lock-quarantine/` | Transient artifacts of lock recovery |

## Project layout

Project directories are named `<projectId>_<slug>`. **The exact directory name is
not a public API** — resolve projects by id through the tools.

```text
~/.synaphex/projects/prj_example_myproject/
├── project.jsonc             # project metadata
├── rules.jsonc               # project-scope rules
├── artifacts/
│   └── researcher/           # project-scope research artifacts
├── memory/
│   ├── loaded/               # session-linked loaded material
│   └── tasks/                # per-task memory
└── tasks/
    ├── open/
    └── archive/
```

Archival moves a task directory from `tasks/open/` to `tasks/archive/`.

## Task layout

```text
tasks/open/task_example_add-retry/
├── task.jsonc                # task metadata and lifecycle state
├── rules.jsonc               # task-scope rules (highest precedence)
├── plans/
│   └── archive/              # superseded plan revisions
├── artifacts/
│   ├── questioner/
│   ├── researcher/
│   ├── coder/
│   └── reviewer/
└── changes/                  # created on first change set
```

Artifacts under `artifacts/` are readable records of agent output. `task.jsonc`
and `rules.jsonc` carry authority — `rules.jsonc` is yours to edit; `task.jsonc`
is Synaphex-managed.

## Memory layout

Project memory lives at `memory/`, task memory at `memory/tasks/<task-dir>/`,
each with a `loaded/` subdirectory for session-linked material.

> These files are persisted state, not a supported editing surface. Canonical
> memory mutation should happen through Synaphex and EXAMINER semantics so
> conflict detection and ownership checks apply. See [memory](../concepts/memory.md).

## Change sets and receipts

```text
changes/
├── changeset_<timestamp>_<hex>/
│   ├── metadata.json         # base commit, result tree, patch hash, file list
│   └── changes.patch         # the patch bytes
├── apply-intents/
│   └── <changeSetId>.json    # crash-visible intent record
└── decisions/
    └── <changeSetId>.json    # applied / rejected receipt
```

`apply-intents/` is what makes interrupted applies detectable: the intent is
recorded before the source is touched, so a crash leaves evidence.

> **A file existing on disk does not make a change set authoritative.** Authority
> comes from task ownership, the recorded decision state, and being the current
> CODER target — not from filesystem presence. Copying a change-set directory
> does not make it applicable.

Useful for diagnostics and backups; not an input channel. Do not hand-craft
change sets.

## Locks and quarantine

Synaphex uses recoverable process locks for task binding, memory, plans, and
source mutation. Recovery is generation-safe: ownership is verified before a lock
is reclaimed, and **uncertain ownership fails closed rather than stealing**.

You may occasionally see `state/.lock-quarantine/` entries. Leftover quarantine
markers are known maintenance debt and are harmless. A malformed or legacy lock
causes operations to fail closed rather than proceed unsafely.

> **Deleting lock files by hand is not the normal fix.** For a genuinely
> abandoned task claim, use `synaphex_force_release_task_session`, which is
> audited and ownership-aware.

## Permissions and encryption

- State files written by Synaphex use mode `0600`.
- Staging and provider temp directories use mode `0700`.
- **State is plaintext. There is no application-level encryption.**

These modes apply to files Synaphex writes; they are not a guarantee about every
path under `~/.synaphex` regardless of origin. See
[credentials and auth](../security/credentials-and-auth.md).

## Backups

`~/.synaphex` holds durable project and task history — plans, artifacts, memory,
and change sets — so it is worth backing up. `synaphex uninstall` preserves it;
only removing the directory yourself discards that history.

**No provider credentials are stored there**, so a backup carries no provider
authentication. It does contain your instructions and agent output, which may be
sensitive.

## Related pages

- [Configuration overview](../configuration/overview.md)
- [Memory](../concepts/memory.md)
- [Security model](../security/security-model.md)
