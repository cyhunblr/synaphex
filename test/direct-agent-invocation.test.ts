import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { AgentConfigManager } from "../src/core/agent-config-manager.js";
import { AgentInvocationService } from "../src/core/agent-invocation-service.js";
import { ArtifactManager } from "../src/core/artifact-manager.js";
import { ProjectManager } from "../src/core/project-manager.js";
import { RoleContractRegistry } from "../src/core/role-contract-registry.js";
import { RuleResolver } from "../src/core/rule-resolver.js";
import { SessionManager } from "../src/core/session-manager.js";
import { TaskManager } from "../src/core/task-manager.js";
import type { AgentName } from "../src/domain/agent.js";
import type {
  AgentProvider,
  AgentSurface,
} from "../src/domain/agent-config.js";
import type {
  AgentExecutionInput,
  AgentExecutor,
} from "../src/domain/agent-invocation.js";
import {
  AgentExecutionFailedError,
  AntigravityCliExecutionError,
  AgentTargetSurfaceUnsupportedError,
  NativeHostExecutionUnavailableError,
  NoTaskBoundError,
  TaskSessionOwnershipLostError,
  UnsupportedAgentInvocationError,
} from "../src/domain/errors.js";
import { isProviderCapabilityUsable } from "../src/domain/execution-policy.js";
import type { Project } from "../src/domain/project.js";
import type {
  McpHostContext,
  RuntimeAvailability,
} from "../src/domain/provider-routing.js";
import type { Task } from "../src/domain/task.js";
import type { ProcessRunner } from "../src/infrastructure/process-runner.js";
import { StateStore } from "../src/infrastructure/state-store.js";
import { AntigravityCliAgentExecutor } from "../src/providers/antigravity-cli-agent-executor.js";
import { ProviderDispatchingAgentExecutor } from "../src/providers/provider-dispatching-agent-executor.js";
import {
  DirectAgentInvocation,
  MCP_CONTINUATION_HELPER_AGENTS,
  MCP_DIRECT_INVOCABLE_AGENTS,
  isMcpContinuationHelperAgent,
  isMcpDirectInvocableAgent,
  type McpInvocableAgent,
} from "../src/operations/direct-agent-invocation.js";
import { SessionCommands } from "../src/operations/session-commands.js";

interface Fixture {
  readonly stateRoot: string;
  readonly homeDirectory: string;
  readonly store: StateStore;
  readonly projects: ProjectManager;
  readonly sessions: SessionManager;
  readonly tasks: TaskManager;
  readonly artifacts: ArtifactManager;
  readonly configs: AgentConfigManager;
  readonly rules: RuleResolver;
  readonly commands: SessionCommands;
  readonly project: Project;
  readonly task: Task;
}

async function createFixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "synaphex-direct-invoke-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateRoot = join(root, "state-root");
  const homeDirectory = join(root, "home");
  const sourcePath = join(root, "source");
  await Promise.all([
    mkdir(homeDirectory, { recursive: true }),
    mkdir(sourcePath, { recursive: true }),
  ]);
  const store = new StateStore(stateRoot);
  const projects = new ProjectManager(store, { homeDirectory });
  const sessions = new SessionManager(store);
  const tasks = new TaskManager(store, projects);
  const project = await projects.create("Invoke Project", sourcePath);
  const task = await tasks.create(project.id, "Invoke through MCP");
  return {
    stateRoot,
    homeDirectory,
    store,
    projects,
    sessions,
    tasks,
    artifacts: new ArtifactManager(store, projects, tasks),
    configs: new AgentConfigManager(store),
    rules: new RuleResolver(store, projects, tasks),
    commands: new SessionCommands({ projects, tasks, sessions }),
    project,
    task,
  };
}

class RecordingExecutor implements AgentExecutor {
  readonly calls: AgentExecutionInput[] = [];
  constructor(
    private readonly handler: (input: AgentExecutionInput) => unknown,
  ) {}
  async execute(input: AgentExecutionInput): Promise<unknown> {
    this.calls.push(input);
    return this.handler(input);
  }
}

