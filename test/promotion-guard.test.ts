import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const REPO = process.cwd();
const guardModule = pathToFileURL(
  join(REPO, "scripts/ci/promotion-guard.mjs"),
).href;

test("promotion topology permits only dev to test and test to main", async () => {
  const { evaluatePromotion } = await import(guardModule);
  for (const [head, base, allowed] of [
    ["dev", "test", true],
    ["test", "main", true],
    ["feature/topic", "test", false],
    ["feature/topic", "main", false],
    ["dev", "main", false],
    ["main", "test", false],
    ["feature/topic", "dev", true],
  ] as const) {
    assert.equal(evaluatePromotion({ head, base }).allowed, allowed, `${head} -> ${base}`);
  }
});

test("promotion failure explains head, base, and expected source", async () => {
  const { evaluatePromotion, formatPromotionResult } = await import(guardModule);
  const message = formatPromotionResult(
    evaluatePromotion({ head: "feature/topic", base: "test" }),
  );
  assert.match(message, /head=feature\/topic/);
  assert.match(message, /base=test/);
  assert.match(message, /expected=dev/);
});

test("promotion workflow exposes one stable read-only check", async () => {
  const workflow = await readFile(
    join(REPO, ".github/workflows/promotion-guard.yml"),
    "utf8",
  );
  assert.match(workflow, /pull_request:\s*\n\s*branches: \[test, main\]/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /promotion-guard:\s*\n\s*name: promotion-guard/);
  assert.equal(workflow.includes("contents: write"), false);
});
