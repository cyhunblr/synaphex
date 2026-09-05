import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { MemoryOperations } from "../src/operations/memory-operations.js";
import { MemoryManager } from "../src/core/memory-manager.js";
import { ProjectManager } from "../src/core/project-manager.js";
import { SessionManager } from "../src/core/session-manager.js";
import { TaskManager } from "../src/core/task-manager.js";
import { RoleContractRegistry } from "../src/core/role-contract-registry.js";
import { StateStore } from "../src/infrastructure/state-store.js";
import { generateSessionId } from "../src/domain/session.js";
import { ARTIFACT_ID_PATTERN, isArtifactId } from "../src/domain/artifact.js";
import { StandardAgentResultJsonSchemaBuilder } from "../src/providers/standard-agent-result-json-schema-builder.js";

/**
 * Memory references as a public capability.
 *
 * Loading records provenance so one scope can see another's canonical memory.
 * It is deliberately NOT a memory write: the canonical document is never
 * copied and never mutated here, and only EXAMINER may change it.
 */

interface Fixture {
  readonly memory: MemoryOperations;
  readonly manager: MemoryManager;
  readonly projectId: string;
  readonly taskId: string;
  readonly sessionId: string;
  readonly root: string;
}

async function fixture(t: TestContext): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), "synaphex-memory-public-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = join(home, ".synaphex");
  const source = join(home, "source");
  await mkdir(source, { recursive: true });

  const store = new StateStore(root);
  const projects = new ProjectManager(store, { homeDirectory: home });
  const tasks = new TaskManager(store, projects);
  const sessions = new SessionManager(store);
  const manager = new MemoryManager(store, projects, tasks);

  const project = await projects.create("Memory Surface", source);
  const task = await tasks.create(project.id, "Memory surface task");
  const sessionId = generateSessionId();
  await sessions.bindProject(sessionId, project.id);

  // Canonical memory exists only because EXAMINER-equivalent authority wrote
  // it; the public load surface never creates it.
  await manager.replaceCanonicalMemory(
    { kind: "task", projectId: project.id, taskId: task.id },
    "# Task memory\n\nA durable fact.\n",
  );

  return {
    memory: new MemoryOperations({ synaphexRoot: root, homeDirectory: home }),
    manager,
    projectId: project.id,
    taskId: task.id,
    sessionId,
    root,
  };
}

test("loading records a reference without copying canonical memory", async (t) => {
  const f = await fixture(t);

  const reference = await f.memory.loadMemory({
    sessionId: f.sessionId as never,
    sourceProjectRef: f.projectId,
    sourceTaskRef: f.taskId,
  });

  assert.equal(reference.target.kind, "project");
  assert.equal(reference.source.kind, "task");
  const loaded = await f.memory.listLoadedMemory(f.sessionId as never);
  assert.equal(loaded.length, 1);

  // The canonical document is untouched and still the only authority.
  const canonical = await f.manager.getTaskCanonicalMemory(
    f.projectId as never,
    f.taskId as never,
  );
  assert.match(canonical.content ?? "", /A durable fact/);
});

test("a duplicate load fails closed rather than silently rebinding", async (t) => {
  const f = await fixture(t);
  const request = {
    sessionId: f.sessionId as never,
    sourceProjectRef: f.projectId,
    sourceTaskRef: f.taskId,
  };
  await f.memory.loadMemory(request);

  await assert.rejects(
    f.memory.loadMemory(request),
    (error: unknown) =>
      (error as { code?: string }).code === "MEMORY_ALREADY_LOADED",
  );
});

test("unloading removes the reference and leaves canonical memory intact", async (t) => {
  const f = await fixture(t);
  const request = {
    sessionId: f.sessionId as never,
    sourceProjectRef: f.projectId,
    sourceTaskRef: f.taskId,
  };
  await f.memory.loadMemory(request);
  await f.memory.unloadMemory(request);

  assert.equal((await f.memory.listLoadedMemory(f.sessionId as never)).length, 0);
  const canonical = await f.manager.getTaskCanonicalMemory(
    f.projectId as never,
    f.taskId as never,
  );
  assert.match(canonical.content ?? "", /A durable fact/);
});

test("unloading something that was never loaded fails closed", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.memory.unloadMemory({
      sessionId: f.sessionId as never,
      sourceProjectRef: f.projectId,
      sourceTaskRef: f.taskId,
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "MEMORY_NOT_LOADED",
  );
});

test("an unknown memory source is rejected, not silently ignored", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.memory.loadMemory({
      sessionId: f.sessionId as never,
      sourceProjectRef: "prj_does_not_exist",
    }),
  );
});

test("the public load surface grants no canonical write authority", async (t) => {
  await fixture(t);
  // Loading is a reference operation; canonical writes stay role-gated, and
  // RESEARCHER must not gain that authority by the tool existing.
  const contracts = new RoleContractRegistry();
  assert.equal(contracts.canWriteCanonicalMemory("examiner"), true);
  for (const agent of ["questioner", "researcher", "planner", "coder", "reviewer"] as const) {
    assert.equal(contracts.canWriteCanonicalMemory(agent), false, agent);
  }
});

test("artifact references share one shape across schema and parser", () => {
  const valid = `artifact_${"a1b2c3d4".repeat(4)}`;
  assert.equal(valid.length, "artifact_".length + 32);
  assert.ok(isArtifactId(valid));

  const pattern = new RegExp(ARTIFACT_ID_PATTERN);
  // The provider-facing schema must reject exactly what the parser rejects,
  // otherwise a provider is told a value is acceptable and then refused.
  assert.equal(pattern.test("findings.md"), false);
  assert.equal(pattern.test("artifact_tooshort"), false);
  assert.equal(pattern.test(`artifact_${"A1B2C3D4".repeat(4)}`), false);
  assert.equal(pattern.test(`artifact_${"z".repeat(32)}`), false);
  assert.equal(pattern.test(valid), true);
});

test("the provider result schema constrains artifactRefs to artifact ids", () => {
  const schema = new StandardAgentResultJsonSchemaBuilder().build({
    agent: "researcher",
    project: { id: "prj_x", name: "x", sourcePath: "/tmp/x" },
    task: null,
    instruction: "x",
    behavior: { outputFields: ["findings"] },
  } as never) as Record<string, unknown>;

  const serialized = JSON.stringify(schema);
  assert.ok(
    serialized.includes(ARTIFACT_ID_PATTERN),
    "artifactRefs must advertise the canonical artifact-id pattern",
  );
});
