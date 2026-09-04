import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { AGENT_NAMES } from "../domain/agent.js";
import { RULE_DECISIONS, RULE_SCOPES, formatRuleKey } from "../domain/rule.js";
import type { AnyAgentInvocationResult } from "../domain/agent-invocation.js";
import type { PlanDraftRevisionId } from "../domain/plan.js";
import { parseSessionId } from "../domain/session.js";
import { TASK_STATUSES } from "../domain/task.js";
import { toMcpToolFailure } from "./mcp-error-mapping.js";
import {
  parseAgentName,
  parseProjectId,
  parseTaskId,
} from "./mcp-input-validation.js";
import {
  MCP_DIRECT_INVOCABLE_AGENTS,
  type DirectAgentInvocationPort,
} from "../operations/direct-agent-invocation.js";
import type {
  ContinuationOutcome,
  InvocationContinuationPort,
} from "../operations/invocation-continuation-commands.js";
import type {
  ProjectCommandPort,
  ProjectSessionCommandPort,
  TaskCommandPort,
} from "../operations/project-task-commands.js";
import type {
  PlanDecisionPort,
  PlanReadPort,
} from "../operations/plan-decision-commands.js";
import type {
  SessionCommandPort,
  SessionRecoveryPort,
} from "../operations/session-commands.js";
import type { SynaphexMcpReadDependencies } from "./synaphex-read-ports.js";

/**
 * Synaphex MCP server (Phase 1).
 *
 * MCP is a thin transport/interface layer over existing Synaphex Core
 * services, NOT an orchestrator. The user remains the orchestrator; this
 * server exposes deterministic read-only domain lookups and nothing else.
 *
 * Structural guarantees:
 * - handlers depend only on the read-only ports in `synaphex-read-ports.ts`,
 *   so no mutation, approval, host-action or agent-invocation API is reachable;
 * - no provider executor (Codex/Claude/Antigravity) is imported;
 * - no filesystem, shell or network primitive is exposed as a tool;
 * - business logic (including rule precedence) stays in Core.
 */

export const SYNAPHEX_MCP_SERVER_NAME = "synaphex";

/** Read-only tools accepted in Phase 1. */
export const SYNAPHEX_MCP_PHASE1_TOOLS = Object.freeze([
  "synaphex_get_project",
  "synaphex_get_task",
  "synaphex_get_session",
  "synaphex_get_agent_config",
  "synaphex_get_effective_rules",
] as const);

/**
 * Session-lifecycle mutation tools added in Phase 2A.
 *
 * These are the ONLY mutating tools: they open and close a logical Synaphex
 * session binding and nothing else. There is deliberately no
 * `synaphex_get_current_session` -- session identity is always explicit,
 * because a provider host or MCP subprocess can restart and a conversation can
 * reconnect without that redefining domain identity.
 */
export const SYNAPHEX_MCP_SESSION_TOOLS = Object.freeze([
  "synaphex_open_task_session",
  "synaphex_open_project_session",
  "synaphex_close_session",
] as const);

/**
 * Project/task bootstrap (Phase 4A).
 *
 * These make normal work self-service through local stdio MCP:
 * register an existing workspace, create a task, then open a session.
 * Creating any of them never invokes an agent.
 */
export const SYNAPHEX_MCP_BOOTSTRAP_TOOLS = Object.freeze([
  "synaphex_register_project",
  "synaphex_create_task",
] as const);

/**
 * Plan review and deterministic decisions (Phase 4B).
 *
 * Plan authority changes ONLY through these tools. Natural-language approval
 * in a Planner result has no authority, and decisions are bound to the exact
 * draft revision the user reviewed.
 */
export const SYNAPHEX_MCP_PLAN_TOOLS = Object.freeze([
  "synaphex_get_plan_state",
  "synaphex_accept_plan_draft",
  "synaphex_reject_plan_draft",
] as const);

/**
 * Explicit user-driven recovery tools (Phase 2B).
 *
 * Synaphex has no lease, heartbeat, PID check or automatic stale-session
 * expiry. When a provider host crashes or the caller loses a SessionId, the
 * task claim persists on purpose; the user recovers it explicitly with these.
 */
export const SYNAPHEX_MCP_RECOVERY_TOOLS = Object.freeze([
  "synaphex_get_task_session_owner",
  "synaphex_force_release_task_session",
] as const);

/**
 * Agent invocation (Phase 3A). Exactly one generic tool rather than five
 * near-identical ones. CODER is excluded at the schema level.
 */
export const SYNAPHEX_MCP_INVOCATION_TOOLS = Object.freeze([
  "synaphex_invoke_agent",
] as const);

/**
 * Explicit continuation tools (Phase 3C).
 *
 * The user remains the orchestrator: a helper is never auto-executed and an
 * action is never auto-approved. Each of these is an explicit, one-time,
 * invocation-scoped step keyed by an opaque server-issued continuation handle.
 *
 * Host actions (`git_push`, `ci`) are deliberately absent -- no real
 * HostActionExecutor exists, so an approval tool for them would be meaningless.
 */
export const SYNAPHEX_MCP_CONTINUATION_TOOLS = Object.freeze([
  "synaphex_execute_helper",
  "synaphex_approve_and_execute_helper",
  "synaphex_resume_caller",
  "synaphex_approve_network_action",
  "synaphex_continue_allowed_network",
] as const);

