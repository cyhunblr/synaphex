import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import type { AgentName } from "../../src/domain/agent.js";
import type { AgentConfig } from "../../src/domain/agent-config.js";
import {
  ProjectNotFoundError,
  TaskNotFoundError,
} from "../../src/domain/errors.js";
import type { Project, ProjectId } from "../../src/domain/project.js";
import type { EffectiveRule } from "../../src/domain/rule.js";
import type { SessionBinding, SessionId } from "../../src/domain/session.js";
import type { Task, TaskId } from "../../src/domain/task.js";
import { createSynaphexMcpServer } from "../../src/mcp/create-synaphex-mcp-server.js";
import type {
  DirectAgentInvocationPort,
  DirectAgentInvocationRequest,
} from "../../src/operations/direct-agent-invocation.js";
import type { InvocationContinuationPort } from "../../src/operations/invocation-continuation-commands.js";
import type {
  ProjectCommandPort,
  ProjectSessionCommandPort,
  TaskCommandPort,
} from "../../src/operations/project-task-commands.js";
import type {
  SessionCommandPort,
  SessionRecoveryPort,
} from "../../src/operations/session-commands.js";
import type { SynaphexMcpReadDependencies } from "../../src/mcp/synaphex-read-ports.js";

export const FAKE_PROJECT: Project = Object.freeze({
  id: "prj_fixture01" as ProjectId,
  name: "fixture-project",
  sourcePath: "/tmp/synaphex-fixture-project",
  createdAt: "2026-01-01T00:00:00.000Z",
});

export const FAKE_TASK: Task = Object.freeze({
  id: "task_fixture01" as TaskId,
  projectId: FAKE_PROJECT.id,
  slug: "fixture-task",
  description: "A fixture task.",
  status: "active",
  createdAt: "2026-01-02T00:00:00.000Z",
  completedAt: null,
  archivedAt: null,
});

export interface RecordedCall {
  readonly port: string;
  readonly args: readonly unknown[];
}

/**
 * Read-only fakes for the MCP ports.
 *
 * The fakes implement ONLY the read ports, so a Phase-1 handler that tried to
 * mutate state would have nothing to call: mutation isolation is enforced by
 * composition, not by convention.
 */
export class FakeReads {
  readonly calls: RecordedCall[] = [];
  readonly diagnostics: string[] = [];
  agentConfig: AgentConfig = {
    status: "configured",
    provider: "anthropic",
    surface: "cli",
    model: "fixture-model",
    settings: { effort: "high", secretish: "must-not-leak" },
  };
  effectiveRules: EffectiveRule[] = [
    {
      key: { kind: "agent_call", caller: "planner", target: "researcher" },
      decision: "allow",
      source: "task",
    },
    {
      key: { kind: "action", action: "network" },
      decision: "deny",
      source: "default_deny",
    },
  ];
  sessionBinding: SessionBinding | null = {
    sessionId: "session-fixture",
    projectId: FAKE_PROJECT.id,
    taskId: FAKE_TASK.id,
  };
  projectError: Error | null = null;
  taskError: Error | null = null;
  /** Result of a successful openTaskSession, or an error to raise instead. */
  openResult: SessionBinding = {
    sessionId: "ses_00000000000000000000000000000001",
    projectId: FAKE_PROJECT.id,
    taskId: FAKE_TASK.id,
  };
  openError: Error | null = null;
  closeResult: {
    sessionId: SessionId;
    released: boolean;
    releasedTaskId: TaskId | null;
  } = {
    sessionId: "ses_00000000000000000000000000000001",
    released: true,
    releasedTaskId: FAKE_TASK.id,
  };
  closeError: Error | null = null;
  ownerResult: {
    projectId: ProjectId;
    taskId: TaskId;
    claimed: boolean;
    sessionId?: SessionId;
  } = {
    projectId: FAKE_PROJECT.id,
    taskId: FAKE_TASK.id,
    claimed: true,
    sessionId: "ses_00000000000000000000000000000001",
  };
  ownerError: Error | null = null;
  forceReleaseResult: {
    taskId: TaskId;
    released: boolean;
    previousSessionId: SessionId | null;
  } = {
    taskId: FAKE_TASK.id,
    released: true,
    previousSessionId: "ses_00000000000000000000000000000001",
  };
  forceReleaseError: Error | null = null;
  invokeError: Error | null = null;
  continuationId: string | null = null;
  projectTaskError: Error | null = null;