const availableEverywhere: RuntimeAvailability = {
  async isAvailable() {
    return true;
  },
};

function invocationPort(
  fixture: Fixture,
  host: McpHostContext,
  executor: AgentExecutor,
  runtimeAvailability: RuntimeAvailability = availableEverywhere,
): DirectAgentInvocation {
  return new DirectAgentInvocation({
    host,
    invocations: new AgentInvocationService({
      executor,
      runtimeAvailability,
      synaphexRoot: fixture.stateRoot,
      homeDirectory: fixture.homeDirectory,
    }),
    sessions: fixture.sessions,
    roleContracts: new RoleContractRegistry(),
  });
}

async function configure(
  fixture: Fixture,
  agent: AgentName,
  provider: AgentProvider,
  surface: AgentSurface,
): Promise<void> {
  await fixture.configs.setConfigured(agent, {
    provider,
    surface,
    model: `${agent}-model`,
  });
}

function researcherResult() {
  return {
    agent: "researcher",
    outcome: "success",
    summary: "Research complete.",
    researchArtifact: { findings: ["ok"] },
  };
}

// ---------------------------------------------------------------------------
// Allowed agents / CODER exclusion
// ---------------------------------------------------------------------------

test("all six agents are directly invocable, but CODER is not helper-invocable", () => {
  // Phase 5B: a USER may invoke staged CODER directly.
  assert.deepEqual([...MCP_DIRECT_INVOCABLE_AGENTS].sort(), [
    "coder",
    "examiner",
    "planner",
    "questioner",
    "researcher",
    "reviewer",
  ]);
  assert.equal(isMcpDirectInvocableAgent("coder"), true);
  // But an AGENT may not smuggle CODER through a helper continuation.
  assert.deepEqual([...MCP_CONTINUATION_HELPER_AGENTS].sort(), [
    "examiner",
    "planner",
    "questioner",
    "researcher",
    "reviewer",
  ]);
  assert.equal(isMcpContinuationHelperAgent("coder"), false);
  // The two surfaces are deliberately different sets.
  assert.notEqual(
    MCP_DIRECT_INVOCABLE_AGENTS.length,
    MCP_CONTINUATION_HELPER_AGENTS.length,
  );
});

test("source policy is role-specific: only CODER is workspace_write", () => {
  const contracts = new RoleContractRegistry();
  for (const agent of MCP_CONTINUATION_HELPER_AGENTS) {
    assert.equal(
      contracts.canModifySourceCode(agent),
      false,
      `${agent} must not modify source`,
    );
  }
  // CODER retains workspace_write; the security change is that it applies to
  // the staging clone, not the registered source workspace.
  assert.equal(contracts.canModifySourceCode("coder"), true);
});

test("an agent outside the direct set is still rejected before any provider", async (t) => {
  const fixture = await createFixture(t);
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const executor = new RecordingExecutor(() => {
    throw new Error("provider must never be reached");
  });
  await assert.rejects(
    invocationPort(fixture, { provider: "openai" }, executor).invoke({
      agent: "orchestrator" as unknown as McpInvocableAgent,
      scope: { kind: "task_session", sessionId: opened.sessionId },
      instruction: "Not a real agent.",
    }),
    (error: unknown) =>
      error instanceof UnsupportedAgentInvocationError &&
      error.details?.reason === "agent_not_invocable",
  );
  assert.equal(executor.calls.length, 0, "provider must not be invoked");
});

// ---------------------------------------------------------------------------
// Host routing (Phase 32 cases A-E)
// ---------------------------------------------------------------------------

test("case A: an anthropic host with an openai/cli target routes cross-provider CLI", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher", "openai", "cli");
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const executor = new RecordingExecutor(() => researcherResult());
  const result = await invocationPort(
    fixture,
    { provider: "anthropic" },
    executor,
  ).invoke({
    agent: "researcher",
    scope: { kind: "task_session", sessionId: opened.sessionId },
    instruction: "Research it.",
  });
  assert.equal(result.route.provider, "openai");
  assert.equal(result.route.effectiveSurface, "cli");
  assert.equal(result.route.routingReason, "cross_provider_cli");
  // The immutable process host reached ProviderRouter.
  assert.deepEqual(result.route.host, { provider: "anthropic" });
});

