import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { AgentConfigManager } from "../src/core/agent-config-manager.js";
import { StateStore } from "../src/infrastructure/state-store.js";
import {
  startConfigureServer,
  type RunningConfigureServer,
} from "../src/configure/configure-server.js";
import { parseConfigureArgs } from "../src/configure/configure-command.js";
import { request as httpRequest } from "node:http";

/** Issues a request with headers `fetch` refuses to set verbatim. */
function rawRequestStatus(
  port: number,
  headers: Record<string, string>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const call = httpRequest(
      { host: "127.0.0.1", port, path: "/api/status", method: "GET", headers },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode ?? 0));
      },
    );
    call.once("error", reject);
    call.end();
  });
}

/**
 * The configure server is a local configuration editor, so its tests are
 * mostly about what it REFUSES: foreign origins, missing tokens, traversal,
 * immutable-rule overrides and stale writes. A configuration surface that
 * fails open would be worse than not shipping one.
 */

interface Fixture {
  readonly server: RunningConfigureServer;
  readonly root: string;
  readonly headers: Record<string, string>;
}

async function fixture(t: TestContext): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), "synaphex-configure-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = join(home, ".synaphex");
  await mkdir(root, { recursive: true });

  const server = await startConfigureServer({
    synaphexRoot: root,
    homeDirectory: home,
  });
  t.after(() => server.close());

  return {
    server,
    root,
    headers: {
      "x-synaphex-configure-token": server.token,
      origin: server.url,
      "content-type": "application/json",
    },
  };
}

const json = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>;