  /** Narrow bootstrap fake; owns no business logic. */
  get projectTaskCommands(): ProjectCommandPort &
    TaskCommandPort &
    ProjectSessionCommandPort {
    const guard = (port: string, args: readonly unknown[]) => {
      this.calls.push({ port, args });
      if (this.projectTaskError !== null) {
        throw this.projectTaskError;
      }
    };
    return {
      registerProject: async (name, sourcePath) => {
        guard("projectTaskCommands.registerProject", [name, sourcePath]);
        return { ...FAKE_PROJECT, name, sourcePath };
      },
      createTask: async (projectId, description) => {
        guard("projectTaskCommands.createTask", [projectId, description]);
        return { ...FAKE_TASK, projectId, description };
      },
      openProjectSession: async (projectId) => {
        guard("projectTaskCommands.openProjectSession", [projectId]);
        return {
          sessionId: "ses_00000000000000000000000000000002",
          projectId,
          taskId: null,
        };
      },
    };
  }
  continuationError: Error | null = null;
  continuationOutcome: unknown = null;

  /** Narrow continuation fake; owns no business logic. */
  get agentContinuation(): InvocationContinuationPort {
    const outcome = (): never =>
      (this.continuationOutcome ?? {
        invocation: defaultInvocationResult({
          agent: "examiner",
          scope: {
            kind: "task_session",
            sessionId: "ses_00000000000000000000000000000001",
          },
          instruction: "x",
        }),
        callerResumeReady: true,
        continuationId: "cont_test",
      }) as never;
    const step = async (port: string, args: readonly unknown[]) => {
      this.calls.push({ port, args });
      if (this.continuationError !== null) {
        throw this.continuationError;
      }
      return outcome();
    };
    return {
      issueFor: (sessionId, invocation) => {
        this.calls.push({
          port: "agentContinuation.issueFor",
          args: [sessionId, invocation.agent],
        });
        return this.continuationId as never;
      },
      executeAllowedHelper: (id, index) =>
        step("agentContinuation.executeAllowedHelper", [id, index]),
      approveAndExecuteHelper: (id, index) =>
        step("agentContinuation.approveAndExecuteHelper", [id, index]),
      resumeCaller: (id) => step("agentContinuation.resumeCaller", [id]),
      approveNetworkAction: (id, index) =>
        step("agentContinuation.approveNetworkAction", [id, index]),
      continueAllowedNetwork: (id, index) =>
        step("agentContinuation.continueAllowedNetwork", [id, index]),
    };
  }

  invokeResult: unknown = null;
  readonly invocations: DirectAgentInvocationRequest[] = [];

  /**
   * Narrow invocation fake. It exposes ONLY `invoke`, so no MCP handler can
   * reach AgentInvocationService, ProviderRouter or a StateStore through it.
   */
  get agentInvocation(): DirectAgentInvocationPort {
    return {
      invoke: async (request) => {
        this.calls.push({
          port: "agentInvocation.invoke",
          args: [request],
        });
        this.invocations.push(request);
        if (this.invokeError !== null) {
          throw this.invokeError;
        }
        return (this.invokeResult ?? defaultInvocationResult(request)) as never;
      },
    };
  }

  /**
   * Narrow recovery fake, separate from ordinary session commands.
   */
  get sessionRecovery(): SessionRecoveryPort {
    return {
      getTaskSessionOwner: async (projectId, taskId) => {
        this.calls.push({
          port: "sessionRecovery.getTaskSessionOwner",
          args: [projectId, taskId],
        });
        if (this.ownerError !== null) {
          throw this.ownerError;
        }
        return this.ownerResult as never;
      },
      forceReleaseTaskSession: async (projectId, taskId) => {
        this.calls.push({
          port: "sessionRecovery.forceReleaseTaskSession",
          args: [projectId, taskId],
        });
        if (this.forceReleaseError !== null) {
          throw this.forceReleaseError;
        }
        return this.forceReleaseResult;
      },
    };
  }

  /**
   * Narrow session-command fake. It implements ONLY the two lifecycle
   * commands, so no broader mutation capability exists in the composition.
   */
  get sessionCommands(): SessionCommandPort {
    return {
      openTaskSession: async (projectId, taskId) => {
        this.calls.push({
          port: "sessionCommands.openTaskSession",
          args: [projectId, taskId],
        });
        if (this.openError !== null) {
          throw this.openError;
        }
        return this.openResult;
      },
      closeSession: async (sessionId) => {
        this.calls.push({
          port: "sessionCommands.closeSession",
          args: [sessionId],
        });
        if (this.closeError !== null) {
          throw this.closeError;
        }
        return this.closeResult;
      },
    };
  }