/** Every tool this server registers. */
export const SYNAPHEX_MCP_TOOLS = Object.freeze([
  ...SYNAPHEX_MCP_PHASE1_TOOLS,
  ...SYNAPHEX_MCP_BOOTSTRAP_TOOLS,
  ...SYNAPHEX_MCP_PLAN_TOOLS,
  ...SYNAPHEX_MCP_SESSION_TOOLS,
  ...SYNAPHEX_MCP_RECOVERY_TOOLS,
  ...SYNAPHEX_MCP_INVOCATION_TOOLS,
  ...SYNAPHEX_MCP_CONTINUATION_TOOLS,
] as const);

export interface CreateSynaphexMcpServerOptions
  extends SynaphexMcpReadDependencies {
  /**
   * Narrow session-lifecycle command boundary. MCP receives only this port --
   * never a mutation-capable TaskManager, SessionManager or StateStore.
   */
  readonly sessionCommands: SessionCommandPort;
  /**
   * Explicit recovery boundary, kept separate from ordinary session commands
   * so force release can never be reached by accident.
   */
  readonly sessionRecovery: SessionRecoveryPort;
  /**
   * Narrow direct-user invocation boundary. MCP never receives
   * AgentInvocationService, ProviderRouter or ContextBuilder directly, and the
   * process-bound HostContext lives inside this port -- tool input cannot
   * supply or override it.
   */
  readonly agentInvocation: DirectAgentInvocationPort;
  /**
   * Narrow continuation boundary. MCP never receives the continuation store
   * itself, so tool handlers own no continuation business logic.
   */
  readonly agentContinuation: InvocationContinuationPort;
  /**
   * Narrow project/task bootstrap boundary. MCP never receives a
   * mutation-capable ProjectManager, TaskManager or SessionManager.
   */
  readonly projectTaskCommands: ProjectCommandPort &
    TaskCommandPort &
    ProjectSessionCommandPort;
  /**
   * Narrow plan review/decision boundary. MCP never receives a
   * mutation-capable PlanManager.
   */
  readonly planCommands: PlanReadPort & PlanDecisionPort;
  /** Server version; callers pass the package.json version (never duplicated here). */
  readonly version: string;
  /** Diagnostics sink. Defaults to stderr so MCP stdout stays protocol-only. */
  readonly onDiagnostic?: (message: string) => void;
}

const projectIdSchema = z
  .string()
  .describe("Synaphex project id, e.g. prj_1a2b3c.");
const taskIdSchema = z.string().describe("Synaphex task id, e.g. task_1a2b3c.");

const projectOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  sourcePath: z.string(),
  createdAt: z.string(),
});

const taskOutputSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  slug: z.string(),
  description: z.string(),
  status: z.enum(TASK_STATUSES),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
});

const sessionOutputSchema = z.object({
  sessionId: z.string(),
  bound: z.boolean(),
  projectId: z.string().nullable(),
  taskId: z.string().nullable(),
});

const openTaskSessionOutputSchema = z.object({
  sessionId: z.string(),
  projectId: z.string(),
  taskId: z.string(),
  bound: z.literal(true),
});

const closeSessionOutputSchema = z.object({
  sessionId: z.string(),
  /** True only when a task claim was actually released. */
  released: z.boolean(),
  releasedTaskId: z.string().nullable(),
  /** A fully closed session retains no binding record. */
  bound: z.literal(false),
});

const taskSessionOwnerOutputSchema = z.object({
  projectId: z.string(),
  taskId: z.string(),
  claimed: z.boolean(),
  sessionId: z.string().nullable(),
});

const forceReleaseOutputSchema = z.object({
  projectId: z.string(),
  taskId: z.string(),
  /** True only when a claim was actually released; false is a no-op. */
  released: z.boolean(),
  previousSessionId: z.string().nullable(),
});

const MAX_INSTRUCTION_LENGTH = 8_000;

/**
 * Invocation input.
 *
 * The agent enum is exactly the Phase-3A source-read-only targets, so `coder`
 * is rejected by schema validation before any application code runs. Scope is
 * a discriminated union: a caller supplies only a sessionId, never a
 * contradictory projectId+taskId+sessionId triple. There is deliberately no
 * hostProvider/hostSurface/caller/directUser field -- host identity is
 * immutable process configuration and the entrypoint is chosen by the server.
 */
const invokeAgentInputSchema = z.object({
  agent: z
    .enum(MCP_DIRECT_INVOCABLE_AGENTS)
    .describe(
      "Synaphex logical agent to invoke. CODER edits an isolated staging clone and produces a proposed change set; the registered source workspace is not modified.",
    ),
  scope: z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("task_session"),
        sessionId: z
          .string()
          .describe(
            "Synaphex session id; the authoritative binding resolves project and task.",
          ),
      }),
      z.object({
        kind: z.literal("project"),
        sessionId: z
          .string()
          .describe("Synaphex session id bound to a project with no task."),
      }),
    ])
    .describe("Invocation scope."),
  instruction: z
    .string()
    .min(1)
    .max(MAX_INSTRUCTION_LENGTH)
    .describe("The user instruction for this invocation."),
});