test("case B: openai/cli host with an anthropic/cli target routes cross-provider CLI", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher", "anthropic", "cli");
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const executor = new RecordingExecutor(() => researcherResult());
  const result = await invocationPort(
    fixture,
    { provider: "openai" },
    executor,
  ).invoke({
    agent: "researcher",
    scope: { kind: "task_session", sessionId: opened.sessionId },
    instruction: "Research it.",
  });
  assert.equal(result.route.provider, "anthropic");
  assert.equal(result.route.effectiveSurface, "cli");
  assert.deepEqual(result.route.host, { provider: "openai" });
});

test("a VS Code target is refused before execution, for every host", async (t) => {
  // VS Code extensions are interactive host surfaces, not callable targets,
  // and no host can reach one. The refusal happens before any executor runs,
  // and the user's configuration is never rewritten to `cli` on their behalf.
  for (const hostProvider of ["openai", "anthropic", "google"] as const) {
    const fixture = await createFixture(t);
    await configure(fixture, "researcher", "anthropic", "vscode");
    const opened = await fixture.commands.openTaskSession(
      fixture.project.id,
      fixture.task.id,
    );
    const executor = new RecordingExecutor(() => researcherResult());
    await assert.rejects(
      invocationPort(fixture, { provider: hostProvider }, executor).invoke({
        agent: "researcher",
        scope: { kind: "task_session", sessionId: opened.sessionId },
        instruction: "Research it.",
      }),
      (error: unknown) =>
        error instanceof AgentTargetSurfaceUnsupportedError &&
        error.code === "AGENT_TARGET_SURFACE_UNSUPPORTED",
      `${hostProvider} host must refuse a vscode target`,
    );
    assert.equal(executor.calls.length, 0, "nothing may execute");
    // The stored configuration is untouched: changing it would change intent.
    const stored = await fixture.configs.getConfig("researcher");
    assert.equal(
      (stored as { surface?: string }).surface,
      "vscode",
      "Synaphex must not rewrite the user's configured surface",
    );
  }
});

test("case D/E: request input and client identity cannot override host context", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher", "openai", "cli");
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const executor = new RecordingExecutor(() => researcherResult());
  const port = invocationPort(
    fixture,
    { provider: "anthropic" },
    executor,
  );
  // A caller attempting to smuggle host identity through the request.
  const spoofed = {
    agent: "researcher" as const,
    scope: { kind: "task_session" as const, sessionId: opened.sessionId },
    instruction: "Research it.",
    hostProvider: "google",
    hostSurface: "cli",
    host: { provider: "google" },
    caller: "coder",
    directUser: false,
    clientInfo: { name: "claude-code" },
  };
  const result = await port.invoke(spoofed);
  // The process-bound host wins; nothing from the request reached the router.
  assert.deepEqual(result.route.host, { provider: "anthropic" });
  assert.deepEqual(executor.calls[0]?.route.host, { provider: "anthropic" });
});

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

test("task-session scope resolves project and task from the authoritative binding", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher", "openai", "cli");
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const executor = new RecordingExecutor(() => researcherResult());
  const result = await invocationPort(
    fixture,
    { provider: "openai" },
    executor,
  ).invoke({
    agent: "researcher",
    // Only a sessionId is supplied; project/task are never client-stated.
    scope: { kind: "task_session", sessionId: opened.sessionId },
    instruction: "Research it.",
  });
  assert.equal(result.scope.projectId, fixture.project.id);
  assert.equal(result.scope.taskId, fixture.task.id);
  assert.equal(result.scope.sessionId, opened.sessionId);
});

