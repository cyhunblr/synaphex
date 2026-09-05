import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { AgentConfigManager } from "../src/core/agent-config-manager.js";
import { ProviderRouter } from "../src/core/provider-router.js";
import {
  AGENT_PROVIDERS,
  AGENT_SURFACES,
  type AgentProvider,
  type AgentSurface,
  type ValidatedAgentConfig,
} from "../src/domain/agent-config.js";
import {
  AgentTargetSurfaceUnsupportedError,
  ProviderCliUnavailableError,
} from "../src/domain/errors.js";
import type {
  McpHostContext,
  RuntimeAvailability,
} from "../src/domain/provider-routing.js";
import { StateStore } from "../src/infrastructure/state-store.js";

interface AvailabilityCheck {
  readonly provider: AgentProvider;
  readonly surface: AgentSurface;
}

class FakeRuntimeAvailability implements RuntimeAvailability {
  readonly checks: AvailabilityCheck[] = [];

  constructor(private readonly availableByDefault: boolean) {}

  async isAvailable(
    provider: AgentProvider,
    surface: AgentSurface,
  ): Promise<boolean> {
    this.checks.push({ provider, surface });
    return this.availableByDefault;
  }
}

function targetConfig(
  provider: AgentProvider,
  surface: AgentSurface,
): ValidatedAgentConfig {
  return {
    agent: "coder",
    status: "configured",
    provider,
    surface,
    model: `${provider}-model`,
  };
}

function host(provider: AgentProvider): McpHostContext {
  return { provider };
}

test("every host provider reaches every provider's CLI target", async () => {
  // Host identity contributes only a provider. Same provider means its own
  // CLI; a different provider means that provider's CLI. There is no third
  // outcome, and no UI surface participates.
  for (const hostProvider of AGENT_PROVIDERS) {
    for (const targetProvider of AGENT_PROVIDERS) {
      const availability = new FakeRuntimeAvailability(true);
      const route = await new ProviderRouter(availability).resolve({
        host: host(hostProvider),
        targetConfig: targetConfig(targetProvider, "cli"),
      });
      assert.equal(route.provider, targetProvider);
      assert.equal(route.effectiveSurface, "cli");
      assert.equal(
        route.routingReason,
        hostProvider === targetProvider
          ? "same_provider_configured_cli"
          : "cross_provider_cli",
      );
      // Availability is always checked against the CLI runtime that will run.
      assert.deepEqual(availability.checks, [
        { provider: targetProvider, surface: "cli" },
      ]);
    }
  }
});

test("a VS Code target is refused for every host, with no silent downgrade", async () => {
  // The previous model rewrote a cross-provider `vscode` target to `cli` and
  // executed it -- running something the user never configured. It must now
  // fail deterministically, before any availability lookup or provider call.
  for (const hostProvider of AGENT_PROVIDERS) {
    for (const targetProvider of AGENT_PROVIDERS) {
      const availability = new FakeRuntimeAvailability(true);
      await assert.rejects(
        new ProviderRouter(availability).resolve({
          host: host(hostProvider),
          targetConfig: targetConfig(targetProvider, "vscode"),
        }),
        (error: unknown) => {
          assert.ok(error instanceof AgentTargetSurfaceUnsupportedError);
          assert.equal(
            (error as { code: string }).code,
            "AGENT_TARGET_SURFACE_UNSUPPORTED",
          );
          return true;
        },
        `${hostProvider} host must refuse ${targetProvider}/vscode`,
      );
      // Refused before the runtime was even probed.
      assert.deepEqual(availability.checks, []);
    }
  }
});

test("no reachable route reports a native host execution surface", async () => {
  for (const hostProvider of AGENT_PROVIDERS) {
    for (const targetProvider of AGENT_PROVIDERS) {
      const route = await new ProviderRouter(
        new FakeRuntimeAvailability(true),
      ).resolve({
        host: host(hostProvider),
        targetConfig: targetConfig(targetProvider, "cli"),
      });
      // `same_provider_native` required a VS Code HOST surface, which is no
      // longer expressible; it was removed rather than left unreachable.
      assert.notEqual(route.routingReason as string, "same_provider_native");
      assert.equal(route.cliForcedByCrossProvider, false);
    }
  }
});