test("the configure server binds loopback only", async (t) => {
  const f = await fixture(t);
  // A URL is only reachable at 127.0.0.1; the address family is what matters,
  // so this asserts the bound host rather than probing the network.
  assert.match(f.server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  const response = await fetch(`${f.server.url}/api/status`, {
    headers: f.headers,
  });
  assert.equal(response.status, 200);
});

test("a request without the session token is refused", async (t) => {
  const f = await fixture(t);
  const response = await fetch(`${f.server.url}/api/status`);
  assert.equal(response.status, 401);
  assert.equal((await json(response)).error, "invalid_session_token");
});

test("a foreign origin is refused even with a valid token", async (t) => {
  const f = await fixture(t);
  const response = await fetch(`${f.server.url}/api/status`, {
    headers: { ...f.headers, origin: "http://attacker.example" },
  });
  assert.equal(response.status, 403);
  assert.equal((await json(response)).error, "origin_not_allowed");
});

test("a rebound host header is refused", async (t) => {
  const f = await fixture(t);
  // DNS rebinding reaches loopback under an attacker-controlled name; the Host
  // allowlist is what stops it. `fetch` treats Host as a forbidden header and
  // silently rewrites it, so this drives a raw request instead.
  const status = await rawRequestStatus(f.server.port, {
    host: "evil.example",
    "x-synaphex-configure-token": f.server.token,
  });
  assert.equal(status, 403);
});

test("a mutation must be JSON, so a cross-site form cannot drive it", async (t) => {
  const f = await fixture(t);
  const response = await fetch(`${f.server.url}/api/agents/coder`, {
    method: "PUT",
    headers: {
      "x-synaphex-configure-token": f.server.token,
      origin: f.server.url,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "provider=anthropic",
  });
  assert.equal(response.status, 415);
});

test("asset paths cannot escape the shipped web root", async (t) => {
  const f = await fixture(t);
  for (const path of [
    "/../../package.json",
    "/assets/../../../etc/passwd",
    "/../src/index.ts",
  ]) {
    const response = await fetch(`${f.server.url}${path}`);
    assert.equal(response.status, 404, path);
  }
});

test("status reports the six agents from canonical state", async (t) => {
  const f = await fixture(t);
  const status = await json(
    await fetch(`${f.server.url}/api/status`, { headers: f.headers }),
  );
  assert.equal(status.agents, 6);
  assert.equal(status.unconfigured, 6);
  assert.equal(status.executableAgentConfigurations, 0);
});

test("model capability endpoint exposes the versioned offline catalog", async (t) => {
  const f = await fixture(t);
  const response = await fetch(`${f.server.url}/api/model-capabilities`, {
    headers: f.headers,
  });
  assert.equal(response.status, 200);
  const body = await json(response) as {
    catalogVersion: number;
    targets: Array<Record<string, unknown>>;
  };
  assert.equal(body.catalogVersion, 1);
  assert.equal(body.targets.length, 3);
  const serialized = JSON.stringify(body);
  assert.match(serialized, /gpt-5\.6-sol/);
  assert.match(serialized, /gpt-5\.6-terra/);
  assert.match(serialized, /gpt-5\.5/);
  assert.match(serialized, /claude-sonnet-4-5/);
  assert.match(serialized, /claude-opus-5/);
  assert.match(serialized, /reasoning_effort/);
  assert.match(serialized, /"effort"/);
  assert.equal(serialized.includes("model_reasoning_effort"), false);
  assert.equal(serialized.includes("claude_argument"), false);
  assert.equal(serialized.toLowerCase().includes("credential"), false);
});

test("a valid agent configuration is persisted through the domain service", async (t) => {
  const f = await fixture(t);
  const before = await json(
    await fetch(`${f.server.url}/api/status`, { headers: f.headers }),
  );

  const response = await fetch(`${f.server.url}/api/agents/coder`, {
    method: "PUT",
    headers: f.headers,
    body: JSON.stringify({
      provider: "anthropic",
      surface: "cli",
      model: "claude-sonnet-4-5",
      configVersion: before.configVersion,
    }),
  });
  assert.equal(response.status, 200);

  // Read back through the canonical manager, not the HTTP layer: the point is
  // that the write went through the real config service.
  const config = await new AgentConfigManager(
    new StateStore(f.root),
  ).getConfig("coder");
  assert.equal(config.status, "configured");
  assert.equal(
    config.status === "configured" ? config.provider : null,
    "anthropic",
  );

  // The canonical document is rendered with its maintainer comments intact.
  const document = await readFile(join(f.root, "agent_config.jsonc"), "utf8");
  assert.match(document, /^\/\//m);
});

test("a supported model setting is validated and persisted while omission stays omitted", async (t) => {
  const f = await fixture(t);
  let status = await json(await fetch(`${f.server.url}/api/status`, { headers: f.headers }));
  let response = await fetch(`${f.server.url}/api/agents/coder`, {
    method: "PUT",
    headers: f.headers,
    body: JSON.stringify({
      provider: "openai",
      surface: "cli",
      model: "gpt-5.6-sol",
      settings: { reasoning_effort: "high" },
      configVersion: status.configVersion,
    }),
  });
  assert.equal(response.status, 200);
  let config = await new AgentConfigManager(new StateStore(f.root)).getConfig("coder");
  assert.deepEqual(config.status === "configured" ? config.settings : null, {
    reasoning_effort: "high",
  });

  status = await json(await fetch(`${f.server.url}/api/status`, { headers: f.headers }));
  response = await fetch(`${f.server.url}/api/agents/reviewer`, {
    method: "PUT",
    headers: f.headers,
    body: JSON.stringify({
      provider: "openai",
      surface: "cli",
      model: "gpt-5.6-sol",
      configVersion: status.configVersion,
    }),
  });
  assert.equal(response.status, 200);
  config = await new AgentConfigManager(new StateStore(f.root)).getConfig("reviewer");
  assert.equal(config.status === "configured" && Object.hasOwn(config, "settings"), false);
});

test("Configure rejects unknown models, invalid settings, and unavailable targets", async (t) => {
  const f = await fixture(t);
  for (const body of [
    { provider: "openai", surface: "cli", model: "future-model" },
    { provider: "openai", surface: "cli", model: "gpt-5.6-sol", settings: { reasoning_effort: "maximum" } },
    { provider: "anthropic", surface: "cli", model: "claude-sonnet-4-5", settings: { reasoning_effort: "high" } },
    { provider: "google", surface: "cli", model: "legacy-google" },
    { provider: "openai", surface: "vscode", model: "legacy-vscode" },
  ]) {
    const status = await json(await fetch(`${f.server.url}/api/status`, { headers: f.headers }));
    const response = await fetch(`${f.server.url}/api/agents/coder`, {
      method: "PUT",
      headers: f.headers,
      body: JSON.stringify({ ...body, configVersion: status.configVersion }),
    });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
});

test("an unknown provider is refused by domain validation", async (t) => {
  const f = await fixture(t);
  const status = await json(
    await fetch(`${f.server.url}/api/status`, { headers: f.headers }),
  );
  const response = await fetch(`${f.server.url}/api/agents/coder`, {
    method: "PUT",
    headers: f.headers,
    body: JSON.stringify({
      provider: "not-a-provider",
      surface: "cli",
      model: "x",
      configVersion: status.configVersion,
    }),
  });
  assert.equal(response.status, 400);
});

test("a missing model is refused rather than stored empty", async (t) => {
  const f = await fixture(t);
  const status = await json(
    await fetch(`${f.server.url}/api/status`, { headers: f.headers }),
  );
  const response = await fetch(`${f.server.url}/api/agents/planner`, {
    method: "PUT",
    headers: f.headers,
    body: JSON.stringify({
      provider: "openai",
      surface: "cli",
      model: "   ",
      configVersion: status.configVersion,
    }),
  });
  assert.equal(response.status, 400);
});

test("an immutable role contract cannot be widened through the API", async (t) => {
  const f = await fixture(t);
  const status = await json(
    await fetch(`${f.server.url}/api/status`, { headers: f.headers }),
  );

  // planner -> coder and coder -> reviewer are forbidden in code. The GUI must
  // not become a way around a contract the rest of Synaphex enforces.
  for (const [caller, target] of [
    ["planner", "coder"],
    ["coder", "reviewer"],
  ]) {
    const response = await fetch(`${f.server.url}/api/rules`, {
      method: "PUT",
      headers: f.headers,
      body: JSON.stringify({
        caller,
        target,
        decision: "allow",
        scope: "global",
        configVersion: status.configVersion,
      }),
    });
    assert.equal(response.status, 400, `${caller} -> ${target}`);
    assert.equal(
      (await json(response)).error,
      "IMMUTABLE_CONTRACT_VIOLATION",
      `${caller} -> ${target}`,
    );
  }
});

test("a configurable rule is written and resolves through precedence", async (t) => {
  const f = await fixture(t);
  const status = await json(
    await fetch(`${f.server.url}/api/status`, { headers: f.headers }),
  );

  const saved = await fetch(`${f.server.url}/api/rules`, {
    method: "PUT",
    headers: f.headers,
    body: JSON.stringify({
      caller: "questioner",
      target: "researcher",
      decision: "allow",
      scope: "global",
      configVersion: status.configVersion,
    }),
  });
  assert.equal(saved.status, 200);

  const rules = await json(
    await fetch(`${f.server.url}/api/rules?scope=global`, {
      headers: f.headers,
    }),
  );
  const edges = rules.edges as {
    caller: string;
    target: string;
    decision: string;
    source: string;
  }[];
  const edge = edges.find(
    (candidate) =>
      candidate.caller === "questioner" && candidate.target === "researcher",
  );
  assert.equal(edge?.decision, "allow");
  assert.equal(edge?.source, "global");
});

test("every forbidden edge is reported as immutable, in one direction only", async (t) => {
  const f = await fixture(t);
  const rules = await json(
    await fetch(`${f.server.url}/api/rules?scope=global`, {
      headers: f.headers,
    }),
  );
  const edges = rules.edges as {
    caller: string;
    target: string;
    immutable: boolean;
  }[];
  const immutable = edges
    .filter((edge) => edge.immutable)
    .map((edge) => `${edge.caller}->${edge.target}`)
    .sort();
  assert.deepEqual(immutable, ["coder->reviewer", "planner->coder"]);

  // Direction matters: the reverse edges are ordinary configurable rules.
  const reverse = edges.find(
    (edge) => edge.caller === "reviewer" && edge.target === "coder",
  );
  assert.equal(reverse?.immutable, false);
});

test("a stale write is refused instead of clobbering a newer change", async (t) => {
  const f = await fixture(t);
  const status = await json(
    await fetch(`${f.server.url}/api/status`, { headers: f.headers }),
  );
  const staleVersion = status.configVersion as string;

  // Another writer changes configuration after this page loaded.
  await new AgentConfigManager(new StateStore(f.root)).setConfigured(
    "researcher",
    { provider: "openai", surface: "cli", model: "gpt-5.6-sol" },
  );

  const response = await fetch(`${f.server.url}/api/agents/coder`, {
    method: "PUT",
    headers: f.headers,
    body: JSON.stringify({
      provider: "anthropic",
      surface: "cli",
      model: "claude-sonnet-4-5",
      configVersion: staleVersion,
    }),
  });
  assert.equal(response.status, 409);
  assert.equal((await json(response)).error, "CONFIGURE_STALE_WRITE");

  // The other writer's change survived.
  const config = await new AgentConfigManager(
    new StateStore(f.root),
  ).getConfig("researcher");
  assert.equal(config.status, "configured");
});

test("clearing an agent returns it to unconfigured", async (t) => {
  const f = await fixture(t);
  const first = await json(
    await fetch(`${f.server.url}/api/status`, { headers: f.headers }),
  );
  await fetch(`${f.server.url}/api/agents/reviewer`, {
    method: "PUT",
    headers: f.headers,
    body: JSON.stringify({
      provider: "openai",
      surface: "cli",
      model: "gpt-5.6-sol",
      configVersion: first.configVersion,
    }),
  });

  const second = await json(
    await fetch(`${f.server.url}/api/status`, { headers: f.headers }),
  );
  const cleared = await fetch(`${f.server.url}/api/agents/reviewer`, {
    method: "DELETE",
    headers: f.headers,
    body: JSON.stringify({ configVersion: second.configVersion }),
  });
  assert.equal(cleared.status, 200);

  const config = await new AgentConfigManager(
    new StateStore(f.root),
  ).getConfig("reviewer");
  assert.equal(config.status, "unconfigured");
});

test("google is reported as a host but never as an executable target", async (t) => {
  const f = await fixture(t);
  const diagnostics = await json(
    await fetch(`${f.server.url}/api/diagnostics`, { headers: f.headers }),
  );
  const providers = diagnostics.providers as {
    provider: string;
    hostIntegration: { support: string };
    executionTargets: { support: string }[];
  }[];
  const google = providers.find((entry) => entry.provider === "google");
  assert.equal(google?.hostIntegration.support, "supported");
  // Antigravity has no invocation-scoped policy, so the GUI must not present
  // it as ready to run agents.
  assert.equal(google?.executionTargets[0]?.support, "unavailable");
});

test("the configure surface exposes no filesystem, shell or invocation route", async (t) => {
  const f = await fixture(t);
  for (const path of [
    "/api/files",
    "/api/exec",
    "/api/invoke",
    "/api/agents/coder/run",
    "/api/env",
  ]) {
    const response = await fetch(`${f.server.url}${path}`, {
      headers: f.headers,
    });
    assert.equal(response.status, 404, path);
  }
});

test("configure accepts only --no-open and reports anything else", () => {
  assert.deepEqual(parseConfigureArgs([]), { open: true });
  assert.deepEqual(parseConfigureArgs(["--no-open"]), { open: false });
  const bad = parseConfigureArgs(["--danger"]);
  assert.ok("error" in bad);
});

test("the server stops cleanly and frees its port", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "synaphex-configure-stop-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const server = await startConfigureServer({
    synaphexRoot: join(home, ".synaphex"),
    homeDirectory: home,
  });
  const url = server.url;
  await server.close();
  await assert.rejects(fetch(`${url}/api/status`));
});
