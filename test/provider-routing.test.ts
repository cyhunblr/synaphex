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
  InvalidProviderRouteError,
  ProviderCliUnavailableError,
} from "../src/domain/errors.js";
import type {
  HostRuntime,
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

function host(
  provider: AgentProvider,
  surface: AgentSurface,
): HostRuntime {
  return { provider, surface };
}

test("same-provider routing follows the complete provider and surface matrix", async () => {
  for (const provider of AGENT_PROVIDERS) {
    const nativeAvailability = new FakeRuntimeAvailability(false);
    const native = await new ProviderRouter(nativeAvailability).resolve({
      host: host(provider, "vscode"),
      targetConfig: targetConfig(provider, "vscode"),
    });
    assert.equal(native.effectiveSurface, "vscode");
    assert.equal(native.routingReason, "same_provider_native");
    assert.equal(native.cliForcedByCrossProvider, false);
    assert.deepEqual(nativeAvailability.checks, []);

    const vscodeToCliAvailability = new FakeRuntimeAvailability(true);
    const vscodeToCli = await new ProviderRouter(
      vscodeToCliAvailability,
    ).resolve({
      host: host(provider, "vscode"),
      targetConfig: targetConfig(provider, "cli"),
    });
    assert.equal(vscodeToCli.effectiveSurface, "cli");
    assert.equal(
      vscodeToCli.routingReason,
      "same_provider_configured_cli",
    );
    assert.deepEqual(vscodeToCliAvailability.checks, [
      { provider, surface: "cli" },
    ]);

    const cliAvailability = new FakeRuntimeAvailability(true);
    const cli = await new ProviderRouter(cliAvailability).resolve({
      host: host(provider, "cli"),
      targetConfig: targetConfig(provider, "cli"),
    });
    assert.equal(cli.effectiveSurface, "cli");
    assert.equal(cli.routingReason, "same_provider_configured_cli");
    assert.deepEqual(cliAvailability.checks, [{ provider, surface: "cli" }]);

    const invalidAvailability = new FakeRuntimeAvailability(true);
    await assert.rejects(
      new ProviderRouter(invalidAvailability).resolve({
        host: host(provider, "cli"),
        targetConfig: targetConfig(provider, "vscode"),
      }),
      (error: unknown) =>
        error instanceof InvalidProviderRouteError &&
        error.code === "INVALID_PROVIDER_ROUTE" &&
        error.details?.hostProvider === provider &&
        error.details.hostSurface === "cli" &&
        error.details.provider === provider &&
        error.details.configuredSurface === "vscode" &&
        error.details.effectiveSurface === "vscode",
    );
    assert.deepEqual(invalidAvailability.checks, []);
  }
});

test("cross-provider routing generically forces the target provider CLI", async () => {
  for (const hostProvider of AGENT_PROVIDERS) {
    for (const provider of AGENT_PROVIDERS) {
      if (hostProvider === provider) {
        continue;
      }
      for (const hostSurface of AGENT_SURFACES) {
        for (const configuredSurface of AGENT_SURFACES) {
          const availability = new FakeRuntimeAvailability(true);
          const route = await new ProviderRouter(availability).resolve({
            host: host(hostProvider, hostSurface),
            targetConfig: targetConfig(provider, configuredSurface),
          });

          assert.equal(route.provider, provider);
          assert.equal(route.configuredSurface, configuredSurface);
          assert.equal(route.effectiveSurface, "cli");
          assert.equal(route.routingReason, "cross_provider_cli");
          assert.equal(
            route.cliForcedByCrossProvider,
            configuredSurface === "vscode",
          );
          assert.deepEqual(availability.checks, [
            { provider, surface: "cli" },
          ]);
        }
      }
    }
  }
});

test("cross-provider forced CLI unavailability returns the stable CLI error", async () => {
  const availability = new FakeRuntimeAvailability(false);

  await assert.rejects(
    new ProviderRouter(availability).resolve({
      host: host("anthropic", "vscode"),
      targetConfig: targetConfig("openai", "vscode"),
    }),
    (error: unknown) =>
      error instanceof ProviderCliUnavailableError &&
      error.code === "PROVIDER_CLI_UNAVAILABLE" &&
      error.details?.hostProvider === "anthropic" &&
      error.details.hostSurface === "vscode" &&
      error.details.provider === "openai" &&
      error.details.configuredSurface === "vscode" &&
      error.details.effectiveSurface === "cli",
  );
  assert.deepEqual(availability.checks, [
    { provider: "openai", surface: "cli" },
  ]);
});

test("same-provider configured CLI unavailability returns the stable CLI error", async () => {
  const availability = new FakeRuntimeAvailability(false);

  await assert.rejects(
    new ProviderRouter(availability).resolve({
      host: host("google", "vscode"),
      targetConfig: targetConfig("google", "cli"),
    }),
    (error: unknown) =>
      error instanceof ProviderCliUnavailableError &&
      error.code === "PROVIDER_CLI_UNAVAILABLE" &&
      error.details?.provider === "google" &&
      error.details.configuredSurface === "cli",
  );
});

test("same-provider active VS Code route needs no availability lookup", async () => {
  const availability = new FakeRuntimeAvailability(false);

  const route = await new ProviderRouter(availability).resolve({
    host: host("google", "vscode"),
    targetConfig: targetConfig("google", "vscode"),
  });

  assert.equal(route.effectiveSurface, "vscode");
  assert.deepEqual(availability.checks, []);
});

test("an available effective runtime resolves successfully", async () => {
  const availability = new FakeRuntimeAvailability(true);

  const route = await new ProviderRouter(availability).resolve({
    host: host("openai", "cli"),
    targetConfig: targetConfig("anthropic", "vscode"),
  });

  assert.equal(route.provider, "anthropic");
  assert.equal(route.effectiveSurface, "cli");
});

test("route preserves configured surface, model, and settings without mutation", async () => {
  const settings = Object.freeze({});
  const config: ValidatedAgentConfig = Object.freeze({
    agent: "researcher",
    status: "configured",
    provider: "openai",
    surface: "vscode",
    model: "exact-model-name",
    settings,
  });

  const route = await new ProviderRouter(
    new FakeRuntimeAvailability(true),
  ).resolve({
    host: host("anthropic", "cli"),
    targetConfig: config,
  });

  assert.equal(route.configuredSurface, "vscode");
  assert.equal(route.effectiveSurface, "cli");
  assert.equal(route.model, "exact-model-name");
  assert.equal(route.settings, settings);
  assert.deepEqual(config, {
    agent: "researcher",
    status: "configured",
    provider: "openai",
    surface: "vscode",
    model: "exact-model-name",
    settings: {},
  });
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

  await new ProviderRouter(new FakeRuntimeAvailability(true)).resolve({
    host: host("openai", "vscode"),
    targetConfig: validated,
  });

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
