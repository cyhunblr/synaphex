import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { AgentConfigManager } from "../src/core/agent-config-manager.js";
import { ProjectManager } from "../src/core/project-manager.js";
import { TaskManager } from "../src/core/task-manager.js";
import { StateStore } from "../src/infrastructure/state-store.js";

/**
 * Public MCP error diagnosability.
 *
 * Two refusals are architecturally correct but were reaching hosts without
 * their own identity: a `vscode` target collapsed to INTERNAL_ERROR, and an
 * unenforceable provider execution policy was wrapped as AGENT_EXECUTION_FAILED.
 * Both are fail-closed either way; these tests bind the CODE a host observes,
 * because that is what a user has to act on.
 *
 * Driven through a real stdio child process with the official MCP client, so
 * the assertions are on host-visible output rather than internal exceptions.
 */

const ENTRYPOINT = join(process.cwd(), ".test-dist", "src", "mcp", "stdio-main.js");

interface Fixture {
  readonly client: Client;
  readonly projectId: string;
  readonly taskId: string;
  readonly stderr: () => string;
  /** Written only if the stub provider was invoked for agent execution. */
  readonly executionMarker: string;
}

/**
 * Writes a stand-in `agy` that answers ONLY the runtime-availability probes.
 *
 * It reports a supported version and advertises every capability flag the
 * Antigravity availability check requires, so routing accepts the runtime and
 * the invocation reaches execution-policy resolution. It deliberately
 * implements no agent execution: reaching that path exits non-zero and records
 * the attempt, so a test asserting a pre-execution refusal can prove no agent
 * ran.
 */
async function writeAgyAvailabilityStub(
  directory: string,
  executionMarker: string,
): Promise<void> {
  const stub = [
    "#!/usr/bin/env node",
    'import { writeFileSync } from "node:fs";',
    "const argv = process.argv.slice(2);",
    'if (argv[0] === "--version") {',
    '  process.stdout.write("1.1.26\\n");',
    "  process.exit(0);",
    "}",
    'if (argv[0] === "--help") {',
    "  process.stdout.write(",
    "    [",
    '      "-p",',
    '      "--output-format",',
    '      "--json-schema",',
    '      "--model",',
    '      "--mode",',
    '      "--sandbox",',
    '      "--print-timeout",',
    '      "--disable-slash-commands",',
    '      "modes: accept-edits, plan",',
    '    ].join("\\n") + "\\n",',
    "  );",
    "  process.exit(0);",
    "}",
    "// Anything else is an agent-execution attempt, which must never happen here.",
    `writeFileSync(${JSON.stringify(executionMarker)}, argv.join(" "));`,
    "process.exit(9);",
    "",
  ].join("\n");
  const path = join(directory, "agy");
  await writeFile(path, stub, "utf8");
  await chmod(path, 0o755);
}

async function fixture(
  t: TestContext,
  agent: {
    readonly provider: "openai" | "anthropic" | "google";
    readonly surface: "cli" | "vscode";
    readonly model: string;
  },
): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), "synaphex-public-error-"));
  t.after(() => rm(home, { recursive: true, force: true }));

  const stateRoot = join(home, ".synaphex");
  const sourcePath = join(home, "source");
  await mkdir(sourcePath, { recursive: true });
  const store = new StateStore(stateRoot);
  const projects = new ProjectManager(store, { homeDirectory: home });
  const tasks = new TaskManager(store, projects);
  const project = await projects.create("Public Error Project", sourcePath);
  const task = await tasks.create(project.id, "Public error diagnosability task");
  await new AgentConfigManager(store).setConfigured("researcher", {
    provider: agent.provider,
    surface: agent.surface,
    model: agent.model,
  });

  // Hermetic provider runtime. `agy` is resolved from PATH, so an ambient
  // installation on a developer machine would otherwise decide whether this
  // test reaches execution-policy resolution at all -- which is exactly how
  // this test passed locally and failed in CI. PATH is replaced rather than
  // prepended so no real provider CLI is reachable either way.
  const binDirectory = join(home, "bin");
  await mkdir(binDirectory, { recursive: true });
  const executionMarker = join(home, "agent-execution-attempted");
  await writeAgyAvailabilityStub(binDirectory, executionMarker);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRYPOINT, "--host-provider", "anthropic"],
    env: {
      HOME: home,
      PATH: `${binDirectory}:${dirname(process.execPath)}`,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "public-error", version: "0.0.0" });
  await client.connect(transport);
  const chunks: string[] = [];
  transport.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
  t.after(() => client.close());

  return {
    client,
    projectId: project.id,
    taskId: task.id,
    stderr: () => chunks.join(""),
    executionMarker,
  };
}

async function invokeResearcher(f: Fixture): Promise<string> {
  const opened = await f.client.callTool({
    name: "synaphex_open_task_session",
    arguments: { projectId: f.projectId, taskId: f.taskId },
  });
  const { sessionId } = JSON.parse(
    (opened.content as { text: string }[])[0]!.text,
  ) as { sessionId: string };
  const invoked = await f.client.callTool({
    name: "synaphex_invoke_agent",
    arguments: {
      agent: "researcher",
      scope: { kind: "task_session", sessionId },
      instruction: "Reply with the single word OK.",
    },
  });
  assert.equal(invoked.isError, true, "the invocation must fail closed");
  return (invoked.content as { text: string }[])[0]!.text;
}

test("a vscode target reports AGENT_TARGET_SURFACE_UNSUPPORTED to the host", async (t) => {
  const f = await fixture(t, {
    provider: "anthropic",
    surface: "vscode",
    model: "claude-sonnet-4-5",
  });

  const failure = await invokeResearcher(f);

  assert.match(failure, /^AGENT_TARGET_SURFACE_UNSUPPORTED:/);
  // The refusal happens in the router, before any provider process exists.
  // `claude` is never spawned, so nothing provider-side can have run.
  assert.doesNotMatch(failure, /INTERNAL_ERROR/);
  assert.doesNotMatch(f.stderr(), /spawn/i);
});

test("an unenforceable provider execution policy reports PROVIDER_EXECUTION_POLICY_UNSUPPORTED", async (t) => {
  // Google/Antigravity exposes only persistent, provider-owned policy settings,
  // so Synaphex cannot establish an invocation-scoped read-only contract and
  // refuses. That refusal is a stable public diagnostic, not a provider crash.
  const f = await fixture(t, {
    provider: "google",
    surface: "cli",
    model: "Gemini 3.1 Pro (Low)",
  });

  const failure = await invokeResearcher(f);

  assert.match(failure, /^PROVIDER_EXECUTION_POLICY_UNSUPPORTED:/);
  assert.doesNotMatch(failure, /AGENT_EXECUTION_FAILED/);
  // The runtime probes ran (that is how routing accepted it), but policy
  // resolution refused before any agent execution, so the stub never saw a
  // run request.
  assert.equal(
    existsSync(f.executionMarker),
    false,
    "the provider must not be invoked for agent execution",
  );
});
