#!/usr/bin/env node
/**
 * A deterministic stand-in for a provider CLI's MCP management surface.
 *
 * CI must not require real `codex`, `claude` or `agy` installations, nor any
 * provider authentication. This implements ONLY the commands each Synaphex
 * registrar actually calls, matching the shapes verified against the real
 * runtimes in Phase 6B1:
 *
 * ```text
 * codex   --version | mcp add <name> -- <cmd...> | mcp list --json | mcp remove <name>
 * claude  --version | mcp add <name> --scope user -- <cmd...> | mcp remove <name> -s user
 * agy     --version | mcp add <name> -- <cmd...> | mcp remove <name>
 * ```
 *
 * State is written to the same config paths the real runtimes use, under the
 * HOME it is given, so the registrars' real inspection code paths run
 * unmodified.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const flavor = process.env.FAKE_PROVIDER_FLAVOR ?? "codex";
const version = process.env.FAKE_PROVIDER_VERSION ?? defaultVersion(flavor);
const home = process.env.HOME ?? "";
const argv = process.argv.slice(2);

function defaultVersion(kind) {
  // At or above each installer minimum verified in Phase 6B1.
  return { codex: "0.153.0", claude: "2.1.260", agy: "1.1.26" }[kind] ?? "0.0.0";
}

function configPath() {
  if (flavor === "codex") return join(home, ".codex", "mcp-servers.json");
  if (flavor === "claude") return join(home, ".claude.json");
  return join(home, ".gemini", "config", "mcp_config.json");
}

function readServers() {
  const path = configPath();
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  // A zero-byte or whitespace-only file is ordinary "no servers" state; this
  // is exactly the shape that broke installation on a real machine.
  if (raw.trim().length === 0) return {};
  try {
    return JSON.parse(raw).mcpServers ?? {};
  } catch {
    return {};
  }
}

function writeServers(servers) {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`);
}

if (argv[0] === "--version") {
  process.stdout.write(`${flavor === "claude" ? `${version} (Claude Code)` : version}\n`);
  process.exit(0);
}

if (argv[0] !== "mcp") {
  process.stderr.write(`unsupported command: ${argv.join(" ")}\n`);
  process.exit(2);
}

const sub = argv[1];
const servers = readServers();

if (sub === "list") {
  if (flavor === "codex") {
    process.stdout.write(
      `${JSON.stringify(
        Object.entries(servers).map(([name, entry]) => ({
          name,
          transport: { type: "stdio", command: entry.command, args: entry.args },
        })),
      )}\n`,
    );
  } else {
    for (const [name, entry] of Object.entries(servers)) {
      process.stdout.write(`${name}: ${entry.command} ${(entry.args ?? []).join(" ")}\n`);
    }
  }
  process.exit(0);
}

if (sub === "add") {
  // Everything after the `--` separator is the launcher argv; provider flags
  // such as `--scope user` sit before it.
  const separator = argv.indexOf("--");
  const name = argv[2];
  const launcher = separator >= 0 ? argv.slice(separator + 1) : argv.slice(3);
  if (name === undefined || launcher.length === 0) {
    process.stderr.write("usage: mcp add <name> -- <command> [args...]\n");
    process.exit(2);
  }
  servers[name] = { type: "stdio", command: launcher[0], args: launcher.slice(1) };
  writeServers(servers);
  process.stdout.write(`Added MCP server '${name}'.\n`);
  process.exit(0);
}

if (sub === "remove") {
  const name = argv[2];
  if (!(name in servers)) {
    process.stderr.write(`no such server: ${name}\n`);
    process.exit(1);
  }
  delete servers[name];
  writeServers(servers);
  process.stdout.write(`Removed MCP server '${name}'.\n`);
  process.exit(0);
}

process.stderr.write(`unsupported mcp subcommand: ${String(sub)}\n`);
process.exit(2);