const invokeAgentOutputSchema = z.object({
  agent: z.string(),
  outcome: z.string(),
  summary: z.string(),
  scope: z.object({
    sessionId: z.string(),
    projectId: z.string(),
    taskId: z.string().nullable(),
  }),
  route: z.object({
    provider: z.string(),
    configuredSurface: z.string(),
    effectiveSurface: z.string(),
    routingReason: z.string(),
    model: z.string(),
    host: z.object({ provider: z.string(), surface: z.string() }),
  }),
  executionPolicy: z.object({
    sourceModification: z.string(),
  }),
  lineage: z.object({
    rootInvocationId: z.string(),
    currentInvocationId: z.string(),
    parentInvocationId: z.string().nullable(),
  }),
  result: z.record(z.string(), z.unknown()),
  // Classifications are REPORTED, never executed: the user stays the
  // orchestrator, so MCP does not auto-run an allowed helper or auto-approve
  // an action.
  requestedCalls: z.array(
    z.object({
      target: z.string(),
      purpose: z.string(),
      status: z.string(),
      immutableReason: z.string().nullable(),
      ruleDecision: z.string().nullable(),
      ruleSource: z.string().nullable(),
      errorCode: z.string().nullable(),
    }),
  ),
  requestedActions: z.array(
    z.object({
      action: z.string(),
      status: z.string(),
      executionKind: z.string(),
      ruleDecision: z.string().nullable(),
      ruleSource: z.string().nullable(),
      errorCode: z.string().nullable(),
    }),
  ),
  /**
   * Present only when at least one request can be progressed through a
   * continuation tool. Denied/forbidden/unavailable requests and host actions
   * still appear in the classifications but yield no handle.
   */
  continuationId: z.string().nullable(),
  /**
   * Staged-CODER summary. `null` when a CODER invocation changed nothing, and
   * absent for every other agent. The patch itself is NOT returned here --
   * Phase 5C adds explicit change-set review tools.
   */
  changeSet: z
    .object({
      id: z.string(),
      baseCommit: z.string(),
      patchHash: z.string(),
      patchBytes: z.number(),
      changedFiles: z.array(
        z.object({
          path: z.string(),
          change: z.string(),
          binary: z.boolean(),
        }),
      ),
    })
    .nullable()
    .optional(),
});

/**
 * Continuation input.
 *
 * Only an opaque handle and a bounded index. There is deliberately NO
 * targetAgent, purpose, reason, callerAgent, action, classification, lineage,
 * route, ExecutionPolicy, host or `approval: true` field -- the server holds
 * all of that from the previous trusted invocation result, so a client cannot
 * alter it.
 */
const continuationRefSchema = z.object({
  continuationId: z
    .string()
    .min(1)
    .max(200)
    .describe("Opaque continuation handle returned by a previous invocation."),
  requestIndex: z
    .number()
    .int()
    .min(0)
    .max(255)
    .describe("Index of the server-stored request to progress."),
});

const continuationIdOnlySchema = z.object({
  continuationId: z
    .string()
    .min(1)
    .max(200)
    .describe("Opaque continuation handle returned by a previous invocation."),
});

const continuationOutputSchema = z.object({
  invocation: z.record(z.string(), z.unknown()),
  callerResumeReady: z.boolean(),
  continuationId: z.string().nullable(),
  /**
   * Staged-CODER summary. `null` when a CODER invocation changed nothing, and
   * absent for every other agent. The patch itself is NOT returned here --
   * Phase 5C adds explicit change-set review tools.
   */
  changeSet: z
    .object({
      id: z.string(),
      baseCommit: z.string(),
      patchHash: z.string(),
      patchBytes: z.number(),
      changedFiles: z.array(
        z.object({
          path: z.string(),
          change: z.string(),
          binary: z.boolean(),
        }),
      ),
    })
    .nullable()
    .optional(),
});

const registerProjectInputSchema = z.object({
  name: z.string().min(1).max(200).describe("Human-readable project name."),
  sourcePath: z
    .string()
    .min(1)
    .max(4_096)
    .describe(
      "Path to an EXISTING source workspace directory. Synaphex registers it; it never creates, clones or git-initializes it.",
    ),
});

const createTaskInputSchema = z.object({
  projectId: projectIdSchema,
  description: z
    .string()
    .min(1)
    .max(4_000)
    .describe("What the task is about; Core derives the task slug from it."),
});

const openProjectSessionInputSchema = z.object({
  projectId: projectIdSchema,
});

const projectSessionOutputSchema = z.object({
  sessionId: z.string(),
  projectId: z.string(),
  /** Always null: a project-only session holds no task claim. */
  taskId: z.null(),
  bound: z.literal(true),
});

const planSessionSchema = z.object({
  sessionId: z
    .string()
    .describe("Task-bound Synaphex session id. Project-only sessions cannot review or decide task plans."),
});

const planDecisionInputSchema = z.object({
  sessionId: z
    .string()
    .describe("Task-bound Synaphex session id."),
  draftRevisionId: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "The exact draft revision returned by synaphex_get_plan_state. A decision applies only to that reviewed draft instance.",
    ),
});

const planStateOutputSchema = z.object({
  sessionId: z.string(),
  projectId: z.string(),
  taskId: z.string(),
  draft: z
    .object({ revisionId: z.string(), content: z.string() })
    .nullable(),
  current: z.object({ content: z.string() }).nullable(),
});

const planDecisionOutputSchema = z.object({
  sessionId: z.string(),
  projectId: z.string(),
  taskId: z.string(),
  draftRevisionId: z.string(),
  draft: z.null(),
  currentContent: z.string().nullable(),
});

const agentConfigOutputSchema = z.object({
  agent: z.enum(AGENT_NAMES),
  status: z.enum(["configured", "unconfigured", "removed"]),
  provider: z.string().optional(),
  surface: z.string().optional(),
  model: z.string().optional(),
  settingKeys: z.array(z.string()).optional(),
  previousProvider: z.string().optional(),
  reason: z.string().optional(),
});

const effectiveRulesOutputSchema = z.object({
  scopeContext: z.object({
    projectId: z.string().nullable(),
    taskId: z.string().nullable(),
  }),
  rules: z.array(
    z.object({
      key: z.string(),
      kind: z.enum(["agent_call", "action"]),
      decision: z.enum(RULE_DECISIONS),
      source: z.enum([...RULE_SCOPES, "default_deny"]),
    }),
  ),
});

