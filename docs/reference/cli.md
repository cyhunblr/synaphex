# CLI reference

Synaphex ships two executables. Only one is a user-facing command.

| Executable | Audience | Purpose |
| --- | --- | --- |
| `synaphex` | You | Register or remove Synaphex with your provider MCP hosts |
| `synaphex-mcp-stdio` | Provider MCP hosts | Internal server binary launched by a host; not a normal user command |


## Reference index

- **CLI**
- [MCP tools](mcp-tools.md)
- [Errors](errors.md)
- [Filesystem layout](filesystem-layout.md)
- [Compatibility](compatibility.md)

## Command index

The complete public command surface is exactly two commands.

| Command | Purpose | Mutates provider config? | Mutates `~/.synaphex`? | Touches provider auth? |
| --- | --- | --- | --- | --- |
| `synaphex install` | Register Synaphex as an MCP server with selected providers, and initialize local state | Yes, via each provider's own MCP command | Yes, creates/refreshes config and state directories | No |
| `synaphex uninstall` | Remove Synaphex-owned MCP registrations | Yes, removals only | No, state is preserved | No |

> There is no `synaphex project`, `synaphex task`, `synaphex run`, `synaphex status`, or `synaphex agent`. Orchestration happens through MCP tools inside your host, not through the terminal. `--version` is not implemented either.

Any other argument prints usage and exits non-zero.

## `synaphex install`

Interactive. It performs, in order:

1. **Provider host selection.** You are prompted per provider (OpenAI/Codex, Anthropic/Claude, Google/Antigravity) for which hosts should be able to reach Synaphex.
2. **Detection and planning.** Each selected runtime is probed for presence and version. A plan is shown before anything is written.
3. **Confirmation.** Nothing is mutated until you confirm. Declining leaves the system untouched.
4. **Registration.** Synaphex is registered using each provider's own official MCP command — `codex mcp add`, `claude mcp add --scope user`, `agy mcp add`. Synaphex does not hand-edit provider config files.
5. **Host context binding.** Each registration launches `synaphex-mcp-stdio` with a `--host-provider` flag identifying the registering provider.
6. **State initialization.** Creates `state/`, `state/task-bindings/`, `state/sessions/`, `projects/`, and renders `agent_config.jsonc`, `agent_behavior.jsonc`, and `rules.jsonc`.

**Semantic value preservation.** Re-running `install` refreshes canonical comments and formatting in the config files while preserving your configured values. An existing configuration is not reset.

**Foreign registration conflict.** A registration under the `synaphex` name that Synaphex does not recognize as its own is reported as a conflict and **left alone**. Synaphex does not overwrite a registration it did not create.

**What install never does.** It runs no package manager, no `curl`, no VS Code extension install, and no provider login. It will not install, update, or authenticate provider software. Missing or too-old runtimes are reported, not fixed.

## `synaphex uninstall`

Removes MCP registrations that match Synaphex's own ownership fingerprint, using each provider's own removal command.

- **Foreign or drifted registrations are preserved**, not deleted.
- **Partial failure is reported, not fatal.** If one provider's removal fails, the others still proceed and the summary reports per-provider outcomes.
- **`~/.synaphex` is preserved.** Projects, tasks, plans, artifacts, memory, and change sets survive. See [filesystem layout](filesystem-layout.md).
- **It does not uninstall the npm package.** Remove that yourself with your package manager.

## Exit and output behavior

Numeric exit codes beyond "zero for success, non-zero for failure" are **not a public contract** and should not be scripted against. The stable, documented behavior is semantic:

| Situation | Behavior |
| --- | --- |
| Successful install or uninstall | Report written to stdout, success exit status |
| Nothing selected | `Nothing selected. No changes were made.` — success status, no mutation |
| Plan not confirmed | `Cancelled. No changes were made.` — success status, no mutation |
| Unknown or missing command | Usage written, non-zero status |
| Installation could not start | Message on stderr, non-zero status |
| Partial provider failure | Per-provider outcomes in the report; overall status reflects failure |
| Foreign registration conflict | Reported in the summary; that registration is skipped, not replaced |

Reports go to stdout; startup errors go to stderr. Internal stack traces are not printed as part of normal failure output.

## `synaphex-mcp-stdio` (internal)

This binary is launched **by a provider MCP host**, using the registration `install` created. You do not normally run it yourself.

It speaks MCP over stdio. It binds no port, runs no daemon, and accepts no remote connection.

**Required startup authority:**

```text
synaphex-mcp-stdio --host-provider openai
synaphex-mcp-stdio --host-provider anthropic
synaphex-mcp-stdio --host-provider google
```

Exactly one `--host-provider` value is required, and it must be one of those three. Host identity is a **startup argument only** — no MCP tool input can select or override it.

**Obsolete flag.** `--host-surface` was removed. It is rejected outright rather than ignored, so a stale registration fails loudly instead of running under a wrong assumption. If you hit this, re-run `synaphex install` to refresh the registration.

## Related pages

- [MCP tools](mcp-tools.md) — what you can actually call once connected
- [Installation](../getting-started/installation.md) — guided walkthrough
- [Compatibility](compatibility.md) — supported runtimes and minimum versions