test("a closed session cannot be invoked", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher", "openai", "cli");
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  await fixture.commands.closeSession(opened.sessionId);
  const executor = new RecordingExecutor(() => researcherResult());
  await assert.rejects(
    invocationPort(
      fixture,
      { provider: "openai" },
      executor,
    ).invoke({
      agent: "researcher",
      scope: { kind: "task_session", sessionId: opened.sessionId },
      instruction: "Research it.",
    }),
  );
  assert.equal(executor.calls.length, 0);
});

test("a force-released session cannot commit an invocation", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher", "openai", "cli");
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  // Release the claim while the binding still names the task, so the
  // invocation resolves a task scope while holding no authority.
  await fixture.store.removeFile(
    `state/task-bindings/${fixture.task.id}.json`,
  );
  const executor = new RecordingExecutor(() => researcherResult());
  await assert.rejects(
    invocationPort(
      fixture,
      { provider: "openai" },
      executor,
    ).invoke({
      agent: "researcher",
      scope: { kind: "task_session", sessionId: opened.sessionId },
      instruction: "Research it.",
    }),
    (error: unknown) => error instanceof TaskSessionOwnershipLostError,
  );
  assert.equal(executor.calls.length, 0, "fencing blocks before the provider");
});

test("project scope works for a project-capable role and has no task fence", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher", "openai", "cli");
  // Project-bound only; Core's role contract marks researcher taskBinding optional.
  const sessionId = "ses_projectonly00000000000000001";
  await fixture.sessions.bindProject(sessionId, fixture.project.id);
  const executor = new RecordingExecutor(() => researcherResult());
  const result = await invocationPort(
    fixture,
    { provider: "openai" },
    executor,
  ).invoke({
    agent: "researcher",
    scope: { kind: "project", sessionId },
    instruction: "Research the project.",
  });
  assert.equal(result.scope.taskId, null);
  assert.equal(result.scope.projectId, fixture.project.id);
});

test("project scope is refused for a role Core requires to be task-bound", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "planner", "openai", "cli");
  const sessionId = "ses_projectonly00000000000000002";
  await fixture.sessions.bindProject(sessionId, fixture.project.id);
  const executor = new RecordingExecutor(() => researcherResult());
  await assert.rejects(
    invocationPort(
      fixture,
      { provider: "openai" },
      executor,
    ).invoke({
      agent: "planner",
      scope: { kind: "project", sessionId },
      instruction: "Plan it.",
    }),
    // Eligibility is Core's decision, not MCP's.
    (error: unknown) => error instanceof NoTaskBoundError,
  );
  assert.equal(executor.calls.length, 0);
});

test("project scope is refused when the session is actually task-bound", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher", "openai", "cli");
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const executor = new RecordingExecutor(() => researcherResult());
  await assert.rejects(
    invocationPort(
      fixture,
      { provider: "openai" },
      executor,
    ).invoke({
      agent: "researcher",
      scope: { kind: "project", sessionId: opened.sessionId },
      instruction: "Research it.",
    }),
    (error: unknown) =>
      error instanceof UnsupportedAgentInvocationError &&
      error.details?.reason === "project_scope_requires_unbound_task",
  );
  assert.equal(executor.calls.length, 0);
});

test("no session is implicitly created by an invocation", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher", "openai", "cli");
  const executor = new RecordingExecutor(() => researcherResult());
  await assert.rejects(
    invocationPort(
      fixture,
      { provider: "openai" },
      executor,
    ).invoke({
      agent: "researcher",
      scope: { kind: "task_session", sessionId: "ses_neverexisted0000000000000001" },
      instruction: "Research it.",
    }),
  );
  assert.equal(
    await fixture.sessions.findBinding("ses_neverexisted0000000000000001"),
    null,
  );
  assert.equal(await fixture.sessions.findTaskOwner(fixture.task.id), null);
});

// ---------------------------------------------------------------------------
// Direct-user semantics
// ---------------------------------------------------------------------------