export function createSynaphexMcpServer(
  options: CreateSynaphexMcpServerOptions,
): McpServer {
  const {
    projectReads,
    taskReads,
    sessionReads,
    agentConfigReads,
    effectiveRuleReads,
    sessionCommands,
    sessionRecovery,
    agentInvocation,
    agentContinuation,
    projectTaskCommands,
    planCommands,
    version,
    onDiagnostic = defaultDiagnostic,
  } = options;

  const server = new McpServer(
    { name: SYNAPHEX_MCP_SERVER_NAME, version },
    { capabilities: { tools: {} } },
  );

  const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } as const;

  server.registerTool(
    "synaphex_get_project",
    {
      title: "Get Synaphex project",
      description: "Look up a registered Synaphex project by id.",
      inputSchema: z.object({ projectId: projectIdSchema }),
      outputSchema: projectOutputSchema,
      annotations: readOnly,
    },
    async ({ projectId }) =>
      run(onDiagnostic, "synaphex_get_project", async () => {
        const project = await projectReads.get(parseProjectId(projectId));
        return {
          id: project.id,
          name: project.name,
          sourcePath: project.sourcePath,
          createdAt: project.createdAt,
        };
      }),
  );

  server.registerTool(
    "synaphex_get_task",
    {
      title: "Get Synaphex task",
      description: "Look up a Synaphex task and its lifecycle status.",
      inputSchema: z.object({
        projectId: projectIdSchema,
        taskId: taskIdSchema,
      }),
      outputSchema: taskOutputSchema,
      annotations: readOnly,
    },
    async ({ projectId, taskId }) =>
      run(onDiagnostic, "synaphex_get_task", async () => {
        const parsedProjectId = parseProjectId(projectId);
        const parsedTaskId = parseTaskId(taskId);
        const task = await taskReads.get(parsedProjectId, parsedTaskId);
        return {
          id: task.id,
          projectId: task.projectId,
          slug: task.slug,
          description: task.description,
          status: task.status,
          createdAt: task.createdAt,
          completedAt: task.completedAt,
          archivedAt: task.archivedAt,
        };
      }),
  );

  server.registerTool(
    "synaphex_get_session",
    {
      title: "Get Synaphex session binding",
      description:
        "Read the current project/task binding for a Synaphex session. An unknown or unbound session reports bound: false.",
      inputSchema: z.object({
        sessionId: z.string().describe("Synaphex session id."),
      }),
      outputSchema: sessionOutputSchema,
      annotations: readOnly,
    },
    async ({ sessionId }) =>
      run(onDiagnostic, "synaphex_get_session", async () => {
        const parsedSessionId = parseSessionId(sessionId);
        const binding = await sessionReads.find(parsedSessionId);
        return {
          sessionId: parsedSessionId,
          bound: binding !== null && binding.projectId !== null,
          projectId: binding?.projectId ?? null,
          taskId: binding?.taskId ?? null,
        };
      }),
  );

  server.registerTool(
    "synaphex_get_agent_config",
    {
      title: "Get Synaphex agent configuration",
      description:
        "Read the configuration status of one Synaphex logical agent. Credentials are never exposed; only setting keys are reported.",
      inputSchema: z.object({
        agent: z
          .enum(AGENT_NAMES)
          .describe("One of the six Synaphex logical agents."),
      }),
      outputSchema: agentConfigOutputSchema,
      annotations: readOnly,
    },
    async ({ agent }) =>
      run(onDiagnostic, "synaphex_get_agent_config", async () => {
        const parsedAgent = parseAgentName(agent);
        const config = await agentConfigReads.getConfig(parsedAgent);
        if (config.status === "configured") {
          return {
            agent: parsedAgent,
            status: config.status,
            provider: config.provider,
            surface: config.surface,
            model: config.model,
            // Values may carry provider-specific data; only keys are exposed.
            settingKeys: Object.keys(config.settings ?? {}).sort(),
          };
        }
        if (config.status === "removed") {
          return {
            agent: parsedAgent,
            status: config.status,
            reason: config.reason,
            previousProvider: config.previousProvider,
          };
        }
        return { agent: parsedAgent, status: config.status };
      }),
  );

  server.registerTool(
    "synaphex_get_effective_rules",
    {
      title: "Get Synaphex effective rules",
      description:
        "List effective Synaphex rules. Precedence (task > project > global, then default deny) is resolved by Synaphex Core, not by MCP.",
      inputSchema: z.object({
        projectId: projectIdSchema.optional(),
        taskId: taskIdSchema.optional(),
      }),
      outputSchema: effectiveRulesOutputSchema,
      annotations: readOnly,
    },
    async ({ projectId, taskId }) =>
      run(onDiagnostic, "synaphex_get_effective_rules", async () => {
        const parsedProjectId =
          projectId === undefined ? undefined : parseProjectId(projectId);
        const parsedTaskId =
          taskId === undefined ? undefined : parseTaskId(taskId);
        const rules = await effectiveRuleReads.listEffectiveRulesReadOnly({
          ...(parsedProjectId === undefined ? {} : { projectId: parsedProjectId }),
          ...(parsedTaskId === undefined ? {} : { taskId: parsedTaskId }),
        });
        return {
          scopeContext: {
            projectId: parsedProjectId ?? null,
            taskId: parsedTaskId ?? null,
          },
          rules: rules.map((rule) => ({
            key: formatRuleKey(rule.key),
            kind: rule.key.kind,
            decision: rule.decision,
            source: rule.source,
          })),
        };
      }),
  );

  // --- Phase 4B: plan review and deterministic decisions -------------------
  //
  // Deterministic local state operations: no model, network, shell or provider
  // execution, so openWorldHint is false. None of these is a continuation
  // handle -- revision identity is persisted with the plan, so a user may read
  // a draft, restart the MCP process, and still decide about it.
  server.registerTool(
    "synaphex_get_plan_state",
    {
      title: "Get Synaphex plan state",
      description:
        "Read the reviewable plan state for a task-bound session: the current draft (with the revision id required to decide about it) and the accepted current plan. This is the authoritative way to obtain a draftRevisionId before accepting or rejecting.",
      inputSchema: planSessionSchema,
      outputSchema: planStateOutputSchema,
      // readOnlyHint stays true: no plan CONTENT and no plan authority ever
      // change here. A legacy or crash-mismatched draft does get revision
      // metadata written, but that is an internal consistency migration --
      // it assigns identity to a draft that already exists, and the plan the
      // user reviews is byte-identical before and after.
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ sessionId }) =>
      run(onDiagnostic, "synaphex_get_plan_state", async () => {
        const state = await planCommands.getPlanReviewState(
          parseSessionId(sessionId),
        );
        return {
          sessionId: state.sessionId,
          projectId: state.projectId,
          taskId: state.taskId,
          draft: state.draft,
          current: state.current,
        };
      }),
  );

  // Both decisions change authoritative plan state, so destructiveHint is
  // true: acceptance archives and replaces the current plan, and rejection
  // deletes the proposed draft.
  const planDecisionAnnotations = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  } as const;

  server.registerTool(
    "synaphex_accept_plan_draft",
    {
      title: "Accept Synaphex plan draft",
      description:
        "Deterministically accept exactly the reviewed draft: any existing current plan is archived and the draft becomes current. Requires the draft revision from synaphex_get_plan_state; a stale revision changes nothing. Natural-language approval has no authority.",
      inputSchema: planDecisionInputSchema,
      outputSchema: planDecisionOutputSchema,
      annotations: planDecisionAnnotations,
    },
    async ({ sessionId, draftRevisionId }) =>
      run(onDiagnostic, "synaphex_accept_plan_draft", async () => {
        const result = await planCommands.acceptPlanDraft(
          parseSessionId(sessionId),
          draftRevisionId as PlanDraftRevisionId,
        );
        return {
          sessionId: result.sessionId,
          projectId: result.projectId,
          taskId: result.taskId,
          draftRevisionId: result.draftRevisionId,
          draft: null,
          currentContent: result.currentContent ?? null,
        };
      }),
  );

  server.registerTool(
    "synaphex_reject_plan_draft",
    {
      title: "Reject Synaphex plan draft",
      description:
        "Deterministically reject exactly the reviewed draft, deleting it. The accepted current plan and the task lifecycle are unchanged. Requires the draft revision from synaphex_get_plan_state.",
      inputSchema: planDecisionInputSchema,
      outputSchema: planDecisionOutputSchema,
      annotations: planDecisionAnnotations,
    },
    async ({ sessionId, draftRevisionId }) =>
      run(onDiagnostic, "synaphex_reject_plan_draft", async () => {
        const result = await planCommands.rejectPlanDraft(
          parseSessionId(sessionId),
          draftRevisionId as PlanDraftRevisionId,
        );
        return {
          sessionId: result.sessionId,
          projectId: result.projectId,
          taskId: result.taskId,
          draftRevisionId: result.draftRevisionId,
          draft: null,
          currentContent: null,
        };
      }),
  );

  // --- Phase 4A: project / task bootstrap ---------------------------------
  //
  // Local-state mutation only: no provider, model, shell or network is
  // involved, so openWorldHint is false. None of these invokes an agent.
  server.registerTool(
    "synaphex_register_project",
    {
      title: "Register Synaphex project",
      description:
        "Register an EXISTING local source workspace as a Synaphex project. Synaphex stores only its own state; the source tree is never created, cloned or modified. Registering an already-registered path fails rather than returning the existing project.",
      inputSchema: registerProjectInputSchema,
      outputSchema: projectOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        // NOT idempotent: Core refuses a duplicate canonical source path
        // rather than returning the existing project, so a repeat call errors.
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ name, sourcePath }) =>
      run(onDiagnostic, "synaphex_register_project", async () => {
        const project = await projectTaskCommands.registerProject(
          name,
          sourcePath,
        );
        return {
          id: project.id,
          name: project.name,
          sourcePath: project.sourcePath,
          createdAt: project.createdAt,
        };
      }),
  );

  server.registerTool(
    "synaphex_create_task",
    {
      title: "Create Synaphex task",
      description:
        "Create a new active task in a registered project. The task is created unbound: no session is opened and no task ownership claim is acquired. No plan is created or accepted.",
      inputSchema: createTaskInputSchema,
      outputSchema: taskOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ projectId, description }) =>
      run(onDiagnostic, "synaphex_create_task", async () => {
        const task = await projectTaskCommands.createTask(
          parseProjectId(projectId),
          description,
        );
        return {
          id: task.id,
          projectId: task.projectId,
          slug: task.slug,
          description: task.description,
          status: task.status,
          createdAt: task.createdAt,
          completedAt: task.completedAt,
          archivedAt: task.archivedAt,
        };
      }),
  );

  server.registerTool(
    "synaphex_open_project_session",
    {
      title: "Open Synaphex project session",
      description:
        "Open a logical Synaphex session bound only to a project, with no task. Use its sessionId for project-scoped invocation (researcher, examiner). It acquires no task ownership claim and selects no task.",
      inputSchema: openProjectSessionInputSchema,
      outputSchema: projectSessionOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ projectId }) =>
      run(onDiagnostic, "synaphex_open_project_session", async () => {
        const binding = await projectTaskCommands.openProjectSession(
          parseProjectId(projectId),
        );
        if (binding.projectId === null || binding.taskId !== null) {
          // Core guarantees a project-only binding; refuse to misreport one.
          throw new Error("openProjectSession returned an unexpected binding");
        }
        return {
          sessionId: binding.sessionId,
          projectId: binding.projectId,
          taskId: null,
          bound: true as const,
        };
      }),
  );

  // --- Session-lifecycle mutation -----------------------------------------
  //
  // All mutating tools set `readOnlyHint: false` and `openWorldHint: false`.
  //
  // `openTaskSession` is NOT idempotent: each successful call mints a new
  // SessionId, so repeating it is not equivalent to calling it once. It is not
  // destructive -- it creates state rather than removing any.
  const openingAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  } as const;

  // `closeSession` IS idempotent: repeating it on an already-closed
  // session is a deterministic no-op reporting `released: false`. It removes
  // only the caller's own session state, so it is not destructive.
  const closingAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } as const;

  // `forceReleaseTaskSession` is idempotent (a repeated call is a no-op) but
  // IS marked destructive: it terminates ANOTHER logical session's ownership
  // and deletes that session's binding record. Marking it destructive is the
  // conservative choice so hosts can gate it behind confirmation.
  const recoveryAnnotations = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  } as const;

  server.registerTool(
    "synaphex_open_task_session",
    {
      title: "Open Synaphex task session",
      description:
        "Open a new logical Synaphex session bound to an existing active task, returning its explicit sessionId. Enforces one writable session per task; an already-claimed task is refused rather than stolen.",
      inputSchema: z.object({
        projectId: projectIdSchema,
        taskId: taskIdSchema,
      }),
      outputSchema: openTaskSessionOutputSchema,
      annotations: openingAnnotations,
    },
    async ({ projectId, taskId }) =>
      run(onDiagnostic, "synaphex_open_task_session", async () => {
        const parsedProjectId = parseProjectId(projectId);
        const parsedTaskId = parseTaskId(taskId);
        const binding = await sessionCommands.openTaskSession(
          parsedProjectId,
          parsedTaskId,
        );
        if (binding.projectId === null || binding.taskId === null) {
          // Core guarantees a bound result on success; refuse to report
          // a half-open session rather than inventing one.
          throw new Error("openTaskSession returned an unbound binding");
        }
        return {
          sessionId: binding.sessionId,
          projectId: binding.projectId,
          taskId: binding.taskId,
          bound: true as const,
        };
      }),
  );

  server.registerTool(
    "synaphex_close_session",
    {
      title: "Close Synaphex task session",
      description:
        "Fully close a Synaphex session: release its task claim (if any) and delete its binding record. Reports released: false when nothing was claimed, so a repeat call is a deterministic no-op. This is not task completion -- task status, plans, memory and artifacts are unchanged.",
      inputSchema: z.object({
        sessionId: z.string().describe("Synaphex session id."),
      }),
      outputSchema: closeSessionOutputSchema,
      annotations: closingAnnotations,
    },
    async ({ sessionId }) =>
      run(onDiagnostic, "synaphex_close_session", async () => {
        const parsedSessionId = parseSessionId(sessionId);
        const result = await sessionCommands.closeSession(parsedSessionId);
        return {
          sessionId: result.sessionId,
          // Never claims success where nothing changed.
          released: result.released,
          releasedTaskId: result.releasedTaskId,
          bound: false as const,
        };
      }),
  );

  // --- Phase 2B: explicit user-driven recovery -----------------------------

  server.registerTool(
    "synaphex_get_task_session_owner",
    {
      title: "Get Synaphex task session owner",
      description:
        "Read which Synaphex session, if any, currently holds the writable claim on a task. Use this to discover a lost session before recovering it.",
      inputSchema: z.object({
        projectId: projectIdSchema,
        taskId: taskIdSchema,
      }),
      outputSchema: taskSessionOwnerOutputSchema,
      annotations: readOnly,
    },
    async ({ projectId, taskId }) =>
      run(onDiagnostic, "synaphex_get_task_session_owner", async () => {
        const parsedProjectId = parseProjectId(projectId);
        const parsedTaskId = parseTaskId(taskId);
        const owner = await sessionRecovery.getTaskSessionOwner(
          parsedProjectId,
          parsedTaskId,
        );
        return {
          projectId: owner.projectId,
          taskId: owner.taskId,
          claimed: owner.claimed,
          // Disclosed deliberately: recovery needs a discoverable owner on a
          // local, user-orchestrated stdio system.
          sessionId: owner.claimed ? owner.sessionId : null,
        };
      }),
  );

  server.registerTool(
    "synaphex_force_release_task_session",
    {
      title: "Force release Synaphex task session",
      description:
        "User recovery: release the writable claim on a task without knowing the owning sessionId, and delete that session's binding record. Calling this tool is itself the explicit recovery action. Never happens automatically -- a normal open against a claimed task still fails with TASK_ALREADY_BOUND. Task status, plans, memory and artifacts are unchanged.",
      inputSchema: z.object({
        projectId: projectIdSchema,
        taskId: taskIdSchema,
      }),
      outputSchema: forceReleaseOutputSchema,
      annotations: recoveryAnnotations,
    },
    async ({ projectId, taskId }) =>
      run(onDiagnostic, "synaphex_force_release_task_session", async () => {
        const parsedProjectId = parseProjectId(projectId);
        const parsedTaskId = parseTaskId(taskId);
        const result = await sessionRecovery.forceReleaseTaskSession(
          parsedProjectId,
          parsedTaskId,
        );
        return {
          projectId: parsedProjectId,
          taskId: result.taskId,
          // An unclaimed task is a successful no-op, not a failure.
          released: result.released,
          previousSessionId: result.previousSessionId,
        };
      }),
  );

  // --- Phase 3A: direct-user agent invocation ------------------------------
  //
  // Mutating (role-dependent), so readOnlyHint is false. It spawns an external
  // provider/model, so openWorldHint is true. Non-idempotent: a repeat consumes
  // provider quota and can create new artifacts, memory, drafts or complete a
  // task.
  //
  // destructiveHint is TRUE, chosen conservatively: a REVIEWER PASS can
  // complete task lifecycle state, and an EXAMINER result can replace canonical
  // memory. Those are not simple additive writes, so hosts should be able to
  // gate this behind confirmation. (MCP treats annotations as untrusted hints.)
  server.registerTool(
    "synaphex_invoke_agent",
    {
      title: "Invoke Synaphex agent",
      description:
        "Invoke one Synaphex logical agent as a direct user invocation. Available agents: questioner, researcher, examiner, planner, reviewer. CODER is not invocable through MCP. Requested helper calls and actions are returned classified but never executed.",
      inputSchema: invokeAgentInputSchema,
      outputSchema: invokeAgentOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ agent, scope, instruction }) =>
      run(onDiagnostic, "synaphex_invoke_agent", async () => {
        // Wire validation only; every domain rule stays in the application.
        const sessionId = parseSessionId(scope.sessionId);
        const result = await agentInvocation.invoke({
          agent,
          scope: { kind: scope.kind, sessionId },
          instruction,
        });
        const continuationId = agentContinuation.issueFor(sessionId, result);
        return {
          ...presentInvocationResult(result),
          continuationId,
        };
      }),
  );

  // --- Phase 3C: explicit continuations ------------------------------------
  //
  // All four mutate Synaphex state and spawn an external provider, so
  // readOnlyHint is false, openWorldHint is true, and idempotentHint is false
  // (each consumes quota and a one-time continuation step).
  //
  // destructiveHint is true for the two APPROVAL tools only: they grant a
  // previously-unapproved execution, which is the conservative reading of the
  // MCP annotation semantics. Plain helper execution and caller resume progress
  // an already-permitted step, so they are not marked destructive.
  const continuationAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  } as const;
  const approvalAnnotations = {
    ...continuationAnnotations,
    destructiveHint: true,
  } as const;

  server.registerTool(
    "synaphex_execute_helper",
    {
      title: "Execute Synaphex helper agent",
      description:
        "Explicitly execute a helper request whose server-side classification is 'allowed'. This is orchestration, not approval: an approval_required edge is refused. The caller is NOT auto-resumed.",
      inputSchema: continuationRefSchema,
      outputSchema: continuationOutputSchema,
      annotations: continuationAnnotations,
    },
    async ({ continuationId, requestIndex }) =>
      run(onDiagnostic, "synaphex_execute_helper", async () =>
        presentContinuation(
          await agentContinuation.executeAllowedHelper(
            continuationId,
            requestIndex,
          ),
        ),
      ),
  );

  server.registerTool(
    "synaphex_approve_and_execute_helper",
    {
      title: "Approve and execute Synaphex helper agent",
      description:
        "Explicitly approve ONE helper request classified 'approval_required' and execute it. The approval is one-time and invocation-scoped; no rule is changed from ask to allow.",
      inputSchema: continuationRefSchema,
      outputSchema: continuationOutputSchema,
      annotations: approvalAnnotations,
    },
    async ({ continuationId, requestIndex }) =>
      run(onDiagnostic, "synaphex_approve_and_execute_helper", async () =>
        presentContinuation(
          await agentContinuation.approveAndExecuteHelper(
            continuationId,
            requestIndex,
          ),
        ),
      ),
  );

  server.registerTool(
    "synaphex_resume_caller",
    {
      title: "Resume Synaphex caller agent",
      description:
        "Explicitly resume the original caller after a helper execution completed. This is a fresh provider execution with a continuation handoff; task-bound resumes revalidate task ownership.",
      inputSchema: continuationIdOnlySchema,
      outputSchema: continuationOutputSchema,
      annotations: continuationAnnotations,
    },
    async ({ continuationId }) =>
      run(onDiagnostic, "synaphex_resume_caller", async () =>
        presentContinuation(
          await agentContinuation.resumeCaller(continuationId),
        ),
      ),
  );

  server.registerTool(
    "synaphex_approve_network_action",
    {
      title: "Approve Synaphex network capability",
      description:
        "Explicitly approve ONE requested 'network' provider capability classified 'approval_required', then resume the caller with a one-time grant. No rule or provider setting is changed. Host actions (git_push, ci) cannot be approved here.",
      inputSchema: continuationRefSchema,
      outputSchema: continuationOutputSchema,
      annotations: approvalAnnotations,
    },
    async ({ continuationId, requestIndex }) =>
      run(onDiagnostic, "synaphex_approve_network_action", async () =>
        presentContinuation(
          await agentContinuation.approveNetworkAction(
            continuationId,
            requestIndex,
          ),
        ),
      ),
  );

  server.registerTool(
    "synaphex_continue_allowed_network",
    {
      title: "Continue with allowed network capability",
      description:
        "Explicitly continue a caller whose requested 'network' provider capability was ALREADY classified 'allowed' by rule. No approval is granted or needed; an approval_required action must use synaphex_approve_network_action instead. Host actions (git_push, ci) cannot be continued here.",
      inputSchema: continuationRefSchema,
      outputSchema: continuationOutputSchema,
      // Not destructive: unlike the approval tools this grants nothing that was
      // previously denied or asked -- the capability was already permitted by
      // rule. Per the MCP definition, destructiveHint means destructive/
      // irreversible updates, not merely "calls an external provider", so
      // calling a provider alone does not warrant it.
      annotations: continuationAnnotations,
    },
    async ({ continuationId, requestIndex }) =>
      run(onDiagnostic, "synaphex_continue_allowed_network", async () =>
        presentContinuation(
          await agentContinuation.continueAllowedNetwork(
            continuationId,
            requestIndex,
          ),
        ),
      ),
  );

  return server;
}

