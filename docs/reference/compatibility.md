# Compatibility

The canonical support matrix for Synaphex v0.1. When you need to answer "does
Synaphex support X?", this is the page.


## Reference index

- [CLI](cli.md)
- [MCP tools](mcp-tools.md)
- [Errors](errors.md)
- [Filesystem layout](filesystem-layout.md)
- **Compatibility**

## Operating system and runtime

| | Status |
| --- | --- |
| Linux | **Supported** |
| macOS | Not currently claimed or supported |
| Windows | Not currently claimed or supported |

| Node.js | Status |
| --- | --- |
| Declared requirement | `engines: node >=20` |
| Explicitly verified in CI | **20 and 22**, on Linux |
| Other majors | Permitted by `engines`, not validated |

`>=20` is what the package declares; CI verifies exactly 20 and 22. Newer majors are not blocked, but no claim is made that they have been validated.

## MCP host compatibility

All three provider runtimes can host Synaphex.

| Provider runtime | MCP host | Notes |
| --- | --- | --- |
| OpenAI / Codex | Supported | Provider-only host identity |
| Anthropic / Claude | Supported | Provider-only host identity |
| Google / Antigravity | Supported | Provider-only host identity |

Host identity is the **provider**, passed as `--host-provider` at startup. Synaphex does not model which UI you launched from, and no MCP tool input can change host identity.

## Agent target compatibility

Whether Synaphex can *host* from a provider and whether it can *invoke an agent on* that provider are different questions.

| Provider | `cli` target | `vscode` target |
| --- | --- | --- |
| OpenAI | **Supported** | Unsupported |
| Anthropic | **Supported** | Unsupported |
| Google / Antigravity | Recognized, but **fails closed** — see below | Unsupported |

`vscode` targets are refused before routing, reported as `AGENT_TARGET_SURFACE_UNSUPPORTED`.

A same-provider `cli` target still launches a **separate provider CLI process** — invoking an OpenAI agent from a Codex host runs a new `codex` process rather than reusing the host.

### Google / Antigravity

Antigravity is fully wired as an agent target and its runtime is capability-probed, but **every execution attempt is refused**, by design.

`agy` exposes tool-execution policy, file access, network access, and permission grants only as **persistent global or project settings** — there is no invocation-scoped policy. Synaphex will not mutate provider-owned settings, so it cannot establish a per-invocation read-only or workspace-write contract. Rather than presenting a provider limitation as a guarantee, it fails closed:

| Agent kind | Policy required | Result |
| --- | --- | --- |
| Read-only agents (QUESTIONER, RESEARCHER, EXAMINER, PLANNER, REVIEWER) | `read_only` | Refused — not enforceable per invocation |
| CODER | `workspace_write` | Refused — not enforceable per invocation |

`--mode plan` and `--sandbox` are defence-in-depth only; neither denies command, MCP, or URL execution when a persistent grant allows it.

This is deliberate fail-closed behavior, not an unfinished integration. Use Google as an **MCP host**; configure agent targets on OpenAI or Anthropic.

## Provider runtime versions

Two different capabilities, with different requirements:

| Runtime | Capability | Minimum enforced | Verified against |
| --- | --- | --- | --- |
| `codex` | MCP host registration | **0.153.0** | 0.153.0 |
| `claude` | MCP host registration | **2.1.260** | 2.1.260 |
| `agy` | MCP host registration | **1.1.26** | 1.1.26 |
| `claude` | Agent execution | **2.1.248** | 2.1.248 |
| `codex` | Agent execution | No version floor — presence probe only | — |
| `agy` | Agent execution | No version floor — capability probe only | — |

Registration minimums are the versions whose official MCP command syntax was verified directly. They are set at the verified version rather than guessed lower.

For execution, `codex` is checked only for a successful `--version`, and `agy` is checked by probing `--help` for required flags and modes rather than by version number. **No Google execution minimum is stated**, because Google execution is unavailable regardless of version.

## Provider authentication

Synaphex relies entirely on provider-owned authentication and stores no credentials. There is no API-key mode and no credential matrix — a provider CLI is either already authenticated or it is not. See [credentials and auth](../security/credentials-and-auth.md).

## Host UX caveats

- OpenAI and Anthropic share one MCP configuration between their CLI and VS Code surfaces, so a registration made for the CLI may also be consumed by the VS Code UI. Synaphex host identity stays provider-only either way.
- Antigravity's headless MCP usage may require provider-side approval or a permission flag before it will launch Synaphex.

## Git requirements

Git is required for the **CODER and change-set workflow**, not for Synaphex as a whole.

| Operation | Needs Git? |
| --- | --- |
| Projects, tasks, sessions, rules, memory, plans | No |
| RESEARCHER, EXAMINER, PLANNER, REVIEWER, QUESTIONER | No |
| CODER invocation, change sets, apply, recovery | **Yes** |

CODER additionally requires a **clean worktree** at invocation. Uncommitted changes fail with `CODER_STAGING_WORKTREE_DIRTY`, so your in-progress work is never mixed into a staged capture.

## Product package surface

| | |
| --- | --- |
| npm package | `synaphex` |
| Version | 0.1.0 |
| License | Apache-2.0 |
| Shape | CLI and MCP application |
| Node SDK | **None.** `exports` is closed |

There is no supported programmatic API. Deep imports into `dist/` are not a public interface and may change without notice.

## Known v0.x support boundaries

| Boundary | Classification |
| --- | --- |
| `vscode` agent targets | Unsupported |
| Google/Antigravity agent execution | Unavailable / fail-closed |
| macOS and Windows | Unsupported |
| CODER requires a clean Git worktree | Workflow limitation |
| Apply stages changes; never commits or pushes | Workflow limitation |
| `git_push` and `ci` host actions recorded, never executed | Deferred capability |
| Task reopen and unarchive | Unsupported by design |
| Node SDK / programmatic API | Deferred capability |
| Application-level state encryption | Unsupported |
| Agent `settings` field | Accepted in config, unusable in v0.1 |

## Related pages

- [Providers and routing](../concepts/providers-and-routing.md)
- [Agent configuration](../configuration/agent-config.md)
- [Errors](errors.md)
