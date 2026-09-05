import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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
import { classifyRegistration } from "./codex-mcp-registrar.js";
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

const EXECUTABLE = "claude";
/** `user` scope is the global config both the CLI and the extension read. */
const SCOPE = "user";

/**
 * Registers Synaphex with the Anthropic Claude Code CLI using its official
 * `claude mcp add --scope user` / `remove -s user` commands.
 *
 * Verified against Claude Code 2.1.260: the user scope writes the
 * `mcpServers` map of `~/.claude.json`, and the `anthropic.claude-code` VS
 * Code extension reads that same file. One registration therefore covers both
 * the CLI and VS Code surfaces -- verified by inspecting the installed
 * extension rather than assumed.
 *
 * Inspection reads the config file directly instead of `claude mcp list`,
 * because that command HEALTH-CHECKS every server: it would spawn each
 * registered MCP process merely to answer a question about configuration.
 * Reading is a strict subset of what the official command does and has no
 * side effects; registration and removal still go through the official
 * commands so the provider owns its own schema.
 */
export class ClaudeMcpRegistrar implements ProviderMcpRegistrar {
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
    const minimum = INSTALLER_MINIMUM_VERSIONS.anthropic;
    if (!meetsMinimum(version, minimum)) {
      return { state: "unsupported_version", version: version.display, minimum };
    }
    return { state: "available", version: version.display };
  }

  async inspect(
    launcher: SynaphexLauncher,
    home?: string,
  ): Promise<RegistrationInspection> {
    const configPath = join(home ?? homedir(), ".claude.json");
    let raw: string;
    try {
      raw = await readFile(configPath, "utf8");
    } catch {
      // No config yet simply means nothing is registered.
      return { state: "absent" };
    }
    if (raw.trim().length === 0) {
      // A provider may leave an empty config file behind; that means "no
      // servers configured", not "corrupt". Treating it as unverifiable would
      // wedge installation on a perfectly ordinary state.
      return { state: "absent" };
    }
    let config: unknown;
    try {
      config = JSON.parse(raw);
    } catch {
      return { state: "unknown", detail: "the provider config is not valid JSON" };
    }
    const servers = (config as { mcpServers?: Record<string, unknown> })
      .mcpServers;
    if (typeof servers !== "object" || servers === null) {
      return { state: "absent" };
    }
    const entry = servers[SYNAPHEX_MCP_SERVER_REGISTRATION_NAME] as
      | { command?: unknown; args?: unknown }
      | undefined;
    if (entry === undefined) {
      return { state: "absent" };
    }
    return classifyRegistration(entry.command, entry.args, launcher, this.target);
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
      await this.run(
        ["mcp", "remove", SYNAPHEX_MCP_SERVER_REGISTRATION_NAME, "-s", SCOPE],
        home,
      );
    }
    const result = await this.run(
      [
        "mcp",
        "add",
        SYNAPHEX_MCP_SERVER_REGISTRATION_NAME,
        "--scope",
        SCOPE,
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
      ["mcp", "remove", SYNAPHEX_MCP_SERVER_REGISTRATION_NAME, "-s", SCOPE],
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
