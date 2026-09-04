#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { AgentConfigManager } from "../core/agent-config-manager.js";
import { PlanManager } from "../core/plan-manager.js";
import { ProjectManager } from "../core/project-manager.js";
import { RuleResolver } from "../core/rule-resolver.js";
import { SessionManager } from "../core/session-manager.js";
import { TaskManager } from "../core/task-manager.js";
import { AgentInvocationService } from "../core/agent-invocation-service.js";
import type { AgentExecutor } from "../domain/agent-invocation.js";
import type { RuntimeAvailability } from "../domain/provider-routing.js";
import { SpawnProcessRunner } from "../infrastructure/process-runner.js";
import { AntigravityCliAgentExecutor } from "../providers/antigravity-cli-agent-executor.js";
import { AntigravityCliRuntimeAvailability } from "../providers/antigravity-cli-runtime-availability.js";
import { ClaudeCliAgentExecutor } from "../providers/claude-cli-agent-executor.js";
import { ClaudeCliRuntimeAvailability } from "../providers/claude-cli-runtime-availability.js";
import { CodexCliAgentExecutor } from "../providers/codex-cli-agent-executor.js";
import { CodexCliRuntimeAvailability } from "../providers/codex-cli-runtime-availability.js";
import { ProviderDispatchingAgentExecutor } from "../providers/provider-dispatching-agent-executor.js";
import { RoleContractRegistry } from "../core/role-contract-registry.js";
import { StateStore } from "../infrastructure/state-store.js";
import { DirectAgentInvocation } from "../operations/direct-agent-invocation.js";
import { InvocationContinuationCommands } from "../operations/invocation-continuation-commands.js";
import { InvocationContinuationStore } from "../operations/invocation-continuation-store.js";
import { PlanDecisionCommands } from "../operations/plan-decision-commands.js";
import { ProjectTaskCommands } from "../operations/project-task-commands.js";
import { SessionCommands } from "../operations/session-commands.js";
import { createSynaphexMcpServer } from "./create-synaphex-mcp-server.js";
import { parseHostContextArguments } from "./mcp-host-context.js";
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

/**
 * Production provider dispatch.
 *
 * This is the composition root -- the ONE place allowed to construct concrete
 * provider adapters. MCP tool handlers never see them; they only ever hold the
 * narrow invocation port.
 *
 * A single `SpawnProcessRunner` is shared: it holds no per-call state and every
 * adapter passes its own capture limits and timeouts per invocation, so reuse
 * changes no adapter behavior. `shell: false` is preserved throughout.
 *
 * Runtime availability probing is deliberately NOT consulted here. Probing is
 * distinct from execution: an adapter fails normally if its runtime cannot
 * execute, and there is no pre-flight executable fallback.
 */
function createProviderDispatchingExecutor(): AgentExecutor {
  const processRunner = new SpawnProcessRunner();
  return new ProviderDispatchingAgentExecutor({
    openaiCli: new CodexCliAgentExecutor({ processRunner }),
    anthropicCli: new ClaudeCliAgentExecutor({ processRunner }),
    googleCli: new AntigravityCliAgentExecutor({ processRunner }),
  });
}

/**
 * Availability is only consulted by ProviderRouter, which asks whether the
 * target runtime exists before returning a CLI route. Each provider owns its
 * own probe, so this composes them by provider/surface without any fallback.
 */
function createRuntimeAvailability(): RuntimeAvailability {
  return {
    async isAvailable(provider, surface) {
      if (surface !== "cli") {
        // Native host surfaces are not callable runtimes; the router treats an
        // active native vscode route separately and the dispatcher fails closed.
        return false;
      }
      const probes = {
        openai: () => new CodexCliRuntimeAvailability().isAvailable(provider, surface),
        anthropic: () =>
          new ClaudeCliRuntimeAvailability().isAvailable(provider, surface),
        google: () =>
          new AntigravityCliRuntimeAvailability().isAvailable(provider, surface),
      } as const;
      return probes[provider]();
    },
  };
}

function diagnostic(message: string): void {
  process.stderr.write(`${message}\n`);
}

export interface StdioMainOptions {
  /**
   * Provider dispatch override, for tests only.
   *
   * Production defaults to the real provider-dispatching executor built from
   * the accepted CLI adapters; tests inject a fake so no real provider process
   * is spawned.
   */
  readonly executor?: AgentExecutor;
  readonly runtimeAvailability?: RuntimeAvailability;
  readonly argv?: readonly string[];
}

export async function main(options: StdioMainOptions = {}): Promise<void> {
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

  // Host identity is parsed once, at startup, and is immutable for the
  // server's lifetime. Tool input can never supply or override it.
  const host = parseHostContextArguments(options.argv ?? process.argv.slice(2));
  diagnostic(
    `[synaphex-mcp] host context: ${host.provider}/${host.surface}`,
  );
  const planCommands = new PlanDecisionCommands({
    plans: new PlanManager(stateStore, tasks),
    tasks,
    sessions,
  });
  const projectTaskCommands = new ProjectTaskCommands({
    projects,
    tasks,
    sessions,
  });
  const continuationStore = new InvocationContinuationStore();
  const invocations = new AgentInvocationService({
    executor: options.executor ?? createProviderDispatchingExecutor(),
    runtimeAvailability:
      options.runtimeAvailability ?? createRuntimeAvailability(),
  });
  const agentContinuation = new InvocationContinuationCommands({
    host,
    invocations,
    store: continuationStore,
    roleContracts: new RoleContractRegistry(),
  });
  const agentInvocation = new DirectAgentInvocation({
    host,
    invocations,
    sessions,
    roleContracts: new RoleContractRegistry(),
  });

  const server = createSynaphexMcpServer({
    version: await readSynaphexVersion(),
    projectReads: projects,
    taskReads: tasks,
    sessionReads: sessions,
    agentConfigReads: agentConfigs,
    effectiveRuleReads: rules,
    sessionCommands,
    sessionRecovery: sessionCommands,
    agentInvocation,
    agentContinuation,
    projectTaskCommands,
    planCommands,
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