test("a top-level invocation bypasses the agent->agent edge rule but classifies helper requests", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher", "openai", "cli");
  await configure(fixture, "examiner", "openai", "cli");
  // Deny researcher -> examiner. A DIRECT-USER invocation of researcher must
  // still run (the top-level target is not an agent->agent edge), while the
  // helper request it returns must be classified through this rule.
  await fixture.rules.setRule(
    "global",
    { kind: "agent_call", caller: "researcher", target: "examiner" },
    "deny",
  );
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const executor = new RecordingExecutor(() => ({
    agent: "researcher",
    outcome: "success",
    summary: "Research complete, wants the examiner.",
    researchArtifact: { findings: ["ok"] },
    requestedCalls: [
      {
        target: "examiner",
        purpose: "memory_update",
        handoff: {
          caller: "researcher",
          target: "examiner",
          purpose: "memory_update",
          summary: "Record the finding.",
        },
      },
    ],
  }));
  const result = await invocationPort(
    fixture,
    { provider: "openai" },
    executor,
  ).invoke({
    agent: "researcher",
    scope: { kind: "task_session", sessionId: opened.sessionId },
    instruction: "Research it.",
  });
  // The top-level researcher ran despite the deny rule.
  assert.equal(result.processedResult.outcome, "success");
  // The helper request is classified as denied, and NOT executed.
  assert.equal(result.helperCalls.length, 1);
  assert.equal(result.helperCalls[0]?.status, "denied");
  assert.equal(executor.calls.length, 1, "no helper was auto-executed");
});

test("requested actions are classified and returned, never auto-approved or executed", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher", "openai", "cli");
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const executor = new RecordingExecutor(() => ({
    agent: "researcher",
    outcome: "success",
    summary: "Needs network and a push.",
    researchArtifact: { findings: ["ok"] },
    requestedActions: [
      { action: "network", reason: "External research is required." },
      { action: "git_push", reason: "Publish the branch." },
    ],
  }));
  const result = await invocationPort(
    fixture,
    { provider: "openai" },
    executor,
  ).invoke({
    agent: "researcher",
    scope: { kind: "task_session", sessionId: opened.sessionId },
    instruction: "Research it.",
  });
  assert.equal(result.actionClassifications.length, 2);
  for (const classification of result.actionClassifications) {
    // Default-deny stands; nothing was approved or executed on our behalf.
    assert.ok(
      ["denied", "approval_required", "unavailable"].includes(
        classification.status,
      ),
      `${classification.request.action} => ${classification.status}`,
    );
  }
  assert.equal(executor.calls.length, 1);
});

test("an agent needs_user outcome is a normal result, not an invocation failure", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "questioner", "openai", "cli");
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const executor = new RecordingExecutor(() => ({
    agent: "questioner",
    outcome: "needs_user",
    summary: "A question remains.",
    state: "pending_question",
    question: "Which database should we target?",
  }));
  const result = await invocationPort(
    fixture,
    { provider: "openai" },
    executor,
  ).invoke({
    agent: "questioner",
    scope: { kind: "task_session", sessionId: opened.sessionId },
    instruction: "Clarify the requirements.",
  });
  assert.equal(result.processedResult.outcome, "needs_user");
});

test("the resolved execution policy for every invocable agent is read_only", async (t) => {
  const fixture = await createFixture(t);
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  // Researcher and examiner both accept a task scope; use researcher here.
  await configure(fixture, "researcher", "openai", "cli");
  const executor = new RecordingExecutor(() => researcherResult());
  const result = await invocationPort(
    fixture,
    { provider: "openai" },
    executor,
  ).invoke({
    agent: "researcher",
    scope: { kind: "task_session", sessionId: opened.sessionId },
    instruction: "Research it.",
  });
  assert.equal(result.executionPolicy.sourceModification, "read_only");
  assert.equal(
    executor.calls[0]?.executionPolicy.sourceModification,
    "read_only",
  );
});

// ---------------------------------------------------------------------------
// Phase 3B: provider dispatch through the real invocation pipeline
// ---------------------------------------------------------------------------

class ProviderSpy implements AgentExecutor {
  readonly calls: AgentExecutionInput[] = [];
  constructor(private readonly label: string) {}
  async execute(input: AgentExecutionInput): Promise<unknown> {
    this.calls.push(input);
    return {
      agent: input.context.agent,
      outcome: "success",
      summary: `${this.label} executed.`,
      researchArtifact: { findings: [this.label] },
    };
  }
}

