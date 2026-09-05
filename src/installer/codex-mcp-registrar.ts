import {
  ProviderMcpRegistrationConflictError,
  ProviderMcpRegistrationFailedError,
  ProviderMcpUnregistrationFailedError,
} from "../domain/errors.js";
import {
  SYNAPHEX_MCP_SERVER_REGISTRATION_NAME,
  formatTarget,
  launcherArgsFor,
  type HostAvailability,
  type InstallationTarget,
  type SynaphexLauncher,
} from "../domain/installation.js";
import {
  summarizeFailure,
  type ProviderCommandRunner,
} from "./provider-command-runner.js";
import {
  INSTALLER_MINIMUM_VERSIONS,
  meetsMinimum,
  parseVersion,
} from "./provider-runtime-versions.js";
import type {
  ProviderMcpRegistrar,
  RegistrationInspection,
} from "./provider-mcp-registrar.js";

const EXECUTABLE = "codex";

/**
 * Registers Synaphex with the OpenAI Codex CLI using its official
 * `codex mcp add|list|remove` commands.
 *
 * Verified against codex-cli 0.153.0: registration writes only the
 * `[mcp_servers.<name>]` table of `~/.codex/config.toml`, and
 * `codex mcp list --json` round-trips the exact command and args. Synaphex
 * never edits that file itself -- the provider owns its own schema and may
 * migrate it.
 *
 * This adapter also serves the OpenAI **VS Code** surface: the
 * `openai.chatgpt` extension reads the same `CODEX_HOME` configuration, so
 * one registration covers both. That was verified by inspecting the installed
 * extension, not assumed.
 */
export class CodexMcpRegistrar implements ProviderMcpRegistrar {
  constructor(
    readonly target: InstallationTarget,
    private readonly runner: ProviderCommandRunner,
    private readonly executable: string = EXECUTABLE,
  ) {}

  async detect(home?: string): Promise<HostAvailability> {
    const result = await this.run(["--version"], home);
    if (result.exitCode === 127) {
      return { state: "not_found" };
    }
    const version = parseVersion(`${result.stdout}${result.stderr}`);
    if (result.exitCode !== 0 || version === null) {
      return {
        state: "registration_unsupported",
        reason: "the runtime did not report a usable version",
      };
    }
    const minimum = INSTALLER_MINIMUM_VERSIONS.openai;
    if (!meetsMinimum(version, minimum)) {
      return { state: "unsupported_version", version: version.display, minimum };
    }
    return { state: "available", version: version.display };
  }

  async inspect(
    launcher: SynaphexLauncher,
    home?: string,
  ): Promise<RegistrationInspection> {
    const result = await this.run(["mcp", "list", "--json"], home);
    if (result.exitCode !== 0) {
      return { state: "unknown", detail: summarizeFailure(result) };
    }
    let entries: unknown;
    try {
      entries = JSON.parse(result.stdout.slice(result.stdout.indexOf("[")));
    } catch {
      return { state: "unknown", detail: "could not parse the server listing" };
    }
    if (!Array.isArray(entries)) {
      return { state: "unknown", detail: "unexpected server listing shape" };
    }
    const entry = entries.find(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        (candidate as { name?: unknown }).name ===
          SYNAPHEX_MCP_SERVER_REGISTRATION_NAME,
    ) as { transport?: { command?: unknown; args?: unknown } } | undefined;
    if (entry === undefined) {
      return { state: "absent" };
    }
    return classifyRegistration(
      entry.transport?.command,
      entry.transport?.args,
      launcher,
      this.target,
    );
  }

  async register(launcher: SynaphexLauncher, home?: string): Promise<void> {
    const inspection = await this.inspect(launcher, home);
    if (inspection.state === "foreign") {
      throw new ProviderMcpRegistrationConflictError(
        formatTarget(this.target),
        SYNAPHEX_MCP_SERVER_REGISTRATION_NAME,
      );
    }
    if (inspection.state === "current") {
      return;
    }
    if (inspection.state === "outdated") {
      // Synaphex-owned but stale: replace it with the expected launcher.
      await this.run(["mcp", "remove", SYNAPHEX_MCP_SERVER_REGISTRATION_NAME], home);
    }
    const result = await this.run(
      [
        "mcp",
        "add",
        SYNAPHEX_MCP_SERVER_REGISTRATION_NAME,
        "--",
        launcher.command,
        ...launcherArgsFor(launcher.args[0]!, this.target),
      ],
      home,
    );
    if (result.exitCode !== 0) {
      throw new ProviderMcpRegistrationFailedError(
        formatTarget(this.target),
        summarizeFailure(result),
      );
    }
  }

  async unregister(home?: string): Promise<void> {
    const result = await this.run(
      ["mcp", "remove", SYNAPHEX_MCP_SERVER_REGISTRATION_NAME],
      home,
    );
    if (result.exitCode !== 0) {
      throw new ProviderMcpUnregistrationFailedError(
        formatTarget(this.target),
        summarizeFailure(result),
      );
    }
  }

  private async run(args: readonly string[], home?: string) {
    return this.runner.run({
      command: this.executable,
      args,
      ...(home === undefined ? {} : { home }),
    });
  }
}

/**
 * Decides whether an existing entry is Synaphex-managed.
 *
 * The fingerprint is behavioural, not a secret: the launcher must point at a
 * Synaphex MCP entrypoint AND carry exactly this surface's immutable host
 * context. No ownership token is stored, and no credential is involved. An
 * entry that has drifted to an unknown command is reported `foreign` so it is
 * never overwritten or deleted.
 */
export function classifyRegistration(
  command: unknown,
  args: unknown,
  launcher: SynaphexLauncher,
  target: InstallationTarget,
): RegistrationInspection {
  if (typeof command !== "string" || !Array.isArray(args)) {
    return { state: "foreign", detail: "unrecognized launcher shape" };
  }
  const argv = args.filter((value): value is string => typeof value === "string");
  const entrypoint = argv[0];
  if (entrypoint === undefined || !isSynaphexEntrypoint(entrypoint)) {
    return {
      state: "foreign",
      detail: "the registered command is not a Synaphex MCP entrypoint",
    };
  }
  const expected = [launcher.command, ...launcherArgsFor(launcher.args[0]!, target)];
  const actual = [command, ...argv];
  if (expected.length === actual.length && expected.every((v, i) => v === actual[i])) {
    return { state: "current" };
  }
  return {
    state: "outdated",
    detail: "the registered launcher does not match this installation",
  };
}

function isSynaphexEntrypoint(value: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  return (
    normalized.endsWith("/dist/mcp/stdio-main.js") ||
    normalized.endsWith("/synaphex-mcp-stdio") ||
    normalized === "synaphex-mcp-stdio"
  );
}
