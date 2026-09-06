import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConfigureReadModels } from "../src/configure/configure-read-models.js";
import { StateStore } from "../src/infrastructure/state-store.js";
import { InstallationManifestStore } from "../src/installer/installation-manifest.js";

test("configure diagnostics project complete system and provider state", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "synaphex-diagnostics-read-model-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = join(home, ".synaphex");

  await new InstallationManifestStore(new StateStore(root)).record([
    manifestEntry("openai"),
    manifestEntry("google"),
  ]);

  const diagnostics = await new ConfigureReadModels({
    synaphexRoot: root,
    homeDirectory: home,
    runtimeProbes: {
      codex: {
        probe: async () => ({ available: true, version: "0.153.0" }),
      },
      claude: {
        probe: async () => ({ available: true, version: "2.1.260" }),
      },
      antigravity: {
        probe: async () => ({ available: true, version: "1.1.27" }),
      },
    },
  }).diagnostics();

  assert.equal(diagnostics.nodeVersion, process.version);
  assert.equal(diagnostics.platform, process.platform);
  assert.deepEqual(
    diagnostics.providers.map((entry) => ({
      provider: entry.provider,
      version: entry.runtime.version,
      registration: entry.hostIntegration.registration.state,
      hostSupport: entry.hostIntegration.support,
      targetSupport: entry.executionTargets[0]?.support,
      targetReadiness: entry.executionTargets[0]?.targetRuntimeReadiness,
    })),
    [
      {
        provider: "openai",
        version: "0.153.0",
        registration: "recorded",
        hostSupport: "supported",
        targetSupport: "supported",
        targetReadiness: "ready",
      },
      {
        provider: "anthropic",
        version: "2.1.260",
        registration: "not_recorded",
        hostSupport: "supported",
        targetSupport: "supported",
        targetReadiness: "ready",
      },
      {
        provider: "google",
        version: "1.1.27",
        registration: "recorded",
        hostSupport: "supported",
        targetSupport: "unavailable",
        targetReadiness: "unavailable",
      },
    ],
  );
});

test("configure projects the canonical target/model catalog without executor internals", () => {
  const catalog = new ConfigureReadModels().modelCapabilities();
  assert.equal(catalog.catalogVersion, 1);
  const openai = catalog.targets.find(
    (target) => target.provider === "openai" && target.persistedSurface === "cli",
  )!;
  assert.equal(openai.id, "codex_cli");
  assert.equal(openai.support, "supported");
  assert.deepEqual(openai.models.map((model) => model.id), [
    "gpt-5.6-sol",
    "gpt-6-astra",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
  ]);
  assert.equal(openai.models[0]?.supportTier, "recommended");
  assert.deepEqual(openai.models[0]!.settings[0], {
    key: "reasoning_effort",
    label: "Reasoning effort",
    description: "Controls how much reasoning effort Codex applies.",
    scope: "model",
    type: "enum",
    values: ["low", "medium", "high", "xhigh"].map((value) => ({ value, label: value })),
    required: false,
    omission: "provider_native",
  });
  assert.equal("executorBinding" in openai.models[0]!.settings[0]!, false);
  assert.equal(catalog.targets.some((target) => target.label.includes("VS Code")), false);
});

test("target readiness is independent from the host registration record", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "synaphex-registration-independent-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const diagnostics = await new ConfigureReadModels({
    synaphexRoot: join(home, ".synaphex"),
    homeDirectory: home,
    runtimeProbes: {
      codex: { probe: async () => ({ available: true, version: "0.153.0" }) },
      claude: { probe: async () => ({ available: false, reason: "executable_missing" }) },
      antigravity: { probe: async () => ({ available: false, reason: "executable_missing" }) },
    },
  }).diagnostics();
  const openai = diagnostics.providers.find((entry) => entry.provider === "openai")!;
  assert.equal(openai.hostIntegration.registration.state, "not_recorded");
  assert.equal(openai.executionTargets[0]?.support, "supported");
  assert.equal(openai.executionTargets[0]?.targetRuntimeReadiness, "ready");
});

function manifestEntry(provider: "openai" | "google") {
  return {
    provider,
    registrationName: "synaphex",
    launcherCommand: "/usr/bin/node",
    launcherArgs: ["/installed/synaphex-mcp.js"],
    configuredAt: "2026-09-06T00:00:00.000Z",
  } as const;
}
