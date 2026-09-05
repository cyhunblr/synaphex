import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { AgentContext } from "../src/domain/agent-context.js";
import type {
  AgentExecutionInput,
  AgentExecutor,
} from "../src/domain/agent-invocation.js";
import type { AgentProvider, AgentSurface } from "../src/domain/agent-config.js";
import {
  InvalidProviderRouteError,
  NativeHostExecutionUnavailableError,
} from "../src/domain/errors.js";
import type { ExecutionPolicy } from "../src/domain/execution-policy.js";
import type { ExecutionRoute } from "../src/domain/provider-routing.js";
import { ProviderDispatchingAgentExecutor } from "../src/providers/provider-dispatching-agent-executor.js";

class SpyExecutor implements AgentExecutor {
  readonly calls: AgentExecutionInput[] = [];
  constructor(private readonly result: unknown = { ok: true }) {}
  async execute(input: AgentExecutionInput): Promise<unknown> {
    this.calls.push(input);
    return this.result;
  }
}

interface Spies {
  readonly openaiCli: SpyExecutor;
  readonly anthropicCli: SpyExecutor;
  readonly googleCli: SpyExecutor;
  readonly dispatcher: ProviderDispatchingAgentExecutor;
}

function spies(): Spies {
  const openaiCli = new SpyExecutor({ from: "codex" });
  const anthropicCli = new SpyExecutor({ from: "claude" });
  const googleCli = new SpyExecutor({ from: "antigravity" });
  return {
    openaiCli,
    anthropicCli,
    googleCli,
    dispatcher: new ProviderDispatchingAgentExecutor({
      openaiCli,
      anthropicCli,
      googleCli,
    }),
  };
}

function totalCalls(s: Spies): number {
  return (
    s.openaiCli.calls.length +
    s.anthropicCli.calls.length +
    s.googleCli.calls.length
  );
}

const executionPolicy: ExecutionPolicy = Object.freeze({
  sourceModification: "read_only" as const,
  providerCapabilities: {
    network: {
      decision: "deny" as const,
      source: "default_deny" as const,
      approvedForInvocation: false,
    },
  },
});

const context = Object.freeze({ agent: "researcher" }) as unknown as AgentContext;

function input(
  provider: AgentProvider,
  effectiveSurface: AgentSurface,
  overrides: Partial<ExecutionRoute> = {},
): AgentExecutionInput {
  const route: ExecutionRoute = {
    agent: "researcher",
    host: { provider: "anthropic" },
    provider,
    configuredSurface: effectiveSurface,
    effectiveSurface,
    cliForcedByCrossProvider: false,
    // A `vscode` effectiveSurface is no longer producible by ProviderRouter;
    // it is constructed here only to prove the dispatcher still fails closed
    // as defence in depth if one ever reached it.
    routingReason: "cross_provider_cli",
    model: `${provider}-model`,
    ...overrides,
  };
  return { route, context, executionPolicy };
}

// ---------------------------------------------------------------------------
// Dispatch matrix
// ---------------------------------------------------------------------------

test("openai/cli dispatches only to the OpenAI delegate", async () => {
  const s = spies();
  const result = await s.dispatcher.execute(input("openai", "cli"));
  assert.deepEqual(result, { from: "codex" });
  assert.equal(s.openaiCli.calls.length, 1);
  assert.equal(s.anthropicCli.calls.length, 0);
  assert.equal(s.googleCli.calls.length, 0);
});

test("anthropic/cli dispatches only to the Anthropic delegate", async () => {
  const s = spies();
  const result = await s.dispatcher.execute(input("anthropic", "cli"));
  assert.deepEqual(result, { from: "claude" });
  assert.equal(s.anthropicCli.calls.length, 1);
  assert.equal(s.openaiCli.calls.length, 0);
  assert.equal(s.googleCli.calls.length, 0);
});

test("google/cli dispatches only to the Antigravity delegate", async () => {
  const s = spies();
  const result = await s.dispatcher.execute(input("google", "cli"));
  assert.deepEqual(result, { from: "antigravity" });
  assert.equal(s.googleCli.calls.length, 1);
  assert.equal(s.openaiCli.calls.length, 0);
  assert.equal(s.anthropicCli.calls.length, 0);
});

test("a native VS Code route fails closed and calls no CLI delegate", async () => {
  for (const provider of ["openai", "anthropic", "google"] as const) {
    const s = spies();
    await assert.rejects(
      s.dispatcher.execute(input(provider, "vscode")),
      (error: unknown) =>
        error instanceof NativeHostExecutionUnavailableError &&
        error.code === "NATIVE_HOST_EXECUTION_UNAVAILABLE" &&
        error.details?.provider === provider &&
        error.details?.surface === "vscode",
      `${provider}/vscode must fail closed`,
    );
    assert.equal(totalCalls(s), 0, "no CLI delegate may run");
  }
});

