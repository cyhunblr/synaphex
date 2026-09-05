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
  ChangeSetDecisionPort,
  ChangeSetReadPort,
} from "../../src/operations/change-set-commands.js";
import type {
  TaskArchivePort,
  TaskCompletionPort,
} from "../../src/operations/task-lifecycle-commands.js";
import type {
  PlanDecisionPort,
  PlanReadPort,
} from "../../src/operations/plan-decision-commands.js";
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
  planError: Error | null = null;
  planDraft: { revisionId: string; content: string } | null = {
    revisionId: "planrev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    content: "# Draft plan\n",
  };
  planCurrent: { content: string } | null = null;

  /** Narrow plan review/decision fake; owns no business logic. */
  get planCommands(): PlanReadPort & PlanDecisionPort {
    const guard = (port: string, args: readonly unknown[]) => {
      this.calls.push({ port, args });
      if (this.planError !== null) {
        throw this.planError;
      }
    };
    const scope = {
      sessionId: "ses_00000000000000000000000000000001",
      projectId: FAKE_PROJECT.id,
      taskId: FAKE_TASK.id,
    };
    return {
      getPlanReviewState: async (sessionId) => {
        guard("planCommands.getPlanReviewState", [sessionId]);
        return {
          ...scope,
          sessionId,
          draft: this.planDraft as never,
          current: this.planCurrent,
        };
      },
      acceptPlanDraft: async (sessionId, draftRevisionId) => {
        guard("planCommands.acceptPlanDraft", [sessionId, draftRevisionId]);
        return {
          ...scope,
          sessionId,
          draftRevisionId: draftRevisionId as never,
          currentContent: "# Draft plan\n",
        };
      },
      rejectPlanDraft: async (sessionId, draftRevisionId) => {
        guard("planCommands.rejectPlanDraft", [sessionId, draftRevisionId]);
        return {
          ...scope,
          sessionId,
          draftRevisionId: draftRevisionId as never,
        };
      },
    };
  }

  changeSetError: Error | null = null;
  changeSetPatch: Buffer = Buffer.from(
    "diff --git a/a.txt b/a.txt\n@@ -1 +1 @@\n-a\n+b\n",
    "utf8",
  );

  /** Narrow change-set review/decision fake; owns no business logic. */
  get changeSetCommands(): ChangeSetReadPort & ChangeSetDecisionPort {
    const guard = (port: string, args: readonly unknown[]) => {
      this.calls.push({ port, args });
      if (this.changeSetError !== null) {
        throw this.changeSetError;
      }
    };
    const scope = {
      projectId: FAKE_PROJECT.id,
      taskId: FAKE_TASK.id,
    };
    const self = this;
    return {
      async getChangeSet(sessionId, changeSetId) {
        guard("changeSetCommands.getChangeSet", [sessionId, changeSetId]);
        return {
          ...scope,
          sessionId,
          changeSetId,
          baseCommit: "1".repeat(40),
          resultTree: "2".repeat(40),
          patchHash: "3".repeat(64),
          patchBytes: self.changeSetPatch.byteLength,
          changedFiles: [
            { path: "a.txt", change: "modified", binary: false } as never,
          ],
          state: "pending" as const,
          decidedAt: null,
          workRecordId: "art_fixture01",
        };
      },
      async readPatch(sessionId, changeSetId, offset, maxBytes) {
        guard("changeSetCommands.readPatch", [
          sessionId,
          changeSetId,
          offset,
          maxBytes,
        ]);
        const total = self.changeSetPatch.byteLength;
        const start = Math.min(offset, total);
        const end = Math.min(start + maxBytes, total);
        const slice = self.changeSetPatch.subarray(start, end);
        return {
          changeSetId,
          offset: start,
          returnedBytes: slice.byteLength,
          nextOffset: end,
          done: end >= total,
          totalBytes: total,
          encoding: "base64" as const,
          data: slice.toString("base64"),
        };
      },
      async getApplyRecoveryState(sessionId, changeSetId) {
        guard("changeSetCommands.getApplyRecoveryState", [
          sessionId,
          changeSetId,
        ]);
        return {
          ...scope,
          sessionId,
          changeSetId,
          state: "applying_interrupted" as const,
          observedSourceState: "base_clean" as const,
          reconciliationAvailable: true,
          diagnostics: {
            headMatchesBase: true,
            indexMatchesBase: true,
            indexMatchesResult: false,
            worktreeMatchesIndex: true,
            hasUntracked: false,
          },
        };
      },
      async reconcileInterruptedApply(sessionId, changeSetId) {
        guard("changeSetCommands.reconcileInterruptedApply", [
          sessionId,
          changeSetId,
        ]);
        return {
          ...scope,
          sessionId,
          changeSetId,
          previousState: "applying_interrupted" as const,
          observedSourceState: "base_clean" as const,
          resultingState: "pending" as const,
        };
      },
      async applyChangeSet(sessionId, changeSetId) {
        guard("changeSetCommands.applyChangeSet", [sessionId, changeSetId]);
        return {
          ...scope,
          sessionId,
          changeSetId,
          state: "applied" as const,
          decidedAt: "2026-02-01T00:00:00.000Z",
          resultTree: "2".repeat(40),
        };
      },
      async rejectChangeSet(sessionId, changeSetId) {
        guard("changeSetCommands.rejectChangeSet", [sessionId, changeSetId]);
        return {
          ...scope,
          sessionId,
          changeSetId,
          state: "rejected" as const,
          decidedAt: "2026-02-01T00:00:00.000Z",
          resultTree: null,
        };
      },
    };
  }

  lifecycleError: Error | null = null;

  /** Narrow lifecycle fake; owns no business logic. */
  get taskLifecycleCommands(): TaskCompletionPort & TaskArchivePort {
    const guard = (port: string, args: readonly unknown[]) => {
      this.calls.push({ port, args });
      if (this.lifecycleError !== null) {
        throw this.lifecycleError;
      }
    };
    return {
      completeTask: async (sessionId) => {
        guard("taskLifecycleCommands.completeTask", [sessionId]);
        return {
          sessionId,
          projectId: FAKE_PROJECT.id,
          taskId: FAKE_TASK.id,
          status: "completed" as const,
          completedAt: "2026-03-01T00:00:00.000Z",
          archivedAt: null,
          sessionRetained: true,
        };
      },
      archiveTask: async (projectId, taskId) => {
        guard("taskLifecycleCommands.archiveTask", [projectId, taskId]);
        return {
          projectId,
          taskId,
          status: "archived" as const,
          completedAt: "2026-03-01T00:00:00.000Z",
          archivedAt: "2026-03-02T00:00:00.000Z",
          releasedTaskSession: true,
        };
      },
    };
  }

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
    memoryReferences: {
      loadMemory: async () => {
        throw new Error("memory references are not exercised in this fixture");
      },
      unloadMemory: async () => {
        throw new Error("memory references are not exercised in this fixture");
      },
      listLoadedMemory: async () => [],
    },
    sessionCommands: reads.sessionCommands,
    sessionRecovery: reads.sessionRecovery,
    agentInvocation: reads.agentInvocation,
    agentContinuation: reads.agentContinuation,
    projectTaskCommands: reads.projectTaskCommands,
    planCommands: reads.planCommands,
    changeSetCommands: reads.changeSetCommands,
    taskLifecycleCommands: reads.taskLifecycleCommands,
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
      host: { provider: "anthropic" },
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
