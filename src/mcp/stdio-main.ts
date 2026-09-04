#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { AgentConfigManager } from "../core/agent-config-manager.js";
import { ProjectManager } from "../core/project-manager.js";
import { RuleResolver } from "../core/rule-resolver.js";
import { SessionManager } from "../core/session-manager.js";
import { TaskManager } from "../core/task-manager.js";
import { StateStore } from "../infrastructure/state-store.js";
import { SessionCommands } from "../operations/session-commands.js";
import { createSynaphexMcpServer } from "./create-synaphex-mcp-server.js";
import { readSynaphexVersion } from "./synaphex-mcp-version.js";

/**
 * Local stdio entrypoint for the Synaphex MCP server.
 *
 * This is an INTERNAL integration target for future installer/provider
 * configuration -- it is not a public `synaphex` subcommand. Accepted
 * terminal-facing commands remain `synaphex install` and `synaphex uninstall`.
 *
 * Protocol discipline:
 *   stdin  <- MCP protocol input
 *   stdout -> MCP protocol output ONLY
 *   stderr -> diagnostics
 *
 * There is no daemon behavior, no port binding, and no background mode: the
 * process serves exactly one stdio connection for its lifetime.
 */

function diagnostic(message: string): void {
  process.stderr.write(`${message}\n`);
}

export async function main(): Promise<void> {
  const stateStore = new StateStore();
  const projects = new ProjectManager(stateStore);
  const tasks = new TaskManager(stateStore, projects);
  const sessions = new SessionManager(stateStore);
  const agentConfigs = new AgentConfigManager(stateStore);
  const rules = new RuleResolver(stateStore, projects, tasks);
  // MCP receives only this narrow command port -- never the mutation-capable
  // managers or the StateStore themselves.
  // One implementation satisfies both ports, but MCP receives them as two
  // narrow capabilities so recovery is never reachable by accident.
  const sessionCommands = new SessionCommands({ projects, tasks, sessions });

  const server = createSynaphexMcpServer({
    version: await readSynaphexVersion(),
    projectReads: projects,
    taskReads: tasks,
    sessionReads: sessions,
    agentConfigReads: agentConfigs,
    effectiveRuleReads: rules,
    sessionCommands,
    sessionRecovery: sessionCommands,
    onDiagnostic: diagnostic,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  diagnostic("[synaphex-mcp] ready on stdio");
}

const isDirectInvocation =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectInvocation) {
  main().catch((error: unknown) => {
    // Fatal initialization failure: diagnostics to stderr, non-zero exit.
    diagnostic(
      `[synaphex-mcp] fatal: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    process.exitCode = 1;
  });
}
