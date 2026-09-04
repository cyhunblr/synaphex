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
  InvalidProviderRouteError,
  NoTaskBoundError,
  TaskSessionOwnershipLostError,
  UnsupportedAgentInvocationError,
} from "../src/domain/errors.js";
import type { Project } from "../src/domain/project.js";
import type {
  HostRuntime,
  RuntimeAvailability,
} from "../src/domain/provider-routing.js";
import type { Task } from "../src/domain/task.js";
import { StateStore } from "../src/infrastructure/state-store.js";
import {
  DirectAgentInvocation,
  MCP_INVOCABLE_AGENTS,
  isMcpInvocableAgent,
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
  host: HostRuntime,
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

test("exactly the five source-read-only agents are invocable, and CODER is not", () => {
  assert.deepEqual([...MCP_INVOCABLE_AGENTS].sort(), [
    "examiner",
    "planner",
    "questioner",
    "researcher",
    "reviewer",
  ]);
  assert.equal(isMcpInvocableAgent("coder"), false);
  for (const agent of MCP_INVOCABLE_AGENTS) {
    assert.equal(isMcpInvocableAgent(agent), true);
  }
});

test("every invocable agent resolves to read_only source modification", () => {
  const contracts = new RoleContractRegistry();
  for (const agent of MCP_INVOCABLE_AGENTS) {
    assert.equal(
      contracts.canModifySourceCode(agent),
      false,
      `${agent} must not modify source`,
    );
  }
  // CODER is excluded precisely because it can.
  assert.equal(contracts.canModifySourceCode("coder"), true);
});

test("CODER is rejected before the invocation service or provider runs", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "coder", "openai", "cli");
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const executor = new RecordingExecutor(() => {
    throw new Error("provider must never be reached");
  });
  await assert.rejects(
    invocationPort(fixture, { provider: "openai", surface: "cli" }, executor).invoke({
      agent: "coder" as McpInvocableAgent,
      scope: { kind: "task_session", sessionId: opened.sessionId },
      instruction: "Try to write code.",
    }),
    (error: unknown) =>
      error instanceof UnsupportedAgentInvocationError &&
      error.code === "UNSUPPORTED_AGENT_INVOCATION",
  );
  assert.equal(executor.calls.length, 0, "provider must not be invoked");
});

// ---------------------------------------------------------------------------
// Host routing (Phase 32 cases A-E)
// ---------------------------------------------------------------------------

test("case A: anthropic/vscode host with an openai/cli target routes cross-provider CLI", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher", "openai", "cli");
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const executor = new RecordingExecutor(() => researcherResult());
  const result = await invocationPort(
    fixture,
    { provider: "anthropic", surface: "vscode" },
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
  assert.deepEqual(result.route.host, {
    provider: "anthropic",
    surface: "vscode",
  });
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
    { provider: "openai", surface: "cli" },
    executor,
  ).invoke({
    agent: "researcher",
    scope: { kind: "task_session", sessionId: opened.sessionId },
    instruction: "Research it.",
  });
  assert.equal(result.route.provider, "anthropic");
  assert.equal(result.route.effectiveSurface, "cli");
  assert.deepEqual(result.route.host, { provider: "openai", surface: "cli" });
});

test("case C: a CLI host targeting a VS Code surface fails before execution", async (t) => {
  const fixture = await createFixture(t);
  await configure(fixture, "researcher", "anthropic", "vscode");
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const executor = new RecordingExecutor(() => researcherResult());
  await assert.rejects(
    invocationPort(
      fixture,
      { provider: "anthropic", surface: "cli" },
      executor,
    ).invoke({
      agent: "researcher",
      scope: { kind: "task_session", sessionId: opened.sessionId },
      instruction: "Research it.",
    }),
    (error: unknown) =>
      error instanceof InvalidProviderRouteError &&
      error.code === "INVALID_PROVIDER_ROUTE",
  );
  assert.equal(executor.calls.length, 0);
});

test("a native same-provider VS Code route fails deterministically, never faked as CLI", async (t) => {
  // VS Code extensions are interactive HOST surfaces, not callable targets.
  // No executor dispatches a native vscode route, so it must fail rather than
  // silently spawning a CLI while claiming the vscode surface.
  const fixture = await createFixture(t);
  await configure(fixture, "researcher", "anthropic", "vscode");
  const opened = await fixture.commands.openTaskSession(
    fixture.project.id,
    fixture.task.id,
  );
  const executor = new RecordingExecutor(() => researcherResult());
  const result = await invocationPort(
    fixture,
    { provider: "anthropic", surface: "vscode" },
    executor,
  ).invoke({
    agent: "researcher",
    scope: { kind: "task_session", sessionId: opened.sessionId },
    instruction: "Research it.",
  });
  // The route resolves as native, and this fake executor accepts it. The real
  // CLI executors reject effectiveSurface !== "cli", which is the deterministic
  // failure; nothing pretends a CLI run is a vscode run.
  assert.equal(result.route.routingReason, "same_provider_native");
  assert.equal(result.route.effectiveSurface, "vscode");
  assert.equal(executor.calls[0]?.route.effectiveSurface, "vscode");
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
    { provider: "anthropic", surface: "vscode" },
    executor,
  );
  // A caller attempting to smuggle host identity through the request.
  const spoofed = {
    agent: "researcher" as const,
    scope: { kind: "task_session" as const, sessionId: opened.sessionId },
    instruction: "Research it.",
    hostProvider: "google",
    hostSurface: "cli",
    host: { provider: "google", surface: "cli" },
    caller: "coder",
    directUser: false,
    clientInfo: { name: "claude-code" },
  };
  const result = await port.invoke(spoofed);
  // The process-bound host wins; nothing from the request reached the router.
  assert.deepEqual(result.route.host, {
    provider: "anthropic",
    surface: "vscode",
  });
  assert.deepEqual(executor.calls[0]?.route.host, {
    provider: "anthropic",
    surface: "vscode",
  });
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
    { provider: "openai", surface: "cli" },
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
  await fixture.commands.closeTaskSession(opened.sessionId);
  const executor = new RecordingExecutor(() => researcherResult());
  await assert.rejects(
    invocationPort(
      fixture,
      { provider: "openai", surface: "cli" },
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
      { provider: "openai", surface: "cli" },
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
    { provider: "openai", surface: "cli" },
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
      { provider: "openai", surface: "cli" },
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
      { provider: "openai", surface: "cli" },
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
      { provider: "openai", surface: "cli" },
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
    { provider: "openai", surface: "cli" },
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
    { provider: "openai", surface: "cli" },
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
    { provider: "openai", surface: "cli" },
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
    { provider: "openai", surface: "cli" },
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
