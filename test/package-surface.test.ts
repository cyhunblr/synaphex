import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

const REPO = process.cwd();

// ---------------------------------------------------------------------------
// Published package API contract
// ---------------------------------------------------------------------------

test("the package advertises no Node library entrypoint", async () => {
  const packageJson = JSON.parse(await readFile(join(REPO, "package.json"), "utf8"));
  // Synaphex v0.1 is a CLI/MCP application, not a supported Node SDK. Shipping
  // `main`/`types` would present ~200 internal symbols as a stable import
  // contract that nothing intends to support.
  assert.equal(packageJson.main, undefined);
  assert.equal(packageJson.types, undefined);
  assert.deepEqual(packageJson.exports, {});
  // The runtime product is unaffected.
  assert.deepEqual(Object.keys(packageJson.bin).sort(), [
    "synaphex",
    "synaphex-mcp-stdio",
  ]);
});

/**
 * Installs the packed tarball into an isolated prefix and asks a SEPARATE
 * consumer package what it can import. This is the only honest way to test a
 * published contract: internal relative imports prove nothing about it.
 */
test("an external consumer cannot import the package root or deep paths", async (t: TestContext) => {
  const workspace = await mkdtemp(join(tmpdir(), "synaphex-surface-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const pack = spawnSync("npm", ["pack", "--silent", "--pack-destination", workspace], {
    cwd: REPO,
    encoding: "utf8",
    timeout: 300_000,
  });
  assert.equal(pack.status, 0, pack.stderr);
  const tarball = join(workspace, (pack.stdout ?? "").trim().split("\n").pop() ?? "");

  const consumer = join(workspace, "consumer");
  await mkdir(consumer, { recursive: true });
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({ name: "consumer", version: "1.0.0", type: "module" }),
  );
  const install = spawnSync("npm", ["install", "--silent", "--no-audit", "--no-fund", tarball], {
    cwd: consumer,
    encoding: "utf8",
    timeout: 300_000,
    env: { ...process.env, npm_config_fund: "false" },
  });
  assert.equal(install.status, 0, install.stderr);

  const probe = (specifier: string) =>
    spawnSync(
      process.execPath,
      [
        "-e",
        `import(${JSON.stringify(specifier)}).then(()=>console.log("IMPORTED")).catch((e)=>console.log(e.code))`,
      ],
      { cwd: consumer, encoding: "utf8", timeout: 60_000 },
    ).stdout.trim();

  // Root import: not a supported API.
  assert.equal(probe("synaphex"), "ERR_PACKAGE_PATH_NOT_EXPORTED");
  // Deep imports must not become an accidental supported API either.
  for (const deep of [
    "synaphex/dist/index.js",
    "synaphex/dist/core/agent-invocation-service.js",
    "synaphex/dist/infrastructure/recoverable-process-lock.js",
  ]) {
    assert.equal(
      probe(deep),
      "ERR_PACKAGE_PATH_NOT_EXPORTED",
      `${deep} must not be importable`,
    );
  }

  // The bins remain fully functional: closing the API surface must not break
  // the product, whose internal modules load by relative path.
  const mcp = spawnSync(
    join(consumer, "node_modules", ".bin", "synaphex-mcp-stdio"),
    ["--host-provider", "openai"],
    { cwd: workspace, encoding: "utf8", timeout: 30_000, input: "" },
  );
  assert.match(`${mcp.stdout}${mcp.stderr}`, /host provider: openai/);

  const cli = spawnSync(join(consumer, "node_modules", ".bin", "synaphex"), ["install"], {
    cwd: workspace,
    encoding: "utf8",
    timeout: 60_000,
    input: "n\nn\nn\n",
    env: { ...process.env, HOME: workspace },
  });
  assert.match(cli.stdout, /Configure Google\?/);
});