test("native-host unavailability is distinct from an invalid route", async () => {
  const s = spies();
  await assert.rejects(
    s.dispatcher.execute(input("anthropic", "vscode")),
    (error: unknown) => {
      assert.ok(error instanceof NativeHostExecutionUnavailableError);
      // The route itself is valid; only execution support is missing.
      assert.notEqual(error.code, "INVALID_PROVIDER_ROUTE");
      assert.notEqual(error.code, "PROVIDER_CLI_UNAVAILABLE");
      return true;
    },
  );
});

test("an unrecognised provider fails rather than substituting another", async () => {
  const s = spies();
  await assert.rejects(
    s.dispatcher.execute(
      input("openai", "cli", {
        provider: "acme" as unknown as AgentProvider,
      }),
    ),
    (error: unknown) => error instanceof InvalidProviderRouteError,
  );
  assert.equal(totalCalls(s), 0);
});

// ---------------------------------------------------------------------------
// Transparency
// ---------------------------------------------------------------------------

test("the dispatcher forwards the execution request without mutating it", async () => {
  const s = spies();
  const original = input("openai", "cli", {
    model: "explicit-model",
    settings: { effort: "high" },
    cliForcedByCrossProvider: true,
  });
  const snapshot = structuredClone({
    route: original.route,
    context: original.context,
    executionPolicy: original.executionPolicy,
  });

  await s.dispatcher.execute(original);

  const delivered = s.openaiCli.calls[0]!;
  // The delegate receives the identical object graph.
  assert.equal(delivered, original, "the same input object is forwarded");
  assert.deepEqual(delivered.route, snapshot.route);
  assert.deepEqual(delivered.context, snapshot.context);
  assert.deepEqual(delivered.executionPolicy, snapshot.executionPolicy);
  // Model and settings are never rewritten.
  assert.equal(delivered.route.model, "explicit-model");
  assert.deepEqual(delivered.route.settings, { effort: "high" });
});

test("the dispatcher never infers a provider from the host or the model", async () => {
  const s = spies();
  // Host says anthropic and the model string mentions claude, but the route
  // says openai -- the route is authoritative.
  await s.dispatcher.execute(
    input("openai", "cli", {
      host: { provider: "anthropic" },
      model: "claude-sonnet-5",
    }),
  );
  assert.equal(s.openaiCli.calls.length, 1);
  assert.equal(s.anthropicCli.calls.length, 0);
});

test("the dispatcher performs no fallback when a delegate fails", async () => {
  const failing = new SpyExecutor();
  failing.execute = async () => {
    throw new Error("codex runtime missing");
  };
  const anthropicCli = new SpyExecutor();
  const googleCli = new SpyExecutor();
  const dispatcher = new ProviderDispatchingAgentExecutor({
    openaiCli: failing,
    anthropicCli,
    googleCli,
  });
  await assert.rejects(dispatcher.execute(input("openai", "cli")));
  // Failure is preferable to silently changing execution identity.
  assert.equal(anthropicCli.calls.length, 0);
  assert.equal(googleCli.calls.length, 0);
});

test("the dispatcher source contains no fallback or availability probing", async () => {
  const source = (
    await readFile(
      join(
        process.cwd(),
        "src",
        "providers",
        "provider-dispatching-agent-executor.ts",
      ),
      "utf8",
    )
  )
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/\/\/.*$/gm, "");
  for (const forbidden of [
    "RuntimeAvailability",
    "isAvailable",
    "fallback",
    "catch",
    "route.model =",
    "ContextBuilder",
    "ProviderRouter",
    "resolveRule",
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `dispatcher must not reference ${forbidden}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Layering audit
// ---------------------------------------------------------------------------

test("no MCP handler module imports a concrete provider executor", async () => {
  const mcpDirectory = join(process.cwd(), "src", "mcp");
  for (const name of (await readdir(mcpDirectory)).filter((n) =>
    n.endsWith(".ts"),
  )) {
    // stdio-main.ts is the composition root and is allowed to build adapters.
    if (name === "stdio-main.ts") {
      continue;
    }
    const source = await readFile(join(mcpDirectory, name), "utf8");
    for (const forbidden of [
      "CodexCliAgentExecutor",
      "ClaudeCliAgentExecutor",
      "AntigravityCliAgentExecutor",
      "ProviderDispatchingAgentExecutor",
      "providers/",
    ]) {
      assert.equal(
        source.includes(forbidden),
        false,
        `${name} must not reference ${forbidden}`,
      );
    }
  }
});

test("concrete provider composition exists only in the composition root", async () => {
  const source = await readFile(
    join(process.cwd(), "src", "mcp", "stdio-main.ts"),
    "utf8",
  );
  // The composition root wires all three accepted adapters through the
  // dispatcher, and nothing else in src/mcp does.
  for (const required of [
    "CodexCliAgentExecutor",
    "ClaudeCliAgentExecutor",
    "AntigravityCliAgentExecutor",
    "ProviderDispatchingAgentExecutor",
  ]) {
    assert.ok(source.includes(required), `composition root must wire ${required}`);
  }
  // A single shared runner, and no shell execution.
  assert.ok(source.includes("SpawnProcessRunner"));
  assert.equal(source.includes("shell: true"), false);
});
