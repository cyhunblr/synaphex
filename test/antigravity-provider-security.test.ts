import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ProviderExecutionPolicyUnsupportedError } from "../src/domain/errors.js";
import type {
  ExecutionPolicy,
  SourceModificationPolicy,
} from "../src/domain/execution-policy.js";
import {
  ANTIGRAVITY_FIXED_PRINT_INSTRUCTION,
  buildAntigravityArgs,
} from "../src/providers/antigravity-cli-agent-executor.js";
import { resolveAntigravityExecutionPolicy } from "../src/providers/antigravity-execution-policy-resolver.js";

// Security invariants for the Antigravity provider, derived from an audit of the
// installed runtime (`agy 1.1.26`). See docs/architecture/0001-google-cli-runtime.md.

const ALL_POLICIES: readonly ExecutionPolicy[] = Object.freeze(
  (["read_only", "workspace_write"] satisfies SourceModificationPolicy[]).flatMap(
    (sourceModification) =>
      (
        [
          ["deny", false],
          ["ask", false],
          ["ask", true],
          ["allow", false],
          ["allow", true],
        ] as const
      ).map(([decision, approvedForInvocation]) => ({
        sourceModification,
        providerCapabilities: {
          network: {
            decision,
            source: decision === "deny" ? ("default_deny" as const) : ("task" as const),
            approvedForInvocation,
          },
        },
      })),
  ),
);

test("no Antigravity execution policy is currently accepted", () => {
  assert.equal(ALL_POLICIES.length, 10);
  for (const policy of ALL_POLICIES) {
    assert.throws(
      () => resolveAntigravityExecutionPolicy(policy),
      ProviderExecutionPolicyUnsupportedError,
      `${policy.sourceModification} + network ${policy.providerCapabilities.network.decision} must fail closed`,
    );
  }
});

test("Antigravity never emits a permission-bypass or state-carrying flag", () => {
  // `--dangerously-skip-permissions` auto-approves every tool permission, and
  // the continuation flags would inherit prior conversation state. Both are
  // forbidden regardless of mode.
  for (const mode of ["plan", "accept-edits"] as const) {
    const args = buildAntigravityArgs({
      model: "m",
      mode,
      schema: "{}",
      timeoutMs: 1_000,
    });
    for (const forbidden of [
      "--dangerously-skip-permissions",
      "--continue",
      "-c",
      "--conversation",
      "--prompt-interactive",
      "-i",
    ]) {
      assert.equal(args.includes(forbidden), false, `${forbidden} must never be emitted`);
    }
    // The sandbox is mandatory and never conditional on the policy.
    assert.ok(args.includes("--sandbox"), "--sandbox is mandatory");
    // Only the fixed instruction is passed as an argument; the real context
    // travels over stdin.
    assert.equal(args[0], "-p");
    assert.equal(args[1], ANTIGRAVITY_FIXED_PRINT_INSTRUCTION);
  }
});

test("Antigravity only uses flags that agy 1.1.26 actually defines", () => {
  // The `agy` parser is Go `flag`-based and rejects unknown flags outright, so
  // an invented flag would fail every invocation. This pins the verified surface.
  const supported = new Set([
    "--add-dir",
    "--agent",
    "-c",
    "--continue",
    "--conversation",
    "--dangerously-skip-permissions",
    "--disable-slash-commands",
    "--effort",
    "-i",
    "--input-format",
    "--json-schema",
    "--log-file",
    "--mode",
    "--model",
    "--new-project",
    "--output-format",
    "-p",
    "--print",
    "--print-timeout",
    "--project",
    "--prompt",
    "--prompt-interactive",
    "--sandbox",
  ]);
  const args = buildAntigravityArgs({
    model: "m",
    mode: "plan",
    schema: "{}",
    timeoutMs: 1_000,
  });
  for (const arg of args) {
    if (arg.startsWith("-")) {
      assert.ok(supported.has(arg), `${arg} is not a real agy 1.1.26 flag`);
    }
  }
});

test("Synaphex source never writes or reads Antigravity provider settings or credentials", async () => {
  const sources = await Promise.all(
    [
      "src/providers/antigravity-cli-agent-executor.ts",
      "src/providers/antigravity-execution-policy-resolver.ts",
      "src/providers/antigravity-cli-runtime-availability.ts",
      "src/providers/antigravity-agent-result-envelope-decoder.ts",
    ].map(
      async (path) =>
        [path, await readFile(join(process.cwd(), path), "utf8")] as const,
    ),
  );
  for (const [path, source] of sources) {
    // Strip comments so documentation of the audit does not trip the scan.
    const code = source
      .replaceAll(/\/\*[\s\S]*?\*\//g, "")
      .replaceAll(/\/\/.*$/gm, "");
    for (const forbidden of [
      "antigravity-cli/settings.json",
      "permissions.allow",
      "permissions.deny",
      "permissions.ask",
      "toolPermission",
      "keyring",
      ".gemini",
    ]) {
      assert.equal(
        code.includes(forbidden),
        false,
        `${path} must not reference ${forbidden}`,
      );
    }
    // Credential names may appear only inside the stderr redaction list, never
    // as something Synaphex reads. `env` is deliberately never populated, so
    // the provider keeps its own cached authentication.
    for (const credential of [
      "GOOGLE_API_KEY",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "ACCESS_TOKEN",
    ]) {
      for (const read of [
        `process.env.${credential}`,
        `process.env["${credential}"]`,
        `env.${credential}`,
      ]) {
        assert.equal(
          code.includes(read),
          false,
          `${path} must not read ${credential}`,
        );
      }
    }
  }
});