  get ports(): SynaphexMcpReadDependencies {
    return {
      projectReads: {
        get: async (projectId: ProjectId): Promise<Project> => {
          this.calls.push({ port: "projectReads.get", args: [projectId] });
          if (this.projectError !== null) {
            throw this.projectError;
          }
          if (projectId !== FAKE_PROJECT.id) {
            throw new ProjectNotFoundError(projectId);
          }
          return FAKE_PROJECT;
        },
      },
      taskReads: {
        get: async (projectId: ProjectId, taskId: TaskId): Promise<Task> => {
          this.calls.push({ port: "taskReads.get", args: [projectId, taskId] });
          if (this.taskError !== null) {
            throw this.taskError;
          }
          if (taskId !== FAKE_TASK.id) {
            throw new TaskNotFoundError(projectId, taskId);
          }
          return FAKE_TASK;
        },
      },
      sessionReads: {
        find: async (sessionId: SessionId): Promise<SessionBinding | null> => {
          this.calls.push({ port: "sessionReads.find", args: [sessionId] });
          return this.sessionBinding;
        },
      },
      agentConfigReads: {
        getConfig: async (agent: AgentName): Promise<AgentConfig> => {
          this.calls.push({
            port: "agentConfigReads.getConfig",
            args: [agent],
          });
          return this.agentConfig;
        },
      },
      effectiveRuleReads: {
        listEffectiveRulesReadOnly: async (context): Promise<EffectiveRule[]> => {
          this.calls.push({
            port: "effectiveRuleReads.listEffectiveRulesReadOnly",
            args: [context],
          });
          return this.effectiveRules;
        },
      },
    };
  }
}

export function fakeReadDependencies(): FakeReads {
  return new FakeReads();
}

export interface ConnectedClient {
  readonly client: Client;
  readonly reads: FakeReads;
  close(): Promise<void>;
}

/** Connects a real MCP client to the Synaphex server over an in-memory transport. */
export async function connectedClient(
  reads: FakeReads = fakeReadDependencies(),
): Promise<ConnectedClient> {
  const server = createSynaphexMcpServer({
    ...reads.ports,
    sessionCommands: reads.sessionCommands,
    sessionRecovery: reads.sessionRecovery,
    agentInvocation: reads.agentInvocation,
    agentContinuation: reads.agentContinuation,
    projectTaskCommands: reads.projectTaskCommands,
    version: "0.0.0-test",
    onDiagnostic: (message) => {
      reads.diagnostics.push(message);
    },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "synaphex-test-client", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return {
    client,
    reads,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

/**
 * Minimal invocation result shaped like the real `AgentInvocationResult`,
 * enough for the MCP presenter to map without pulling in provider machinery.
 */
export function defaultInvocationResult(
  request: DirectAgentInvocationRequest,
): Record<string, unknown> {
  return {
    agent: request.agent,
    lineage: {
      rootInvocationId: "invocation_root01",
      currentInvocationId: "invocation_root01",
      parentInvocationId: null,
    },
    scope: {
      sessionId: request.scope.sessionId,
      projectId: FAKE_PROJECT.id,
      taskId: request.scope.kind === "task_session" ? FAKE_TASK.id : null,
    },
    route: {
      agent: request.agent,
      host: { provider: "anthropic", surface: "vscode" },
      provider: "openai",
      configuredSurface: "cli",
      effectiveSurface: "cli",
      cliForcedByCrossProvider: true,
      routingReason: "cross_provider_cli",
      model: `${request.agent}-model`,
    },
    executionPolicy: {
      sourceModification: "read_only",
      providerCapabilities: {
        network: {
          decision: "deny",
          source: "default_deny",
          approvedForInvocation: false,
        },
      },
    },
    processedResult: {
      agent: request.agent,
      outcome: "success",
      summary: `${request.agent} completed.`,
      warnings: [],
      persistedArtifacts: [],
      requestedCalls: [],
      requestedActions: [],
      stateEffects: [],
    },
    helperCalls: [],
    actionClassifications: [],
  };
}
