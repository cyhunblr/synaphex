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
      version: entry.version,
      registered: entry.registered,
      supportedAsHost: entry.supportedAsHost,
      supportedAsTarget: entry.supportedAsTarget,
    })),
    [
      {
        provider: "openai",
        version: "0.153.0",
        registered: true,
        supportedAsHost: true,
        supportedAsTarget: true,
      },
      {
        provider: "anthropic",
        version: "2.1.260",
        registered: false,
        supportedAsHost: true,
        supportedAsTarget: true,
      },
      {
        provider: "google",
        version: "1.1.27",
        registered: true,
        supportedAsHost: true,
        supportedAsTarget: false,
      },
    ],
  );
});

test("configure projects the canonical model catalog without executor internals", () => {
  const catalog = new ConfigureReadModels().modelCapabilities();
  const openai = catalog.targets.find(
    (target) => target.provider === "openai" && target.surface === "cli",
  )!;
  assert.equal(openai.executionAvailability, "available");
  assert.deepEqual(openai.models.map((model) => model.id), ["gpt-5.6-sol"]);
  assert.deepEqual(openai.models[0]!.settings[0], {
    key: "reasoning_effort",
    label: "Reasoning effort",
    description: "Controls how much reasoning effort Codex applies.",
    type: "enum",
    values: ["low", "medium", "high", "xhigh"].map((value) => ({ value, label: value })),
    required: false,
    defaultBehavior: "provider_native",
  });
  assert.equal("execution" in openai.models[0]!.settings[0]!, false);
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
