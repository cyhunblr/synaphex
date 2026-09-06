# The configure GUI

`synaphex configure` opens a local browser application for editing Synaphex
configuration — agents, rules, and the diagnostics behind them.

```bash
synaphex configure
```

It prints a URL and keeps running until you stop it:

```text
Synaphex Configure
http://127.0.0.1:41234
```

Stop it with Ctrl+C. Nothing is left running in the background.

## What it is, and what it is not

| It does | It does not |
| --- | --- |
| Edit agent provider, supported model and model settings | Register MCP hosts — that stays `synaphex install` |
| Inspect and edit rules at global, project and task scope | Install or update provider software |
| Show provider runtime and registration diagnostics | Manage any credential or API key |
| Preview your configuration files | Invoke agents or run workflows |

> **It is a configuration editor, not an orchestration surface.** There is no
> "run CODER" button, because agent invocation belongs in your provider
> application. Adding it here would create a second way to drive workflows.

## Security model

The configure server is local-only, and treats loopback as necessary but not
sufficient — any page you visit can reach `127.0.0.1`, so three checks apply:

- **Loopback bind.** The server listens on `127.0.0.1` and never on `0.0.0.0`.
- **Per-launch session token.** A fresh random token is generated each run and
  embedded in the page it serves. Every API call must present it, so a page you
  did not open from this process cannot call the API.
- **Origin and Host allowlists.** A request from a foreign origin is refused
  even with a valid token, and an unexpected `Host` is rejected outright, which
  is what closes DNS-rebinding.

Mutations additionally require a JSON content type, so no cross-site form can
submit one.

**No credentials are involved.** The GUI never reads provider tokens, `.npmrc`,
environment variables, or any authentication state, and it sends nothing
outward. Synaphex continues to rely on provider runtimes you have already
authenticated yourself.

## The hex

The overview places **you at the centre** and the six agents around you. That
is the mental model, not decoration: agents do not advance the workflow
themselves, so nothing in the graph draws an automatic pipeline between them.

Each hex shows its agent's status, provider and model. Click one — or focus it
and press Enter — to open its configuration panel. Clicking the centre opens
global controls.

Edges are drawn by **line style, not colour**, so the graph stays readable
without colour perception:

| Style | Meaning |
| --- | --- |
| Solid | `allow` |
| Dashed | `ask` |
| Dotted, faded | `deny` |
| Short dash, marked forbidden | Fixed by role contract |

Selecting an agent emphasises its **outgoing** edges. Direction matters:
`A → B` is a different rule from `B → A`, and arrowheads show which is which.

## Configuring an agent

The panel edits a draft. Nothing is written until you press **Save**, and
**Discard** returns the fields to what is on disk.

Choose a provider and a model from Synaphex's versioned, offline capability
catalog. The list is filtered by provider and surface and is not provider API
discovery or an account-entitlement check. The panel warns you when a target
will not actually run:

- a provider that is not registered as an MCP host tells you to run
  `synaphex install`;
- a historical `vscode` value is displayed as unsupported, but VS Code is not
  offered as a normal execution choice;
- Google/Antigravity is a supported host but **not an executable agent target**,
  because Synaphex cannot enforce an invocation-scoped execution policy on it.

Settings appear only when the selected model declares them. For
`gpt-5.6-sol`, **Reasoning effort** offers `low`, `medium`, `high`, and `xhigh`.
Leaving it at **Provider default (unset)** omits the setting entirely. Switching
provider or model removes incompatible draft settings and tells you it did so.

An existing unknown model is kept visible with a warning and is never silently
replaced. Save stays unavailable until you explicitly select a supported model.
Backend validation remains authoritative even though the controls prevent
ordinary invalid combinations.

**Remove configuration** returns an agent to `unconfigured` and asks for
confirmation first.

## Rules

Every rule resolves through the same precedence Synaphex uses everywhere:

```text
task  →  project  →  global  →  default_deny
```

The first scope with a matching rule decides; anything unmatched anywhere is
denied. The rules view shows each edge's effective decision **and which layer
produced it**, so a surprising outcome is traceable to its source.

Pick a scope with the selector. For project and task scopes you choose from
your existing Synaphex projects and tasks — the GUI reads canonical state and
creates no project or task database of its own.

Decisions are `allow`, `ask` and `deny`. A fourth option, **inherit**, is not a
runtime decision: it removes the override at the selected scope so the inherited
one applies again.

### Role contracts cannot be overridden

Some edges are fixed in code, not configurable:

```text
planner → coder      forbidden by role contract
coder   → reviewer   forbidden by role contract
```

These render as forbidden with disabled controls. The GUI cannot turn them into
`allow`, and neither can editing the files by hand — the same domain check that
protects every other caller rejects it.

## Diagnostics

Read-only probes only: whether each provider CLI is present, its version, the
registration minimum, whether it is registered as an MCP host, and whether it is
usable as an agent target.

**No model request is made**, so opening this page never costs a provider call
and never touches authentication.

## Config files

Shows the canonical documents as they are on disk:

```text
~/.synaphex/agent_config.jsonc
~/.synaphex/agent_behavior.jsonc
~/.synaphex/rules.jsonc
```

The preview is read-only. These files remain the single configuration
authority and stay editable by hand — the GUI is one way to edit them, not a
replacement authority.

## Saving, reloading and conflicts

Saving goes through the same domain services the CLI uses, so validation,
canonical comment rendering and atomic replacement behave identically to
`synaphex install`.

If the files change underneath you — another `synaphex configure`, or your own
editor — the save is **refused rather than applied**, and you are asked to
reload. Synaphex will not silently overwrite a change it did not see.

Refreshing the page re-reads canonical configuration; it does not restore an
unsaved draft.

## Accessibility

Every hex is reachable by keyboard and activates with Enter or Space, focus is
always visible, and status is never carried by colour alone. Motion is limited
to state changes and is disabled entirely when your system requests
`prefers-reduced-motion`.

## Related pages

- [CLI reference](../reference/cli.md)
- [Agent configuration](agent-config.md)
- [Rules](rules.md)
- [Security model](../security/security-model.md)
