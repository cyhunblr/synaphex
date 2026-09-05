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

/** Antigravity, NOT Gemini CLI. Gemini support stays deliberately absent. */
const EXECUTABLE = "agy";

/**
 * Registers Synaphex with the Antigravity CLI using its official
 * `agy mcp add|list|remove` commands.
 *
 * Verified against agy 1.1.26: registration writes only the `mcpServers` map
 * of `~/.gemini/config/mcp_config.json`. Synaphex never edits that file --
 * only `agy` does.
 *
 * Note the capability distinction this adapter embodies: Synaphex being able
 * to CALL Antigravity as an agent provider (an executor concern) is a
 * different thing from Antigravity HOSTING Synaphex over MCP (this concern).
 * Both happen to be supported, but they are separate capabilities.
 *
 * There is no Antigravity IDE/VS Code surface, so this adapter serves
 * `google/cli` only.
 *
 * `agy mcp list` prints a human table rather than JSON, so inspection reads
 * the config file directly; registration and removal still go through the
 * official commands.
 */
export class AntigravityMcpRegistrar implements ProviderMcpRegistrar {
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
    const minimum = INSTALLER_MINIMUM_VERSIONS.google;
    if (!meetsMinimum(version, minimum)) {
      return { state: "unsupported_version", version: version.display, minimum };
    }
    return { state: "available", version: version.display };
  }

  async inspect(
    launcher: SynaphexLauncher,
    home?: string,
  ): Promise<RegistrationInspection> {
    const configPath = join(
      home ?? homedir(),
      ".gemini",
      "config",
      "mcp_config.json",
    );
    let raw: string;
    try {
      raw = await readFile(configPath, "utf8");
    } catch {
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
    // `agy mcp add` documents itself as "add or update", so a stale
    // Synaphex-owned entry is replaced in place without a remove first.
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
