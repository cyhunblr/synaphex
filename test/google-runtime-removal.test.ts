import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("Google production and package surfaces contain no Gemini CLI runtime", async () => {
  const productionRoot = join(process.cwd(), "src");
  const productionFiles = await filesUnder(productionRoot);
  const production = (
    await Promise.all(productionFiles.map((path) => readFile(path, "utf8")))
  ).join("\n");
  const packageJson = await readFile(join(process.cwd(), "package.json"), "utf8");

  for (const forbidden of [
    "GeminiCliAgentExecutor",
    "GeminiCliRuntimeAvailability",
    "GEMINI_CLI_EXECUTION_FAILED",
    "SYNAPHEX_GEMINI_",
    "gemini-cli",
  ]) {
    assert.equal(production.includes(forbidden), false, forbidden);
    assert.equal(packageJson.includes(forbidden), false, forbidden);
  }
  assert.equal(/executable\s*[:=]\s*["']gemini["']/.test(production), false);
});

test("Google agent configuration remains provider/surface/model without runtime identity", async () => {
  const configSource = await readFile(
    join(process.cwd(), "src", "domain", "agent-config.ts"),
    "utf8",
  );
  assert.match(configSource, /"openai", "anthropic", "google"/);
  assert.doesNotMatch(configSource, /readonly runtime\??:/);
});

async function filesUnder(directory: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await filesUnder(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      paths.push(path);
    }
  }
  return paths;
}