/** Maps a continuation outcome, never exposing trusted record internals. */
function presentContinuation(
  outcome: ContinuationOutcome,
): Record<string, unknown> {
  return {
    invocation: presentInvocationResult(outcome.invocation),
    callerResumeReady: outcome.callerResumeReady,
    continuationId: outcome.continuationId,
  };
}

/**
 * Maps the internal invocation result to a safe MCP shape.
 *
 * Deliberately omitted: the ownership fencing token, provider credentials, raw
 * provider stderr, auth metadata, stack traces, process diagnostics and temp
 * paths. `executionPolicy` is reduced to its source-modification decision
 * rather than forwarding provider-capability internals.
 */
function presentInvocationResult(
  result: AnyAgentInvocationResult,
): Record<string, unknown> {
  const { processedResult } = result;
  return {
    agent: result.agent,
    // Preserves the agent's own outcome (success / needs_user / blocked /
    // error). A needs_user result is a SUCCESSFUL tool call carrying that
    // outcome -- it is not an MCP error.
    outcome: processedResult.outcome,
    summary: processedResult.summary,
    scope: {
      sessionId: result.scope.sessionId,
      projectId: result.scope.projectId,
      taskId: result.scope.taskId,
    },
    route: {
      provider: result.route.provider,
      configuredSurface: result.route.configuredSurface,
      effectiveSurface: result.route.effectiveSurface,
      routingReason: result.route.routingReason,
      model: result.route.model,
      host: {
        provider: result.route.host.provider,
        surface: result.route.host.surface,
      },
    },
    executionPolicy: {
      sourceModification: result.executionPolicy.sourceModification,
    },
    lineage: {
      rootInvocationId: result.lineage.rootInvocationId,
      currentInvocationId: result.lineage.currentInvocationId,
      parentInvocationId: result.lineage.parentInvocationId,
    },
    // Authoritative staged-CODER change-set summary, system-derived. Never
    // the staging path, ownership token or Git temp HOME.
    ...(coderChangeSetSummary(result) === undefined
      ? {}
      : { changeSet: coderChangeSetSummary(result) }),
    result: {
      warnings: [...processedResult.warnings],
      persistedArtifacts: processedResult.persistedArtifacts.map(
        (artifact) => ({ ...artifact }),
      ),
      stateEffects: processedResult.stateEffects.map((effect) => ({
        ...effect,
      })),
    },
    requestedCalls: result.helperCalls.map((call) => ({
      target: call.request.target,
      purpose: call.request.purpose,
      status: call.status,
      immutableReason: call.immutableReason ?? null,
      ruleDecision: call.effectiveRule?.decision ?? null,
      ruleSource: call.effectiveRule?.source ?? null,
      errorCode: "errorCode" in call ? call.errorCode : null,
    })),
    requestedActions: result.actionClassifications.map((action) => ({
      action: action.request.action,
      status: action.status,
      executionKind: action.executionKind,
      ruleDecision: action.effectiveRule?.decision ?? null,
      ruleSource: action.effectiveRule?.source ?? null,
      errorCode: "errorCode" in action ? action.errorCode : null,
    })),
  };
}

