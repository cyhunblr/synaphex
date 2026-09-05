import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  SUPPORTED_INSTALLATION_TARGETS,
  launcherArgsFor,
  type InstallationTarget,
} from "../src/domain/installation.js";
import { SynaphexLauncherResolver } from "../src/installer/synaphex-launcher-resolver.js";

const BUILT_ENTRYPOINT = join(process.cwd(), "dist", "mcp", "stdio-main.js");

async function temporaryHome(t: TestContext): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "synaphex-launcher-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

/**
 * Starts the BUILT server exactly as a provider host would, from `cwd`, and
 * returns the tool names it advertises.
 *
 * This is the proof that installation registers an actually executable
 * command rather than a syntactically plausible dead path.
 */
async function toolsFromRegisteredLauncher(
  t: TestContext,
  target: InstallationTarget,
  cwd: string,
): Promise<readonly string[]> {
  const home = await temporaryHome(t);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [...launcherArgsFor(BUILT_ENTRYPOINT, target)],
    cwd,
    // A deliberately minimal environment: no NODE_PATH, no developer tooling,
    // nothing inherited from the source checkout.
    env: { PATH: "/usr/bin:/bin", HOME: home },
    stderr: "pipe",
  });
  const client = new Client({ name: "launcher-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    return (await client.listTools()).tools.map((tool) => tool.name);
  } finally {
    await client.close();
  }
}

test("the resolved launcher pins an absolute interpreter and entrypoint", async () => {
  const launcher = await new SynaphexLauncherResolver({
    // Pretend to be the installed dist/installer module.
    moduleUrl: new URL(
      `file://${join(process.cwd(), "dist", "installer", "resolver.js")}`,
    ).href,
  }).resolve();

  assert.equal(launcher.command, process.execPath);
  assert.equal(launcher.command.startsWith("/"), true);
  assert.equal(launcher.args[0], BUILT_ENTRYPOINT);
  // Never the npm bin shim: its `#!/usr/bin/env node` would resolve whatever
  // node happens to be first on a GUI host's PATH.
  assert.equal(launcher.args[0]!.endsWith("synaphex-mcp-stdio"), false);
  // Never a path inside the source tree's build scratch or node_modules.
  assert.equal(launcher.args[0]!.includes("node_modules"), false);
  assert.equal(launcher.args[0]!.includes(".test-dist"), false);
});

test("a missing entrypoint fails closed rather than registering a dead path", async () => {
  await assert.rejects(
    () =>
      new SynaphexLauncherResolver({
        moduleUrl: new URL("file:///nonexistent/dist/installer/x.js").href,
      }).resolve(),
    (error: unknown) => {
      assert.equal((error as { code: string }).code, "SYNAPHEX_LAUNCHER_NOT_FOUND");
      return true;
    },
  );
});

test("the registered launcher starts and serves 31 tools from an unrelated cwd", async (t) => {
  const unrelated = await mkdtemp(join(tmpdir(), "synaphex-unrelated-"));
  t.after(() => rm(unrelated, { recursive: true, force: true }));

  // Provider hosts start MCP servers from arbitrary directories.
  for (const cwd of ["/", tmpdir(), unrelated]) {
    const tools = await toolsFromRegisteredLauncher(
      t,
      { provider: "openai" },
      cwd,
    );
    assert.equal(tools.length, 31, `tool count from cwd ${cwd}`);
    assert.equal(tools.includes("synaphex_get_project"), true);
  }
});

test("every supported host registration produces a working server", async (t) => {
  for (const target of SUPPORTED_INSTALLATION_TARGETS) {
    const tools = await toolsFromRegisteredLauncher(t, target, "/");
    assert.equal(
      tools.length,
      31,
      `${target.provider} did not serve the full tool surface`,
    );
  }
});
