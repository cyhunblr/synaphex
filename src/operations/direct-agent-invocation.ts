import type { AgentInvocationService } from "../core/agent-invocation-service.js";
import type { SessionManager } from "../core/session-manager.js";
import type { AgentName } from "../domain/agent.js";
import type { AnyAgentInvocationResult } from "../domain/agent-invocation.js";
import { UnsupportedAgentInvocationError } from "../domain/errors.js";
import type { HostRuntime } from "../domain/provider-routing.js";
import { parseSessionId, type SessionId } from "../domain/session.js";

/**
 * Agents exposed through MCP Phase 3A: the "source-read-only" targets.
 *
 * These five may mutate task-scoped Synaphex state (questioner context,
 * research artifacts, canonical memory, plan drafts, review artifacts and
 * Reviewer task completion) -- that is protected by Phase 2C ownership
 * fencing. "Source-read-only" means only that they must not modify the user's
 * source workspace.
 *
 * CODER is deliberately absent. Phase 2C fencing protects Synaphex state but
 * cannot roll back filesystem changes CODER may already have made in the real
 * source workspace before ownership was revoked. Exposing it needs enforceable
 * cancellation or an isolated workspace first.
 */
export const MCP_INVOCABLE_AGENTS = Object.freeze([
  "questioner",
  "researcher",
  "examiner",
  "planner",
  "reviewer",
] as const);

export type McpInvocableAgent = (typeof MCP_INVOCABLE_AGENTS)[number];

export function isMcpInvocableAgent(
  value: unknown,
): value is McpInvocableAgent {
  return (
    typeof value === "string" &&
    (MCP_INVOCABLE_AGENTS as readonly string[]).includes(value)
  );
}

/**
 * Invocation scope as supplied by a caller.
 *
 * A caller never states a `projectId + taskId + sessionId` triple: for a task
 * session it supplies only the SessionId, and the authoritative Core binding
 * resolves project and task. That makes a mismatched identity tuple
 * impossible to express.
 */
export type DirectInvocationScope =
  | { readonly kind: "task_session"; readonly sessionId: SessionId }
  | { readonly kind: "project"; readonly sessionId: SessionId };

export interface DirectAgentInvocationRequest {
  readonly agent: McpInvocableAgent;
  readonly scope: DirectInvocationScope;
  readonly instruction: string;
}

/**
 * Narrow application boundary for direct-user agent invocation.
 *
 * MCP handlers receive only this port -- never `AgentInvocationService`,
 * `ProviderRouter`, `ContextBuilder` or a StateStore. Lifecycle rules,
 * ownership fencing, role contracts, rule resolution, action/helper
 * classification and provider routing all stay inside existing services.
 */
export interface DirectAgentInvocationPort {
  invoke(
    request: DirectAgentInvocationRequest,
  ): Promise<AnyAgentInvocationResult>;
}

export interface DirectAgentInvocationDependencies {
  /** Immutable, process-bound host identity. Never supplied per request. */
  readonly host: HostRuntime;
  readonly invocations: Pick<AgentInvocationService, "invokeUserAgent">;
  readonly sessions: Pick<SessionManager, "getCurrentBinding">;
  readonly roleContracts: {
    canModifySourceCode(agent: AgentName): boolean;
  };
}

export class DirectAgentInvocation implements DirectAgentInvocationPort {
  constructor(
    private readonly dependencies: DirectAgentInvocationDependencies,
  ) {}

  /**
   * Runs one direct-user invocation.
   *
   * This is the DIRECT-USER entrypoint (`invokeUserAgent`), so accepted
   * semantics apply: a top-level target bypasses the configurable agent->agent
   * edge rule while still obeying lifecycle, config, routing, ExecutionPolicy,
   * provider-capability policy and ownership fencing. Helper requests the
   * agent returns are still classified through normal agent->agent rules.
   *
   * The caller cannot choose the entrypoint, cannot claim to be another
   * Synaphex caller, and cannot supply host identity -- the composition layer
   * decides all three.
   */
  async invoke(
    request: DirectAgentInvocationRequest,
  ): Promise<AnyAgentInvocationResult> {
    if (!isMcpInvocableAgent(request.agent)) {
      // Defence in depth: the wire schema rejects this first.
      throw new UnsupportedAgentInvocationError(
        String(request.agent),
        "agent_not_invocable",
      );
    }
    // Defence in depth against a Core defect or misconfiguration: every agent
    // exposed in this slice must resolve to read_only source modification.
    // Failing closed is preferred over silently continuing.
    if (this.dependencies.roleContracts.canModifySourceCode(request.agent)) {
      throw new UnsupportedAgentInvocationError(
        request.agent,
        "source_modification_not_permitted",
      );
    }

    const sessionId = parseSessionId(request.scope.sessionId);
    if (request.scope.kind === "project") {
      // A project-scope request must not silently run against a task session.
      // Role/scope eligibility itself stays in Core: `resolveAndValidatePreflight`
      // raises NoTaskBoundError for roles whose taskBinding is "required".
      const binding = await this.dependencies.sessions.getCurrentBinding(
        sessionId,
      );
      if (binding.taskId !== null) {
        throw new UnsupportedAgentInvocationError(
          request.agent,
          "project_scope_requires_unbound_task",
        );
      }
    }

    return (await this.dependencies.invocations.invokeUserAgent({
      sessionId,
      agent: request.agent,
      host: this.dependencies.host,
      instruction: request.instruction,
    })) as AnyAgentInvocationResult;
  }
}