/**
 * Runs a read handler, returning structured content on success and a stable
 * `{ code, message }` payload with `isError` on failure. Raw errors, stack
 * traces and `cause` chains never reach the client; the full diagnostic goes
 * to the diagnostics sink (stderr) instead.
 */
async function run<T>(
  onDiagnostic: (message: string) => void,
  tool: string,
  handler: () => Promise<T>,
): Promise<{
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: true;
}> {
  try {
    const output = await handler();
    return {
      content: [{ type: "text", text: JSON.stringify(output) }],
      structuredContent: output as Record<string, unknown>,
    };
  } catch (error) {
    const failure = toMcpToolFailure(error);
    onDiagnostic(
      `[synaphex-mcp] ${tool} failed: ${failure.code}: ${
        error instanceof Error ? error.message : "non-error thrown"
      }`,
    );
    return {
      content: [{ type: "text", text: `${failure.code}: ${failure.message}` }],
      structuredContent: { ...failure },
      isError: true,
    };
  }
}

/**
 * Extracts the change-set summary from a staged CODER result's persisted work
 * record reference. Returns `undefined` for non-CODER agents.
 */
function coderChangeSetSummary(
  result: AnyAgentInvocationResult,
): Record<string, unknown> | null | undefined {
  if (result.agent !== "coder") {
    return undefined;
  }
  const reference = (
    result.processedResult as { coderChangeSet?: unknown }
  ).coderChangeSet;
  if (reference === undefined) {
    return undefined;
  }
  return reference as Record<string, unknown> | null;
}

function defaultDiagnostic(message: string): void {
  process.stderr.write(`${message}\n`);
}
