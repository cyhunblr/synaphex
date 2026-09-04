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
      closeTaskSession: async (sessionId) => {
        this.calls.push({
          port: "sessionCommands.closeTaskSession",
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