interface DispatchSpies {
  readonly openaiCli: ProviderSpy;
  readonly anthropicCli: ProviderSpy;
  readonly googleCli: ProviderSpy;
  readonly executor: ProviderDispatchingAgentExecutor;
}

function dispatchSpies(): DispatchSpies {
  const openaiCli = new ProviderSpy("codex");
  const anthropicCli = new ProviderSpy("claude");
  const googleCli = new ProviderSpy("antigravity");
  return {
    openaiCli,
    anthropicCli,
    googleCli,
    executor: new ProviderDispatchingAgentExecutor({
      openaiCli,
      anthropicCli,
      googleCli,
    }),
  };
}

test("case A: an anthropic host with an openai/cli target reaches the Codex delegate", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher", "openai", "cli");
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const spies = dispatchSpies();
  const result = await invocationPort(
    fixture,
    { provider: "anthropic" },
    spies.executor,
  ).invoke({
    agent: "researcher",
    scope: { kind: "task_session", sessionId: opened.sessionId },
    instruction: "Research it.",
  });
  assert.equal(result.processedResult.outcome, "success");
  assert.equal(spies.openaiCli.calls.length, 1);
  assert.equal(spies.anthropicCli.calls.length, 0);
  assert.equal(spies.googleCli.calls.length, 0);
  assert.equal(spies.openaiCli.calls[0]?.route.routingReason, "cross_provider_cli");
});

test("case B: openai/cli host with anthropic/cli target reaches the Claude delegate", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher", "anthropic", "cli");
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const spies = dispatchSpies();
  await invocationPort(
    fixture,
    { provider: "openai" },
    spies.executor,
  ).invoke({
    agent: "researcher",
    scope: { kind: "task_session", sessionId: opened.sessionId },
    instruction: "Research it.",
  });
  assert.equal(spies.anthropicCli.calls.length, 1);
  assert.equal(spies.openaiCli.calls.length, 0);
  assert.equal(spies.googleCli.calls.length, 0);
});

test("case C: a VS Code target fails closed with no delegate run at all", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher", "anthropic", "vscode");
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const spies = dispatchSpies();
  await assert.rejects(
    invocationPort(
      fixture,
      { provider: "anthropic" },
      spies.executor,
    ).invoke({
      agent: "researcher",
      scope: { kind: "task_session", sessionId: opened.sessionId },
      instruction: "Research it.",
    }),
    // Phase 8B: refused at ROUTING, before dispatch is even attempted, so no
    // provider adapter is consulted and no execution identity is implied.
    (error: unknown) =>
      error instanceof AgentTargetSurfaceUnsupportedError &&
      error.code === "AGENT_TARGET_SURFACE_UNSUPPORTED",
  );
  assert.equal(spies.openaiCli.calls.length, 0);
  assert.equal(spies.anthropicCli.calls.length, 0);
  assert.equal(spies.googleCli.calls.length, 0);
});

test("case D: a google/cli target reaches the Antigravity delegate, not another provider", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher", "google", "cli");
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const spies = dispatchSpies();
  await invocationPort(
    fixture,
    { provider: "anthropic" },
    spies.executor,
  ).invoke({
    agent: "researcher",
    scope: { kind: "task_session", sessionId: opened.sessionId },
    instruction: "Research it.",
  });
  assert.equal(spies.googleCli.calls.length, 1);
  assert.equal(spies.openaiCli.calls.length, 0);
  assert.equal(spies.anthropicCli.calls.length, 0);
});

