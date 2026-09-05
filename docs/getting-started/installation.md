# Installation

This page covers getting the Synaphex package onto your machine. Configuring it
comes next, in [first setup](first-setup.md).

## Requirements

| Requirement | Required? | Detail |
| --- | --- | --- |
| Linux | Yes | macOS and Windows are not supported in v0.1. |
| Node.js 20+ | Yes | Verified on Node.js 20 and 22. |
| npm | Yes | Ships with Node.js. |
| Git | For project work | Needed for anything involving projects or CODER. |
| A provider runtime | To host Synaphex | Any **one** of the three below is enough. |

### Provider runtimes

Synaphex registers itself with provider runtimes you already have. It does not
install them, and it does not manage their authentication.

| Provider | Command | Minimum version |
| --- | --- | --- |
| OpenAI Codex | `codex` | 0.153.0 |
| Anthropic Claude Code | `claude` | 2.1.260 |
| Google Antigravity | `agy` | 1.1.26 |

Those minimums are the versions whose MCP registration behaviour Synaphex has
verified directly. Install providers using their own documentation, and sign in
to them before expecting agent execution to work.

Registering a provider as a host and running an agent *on* it are separate
requirements with separate minimums; [compatibility](../reference/compatibility.md)
holds the canonical matrix.

You can install the Synaphex package without any provider present. The
[setup step](first-setup.md) simply reports which runtimes it found.

## Install

```bash
npm install -g synaphex
```

This installs two executables:

- `synaphex` — the command you use, with two subcommands: `install` and
  `uninstall`.
- `synaphex-mcp-stdio` — the MCP server itself. Provider runtimes launch this;
  you do not normally run it by hand.

## Verify the install

```bash
command -v synaphex
command -v synaphex-mcp-stdio
```

Both should print paths inside your global npm prefix. Running `synaphex` with
no arguments prints its usage:

```bash
synaphex
```

```text
Usage: synaphex install | synaphex uninstall
```

> Synaphex has no `--version` flag in v0.1. To check which version is installed,
> use `npm list -g synaphex`.

## Configure it

Installing the package does not register anything. Continue with
[first setup](first-setup.md):

```bash
synaphex install
```

## Upgrading

Reinstall the package, then re-run setup:

```bash
npm install -g synaphex
synaphex install
```

Re-running `synaphex install` is safe and idempotent. It refreshes provider
registrations that Synaphex owns and regenerates the maintainer-managed comments
in your configuration files, while preserving your configuration **values**. A
registration that is already correct is reported as already configured and left
alone.

## Removing Synaphex

There are two separate commands, and **neither performs the other**:

| Command | Removes | Leaves alone |
| --- | --- | --- |
| `synaphex uninstall` | MCP registrations Synaphex provably owns | The npm package, `~/.synaphex`, provider software and sign-ins, any MCP server it did not create |
| `npm uninstall -g synaphex` | The npm package and its binaries | Provider registrations, `~/.synaphex` |

```bash
synaphex uninstall          # unregister from providers
npm uninstall -g synaphex   # remove the package
```

Note that `synaphex uninstall` never deletes an MCP server it does not own, even
one named `synaphex`.

To remove Synaphex's own state as well, delete `~/.synaphex` yourself. Nothing
does that for you, because that directory holds your configuration, projects,
tasks, plans, change sets, and review history.

## Next

- [First setup](first-setup.md) — register provider hosts and configure agents.

## Configuring visually

Once installed, `synaphex configure` opens a local GUI for agent and rule
configuration. It is optional: the JSONC files remain fully editable by hand.
See [the configure guide](../configuration/configure-gui.md).
