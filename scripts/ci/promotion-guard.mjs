#!/usr/bin/env node

const PROMOTION_SOURCES = Object.freeze({
  test: "dev",
  main: "test",
});

export function evaluatePromotion({ head, base }) {
  const expected = PROMOTION_SOURCES[base];
  if (expected === undefined) {
    return { allowed: true, head, base, expected: null };
  }
  return { allowed: head === expected, head, base, expected };
}

export function formatPromotionResult(result) {
  if (result.expected === null) {
    return `promotion guard: base=${result.base} is unrestricted; head=${result.head} allowed`;
  }
  const outcome = result.allowed ? "allowed" : "rejected";
  return `promotion ${outcome}: head=${result.head} base=${result.base} expected=${result.expected}`;
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const head = arg("--head") ?? process.env.GITHUB_HEAD_REF;
  const base = arg("--base") ?? process.env.GITHUB_BASE_REF;
  if (head === undefined || base === undefined || head.length === 0 || base.length === 0) {
    process.stderr.write("usage: promotion-guard --head <branch> --base <branch>\n");
    process.exit(2);
  }
  const result = evaluatePromotion({ head, base });
  const message = `${formatPromotionResult(result)}\n`;
  (result.allowed ? process.stdout : process.stderr).write(message);
  process.exit(result.allowed ? 0 : 1);
}

if (process.argv[1]?.endsWith("promotion-guard.mjs")) {
  main();
}