test("the real Antigravity adapter still fails closed through the dispatcher", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher", "google", "cli");
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  // A process runner that would fail loudly if `agy` were ever spawned: the
  // accepted security resolver must refuse before any model spawn.
  const forbiddenRunner: ProcessRunner = {
    async run() {
      throw new Error("agy must never be spawned");
    },
  };
  const executor = new ProviderDispatchingAgentExecutor({
    openaiCli: new ProviderSpy("codex"),
    anthropicCli: new ProviderSpy("claude"),
    googleCli: new AntigravityCliAgentExecutor({
      processRunner: forbiddenRunner,
    }),
  });
  await assert.rejects(
    invocationPort(
      fixture,
      { provider: "anthropic" },
      executor,
    ).invoke({
      agent: "researcher",
      scope: { kind: "task_session", sessionId: opened.sessionId },
      instruction: "Research it.",
    }),
    (error: unknown) => {
      const cause = (error as { cause?: unknown }).cause;
      return (
        error instanceof AgentExecutionFailedError &&
        cause instanceof AntigravityCliExecutionError &&
        cause.details?.reason === "unsupported_execution_policy"
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Phase 3D: allowed-network continuation through the real pipeline
// ---------------------------------------------------------------------------

async function networkFixture(
  t: TestContext,
  decision: "allow" | "ask",
): Promise<{
  readonly fixture: Fixture;
  readonly sessionId: string;
  readonly executor: RecordingExecutor;
  readonly service: AgentInvocationService;
}> {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher", "openai", "cli");
  await fixture.rules.setRule(
    "global",
    { kind: "action", action: "network" },
    decision,
  );
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const executor = new RecordingExecutor(() => ({
    agent: "researcher",
    outcome: "success",
    summary: "Research needs the network.",
    researchArtifact: { findings: ["needs network"] },
    requestedActions: [
      { action: "network", reason: "External research is required." },
    ],
  }));
  return {
    fixture,
    sessionId: opened.sessionId,
    executor,
    service: new AgentInvocationService({
      executor,
      runtimeAvailability: availableEverywhere,
      synaphexRoot: fixture.stateRoot,
      homeDirectory: fixture.homeDirectory,
    }),
  };
}

test("an allowed network action does NOT auto-resume the caller", async (t) => {
  const h = await networkFixture(t, "allow");
  const first = await new DirectAgentInvocation({
    host: { provider: "openai" },
    invocations: h.service,
    sessions: h.fixture.sessions,
    roleContracts: new RoleContractRegistry(),
  }).invoke({
    agent: "researcher",
    scope: { kind: "task_session", sessionId: h.sessionId },
    instruction: "Research it.",
  });

  assert.equal(first.actionClassifications[0]?.status, "allowed");
  // The provider ran exactly once; nothing continued automatically.
  assert.equal(h.executor.calls.length, 1);

  // Explicit continuation performs the second execution.
  await h.service.resumeCallerWithAllowedAction({
    sessionId: h.sessionId,
    previousInvocation: first as never,
    actionClassification: first.actionClassifications[0]!,
    host: { provider: "openai" },
  });
  assert.equal(h.executor.calls.length, 2);
});

test("the resumed execution is actually authorized to use the network", async (t) => {
  const h = await networkFixture(t, "allow");
  const first = await new DirectAgentInvocation({
    host: { provider: "openai" },
    invocations: h.service,
    sessions: h.fixture.sessions,
    roleContracts: new RoleContractRegistry(),
  }).invoke({
    agent: "researcher",
    scope: { kind: "task_session", sessionId: h.sessionId },
    instruction: "Research it.",
  });

  await h.service.resumeCallerWithAllowedAction({
    sessionId: h.sessionId,
    previousInvocation: first as never,
    actionClassification: first.actionClassifications[0]!,
    host: { provider: "openai" },
  });

  // Inspect the ACTUAL ExecutionPolicy the provider received, not just that it
  // was called: a rule-allowed capability is usable with no approval token.
  const resumedPolicy = h.executor.calls[1]!.executionPolicy;
  const network = resumedPolicy.providerCapabilities.network;
  assert.equal(network.decision, "allow");
  assert.equal(isProviderCapabilityUsable(network), true);
  // No approval was fabricated: authority comes from the rule itself.
  assert.equal(network.approvedForInvocation, false);
});

test("an approval-required network resume is authorized via the approval token", async (t) => {
  const h = await networkFixture(t, "ask");
  const first = await new DirectAgentInvocation({
    host: { provider: "openai" },
    invocations: h.service,
    sessions: h.fixture.sessions,
    roleContracts: new RoleContractRegistry(),
  }).invoke({
    agent: "researcher",
    scope: { kind: "task_session", sessionId: h.sessionId },
    instruction: "Research it.",
  });
  assert.equal(first.actionClassifications[0]?.status, "approval_required");

  await h.service.resumeCallerWithActionApproval({
    sessionId: h.sessionId,
    previousInvocation: first as never,
    actionClassification: first.actionClassifications[0]!,
    approvalGranted: true,
    host: { provider: "openai" },
  });

  // Visibly distinct authority source: the rule is still `ask`, and usability
  // comes from the one-time invocation-scoped approval.
  const network = h.executor.calls[1]!.executionPolicy.providerCapabilities.network;
  assert.equal(network.decision, "ask");
  assert.equal(network.approvedForInvocation, true);
  assert.equal(isProviderCapabilityUsable(network), true);
});

test("the two Core continuation paths reject each other's classification", async (t) => {
  const allowed = await networkFixture(t, "allow");
  const allowedFirst = await allowed.service.invokeUserAgent({
    sessionId: allowed.sessionId,
    agent: "researcher",
    host: { provider: "openai" },
    instruction: "Research it.",
  });
  await assert.rejects(
    allowed.service.resumeCallerWithActionApproval({
      sessionId: allowed.sessionId,
      previousInvocation: allowedFirst as never,
      actionClassification: allowedFirst.actionClassifications[0]!,
      approvalGranted: true,
      host: { provider: "openai" },
    }),
    (error: unknown) =>
      error instanceof Error && /approval_required/.test(error.message),
  );

  const asked = await networkFixture(t, "ask");
  const askedFirst = await asked.service.invokeUserAgent({
    sessionId: asked.sessionId,
    agent: "researcher",
    host: { provider: "openai" },
    instruction: "Research it.",
  });
  await assert.rejects(
    asked.service.resumeCallerWithAllowedAction({
      sessionId: asked.sessionId,
      previousInvocation: askedFirst as never,
      actionClassification: askedFirst.actionClassifications[0]!,
      host: { provider: "openai" },
    }),
    (error: unknown) =>
      error instanceof Error && /allowed/.test(error.message),
  );
});

test("neither Core continuation path accepts a host action", async (t) => {
  const h = await createFixture(t);
  await configure(h, "researcher", "openai", "cli");
  await h.rules.setRule(
    "global",
    { kind: "action", action: "git_push" },
    "allow",
  );
  const opened = await h.commands.openTaskSession(h.project.id, h.task.id);
  const executor = new RecordingExecutor(() => ({
    agent: "researcher",
    outcome: "success",
    summary: "Wants a push.",
    researchArtifact: { findings: ["push"] },
    requestedActions: [{ action: "git_push", reason: "Publish the branch." }],
  }));
  const service = new AgentInvocationService({
    executor,
    runtimeAvailability: availableEverywhere,
    synaphexRoot: h.stateRoot,
    homeDirectory: h.homeDirectory,
  });
  const first = await service.invokeUserAgent({
    sessionId: opened.sessionId,
    agent: "researcher",
    host: { provider: "openai" },
    instruction: "Research it.",
  });
  const classification = first.actionClassifications[0]!;
  assert.equal(classification.request.action, "git_push");
  // git_push is a HOST ACTION, not a provider capability.
  assert.notEqual(classification.executionKind, "provider_capability");

  for (const attempt of [
    () =>
      service.resumeCallerWithAllowedAction({
        sessionId: opened.sessionId,
        previousInvocation: first as never,
        actionClassification: classification,
        host: { provider: "openai" },
      }),
    () =>
      service.resumeCallerWithActionApproval({
        sessionId: opened.sessionId,
        previousInvocation: first as never,
        actionClassification: classification,
        approvalGranted: true,
        host: { provider: "openai" },
      }),
  ]) {
    await assert.rejects(attempt);
  }
  assert.equal(executor.calls.length, 1, "no continuation executed");
});