test("an unavailable CLI runtime returns the stable provider error", async () => {
  for (const hostProvider of AGENT_PROVIDERS) {
    await assert.rejects(
      new ProviderRouter(new FakeRuntimeAvailability(false)).resolve({
        host: host(hostProvider),
        targetConfig: targetConfig("openai", "cli"),
      }),
      ProviderCliUnavailableError,
    );
  }
});

test("route preserves configured provider, model and settings without mutation", async () => {
  const settings = Object.freeze({ reasoning: "high" });
  const config: ValidatedAgentConfig = {
    ...targetConfig("openai", "cli"),
    settings,
  };
  const route = await new ProviderRouter(new FakeRuntimeAvailability(true)).resolve({
    host: host("anthropic"),
    targetConfig: config,
  });
  assert.equal(route.model, "openai-model");
  assert.equal(route.configuredSurface, "cli");
  assert.deepEqual(route.settings, settings);
  // The host is copied, never aliased, and carries provider identity only.
  assert.deepEqual(route.host, { provider: "anthropic" });
  assert.equal(Object.hasOwn(route.host, "surface"), false);
});

test("routing neither mutates persisted AgentConfig nor writes Synaphex state", async (t: TestContext) => {
  const root = await mkdtemp(join(tmpdir(), "synaphex-provider-route-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new StateStore(root);
  const configs = new AgentConfigManager(store);
  await configs.setConfigured("coder", {
    provider: "google",
    surface: "vscode",
    model: "gemini-example",
  });
  const validated = await configs.validateAgent("coder");
  const beforeFiles = await readdir(root);
  const beforeConfig = await readFile(join(root, "agent_config.jsonc"), "utf8");

  // Even a REFUSED route must leave persisted configuration untouched:
  // Synaphex never rewrites a user's configured surface to make it runnable.
  await assert.rejects(
    new ProviderRouter(new FakeRuntimeAvailability(true)).resolve({
      host: host("openai"),
      targetConfig: validated,
    }),
    AgentTargetSurfaceUnsupportedError,
  );

  assert.deepEqual(await readdir(root), beforeFiles);
  assert.equal(
    await readFile(join(root, "agent_config.jsonc"), "utf8"),
    beforeConfig,
  );
  assert.deepEqual(await configs.getConfig("coder"), {
    status: "configured",
    provider: "google",
    surface: "vscode",
    model: "gemini-example",
  });
});

// ---------------------------------------------------------------------------
// Shared-registration truthfulness (the Phase-8A blocker)
// ---------------------------------------------------------------------------

test("the same registration is truthful whichever UI launched it", async () => {
  // A provider's CLI and its VS Code extension load the SAME MCP registration
  // -- verified directly against both installed extensions. Under the old
  // model that registration asserted `--host-surface cli`, so a VS Code launch
  // made the server assert something false. Host identity is now provider-only,
  // so one registration is correct from either launch origin.
  const { parseHostContextArguments } = await import(
    "../src/mcp/mcp-host-context.js"
  );
  for (const provider of AGENT_PROVIDERS) {
    const host = parseHostContextArguments(["--host-provider", provider]);
    assert.deepEqual(host, { provider });
    // There is no field in which a UI origin could be recorded at all.
    assert.deepEqual(Object.keys(host), ["provider"]);
  }
});

test("a surface assertion is refused rather than ignored", async () => {
  // Silently ignoring it would let a stale registration keep implying a
  // surface Synaphex no longer honours.
  const { parseHostContextArguments } = await import(
    "../src/mcp/mcp-host-context.js"
  );
  for (const surface of ["cli", "vscode", "emacs"]) {
    assert.throws(
      () =>
        parseHostContextArguments(["--host-provider", "openai", "--host-surface", surface]),
      /no longer supported/,
      `--host-surface ${surface} must be refused`,
    );
  }
  assert.throws(() => parseHostContextArguments([]), /required/);
  assert.throws(
    () => parseHostContextArguments(["--host-provider", "acme"]),
    /must be one of/,
  );
});

test("no reachable input can express a host UI surface", async () => {
  const { readFile } = await import("node:fs/promises");
  const code = (
    await readFile(join(process.cwd(), "src/core/provider-router.ts"), "utf8")
  )
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/\/\/.*$/gm, "");
  // The router must never read a host surface again.
  assert.equal(code.includes("host.surface"), false);
  assert.equal(code.includes("same_provider_native"), false);
});
