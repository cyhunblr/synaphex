import type { AgentName } from "../domain/agent.js";
import type { AgentConfig } from "../domain/agent-config.js";
import type { Project, ProjectId } from "../domain/project.js";
import type { EffectiveRule } from "../domain/rule.js";
import type { SessionBinding, SessionId } from "../domain/session.js";
import type { Task, TaskId } from "../domain/task.js";

/**
 * Read-only ports the Synaphex MCP layer is allowed to depend on.
 *
 * MCP is a transport/interface layer, never an orchestrator. Phase 1 is
 * intentionally read-only, and that guarantee is structural rather than
 * documentary: these interfaces expose ONLY read operations, so no mutation
 * API (project/task creation, binding, plan, memory, artifact, approval, host
 * action or agent invocation) is reachable from a tool handler. The existing
 * Core managers satisfy these ports directly; business logic -- including rule
 * precedence (task > project > global) -- stays in Core.
 */

export interface ProjectReadPort {
  get(projectId: ProjectId): Promise<Project>;
}

export interface TaskReadPort {
  get(projectId: ProjectId, taskId: TaskId): Promise<Task>;
}

export interface SessionReadPort {
  /** Resolves to `null` when the session has no recorded binding. */
  find(sessionId: SessionId): Promise<SessionBinding | null>;
}

export interface AgentConfigReadPort {
  getConfig(agent: AgentName): Promise<AgentConfig>;
}

export interface EffectiveRuleReadPort {
  /**
   * Must be a non-initializing read. Core's
   * `RuleResolver.listEffectiveRulesReadOnly` owns precedence resolution.
   */
  listEffectiveRulesReadOnly(context?: {
    readonly projectId?: ProjectId;
    readonly taskId?: TaskId;
  }): Promise<EffectiveRule[]>;
}

export interface SynaphexMcpReadDependencies {
  readonly projectReads: ProjectReadPort;
  readonly taskReads: TaskReadPort;
  readonly sessionReads: SessionReadPort;
  readonly agentConfigReads: AgentConfigReadPort;
  readonly effectiveRuleReads: EffectiveRuleReadPort;
}
