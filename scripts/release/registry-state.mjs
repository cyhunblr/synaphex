#!/usr/bin/env node
/**
 * Read-only registry state for one exact release version.
 *
 * npm versions are immutable, so a rerun must never blindly re-publish. This
 * distinguishes the three cases that matter and FAILS CLOSED on the ambiguous
 * one -- treating a registry outage as "not published" would risk a duplicate
 * publish attempt, and treating it as "published" would silently skip a real
 * release.
 *
 * ```text
 * absent            -> safe to publish
 * published_match   -> this exact artifact is already the published one
 * published_differs -> hard conflict; never republish over it
 * unavailable       -> fail closed
 * ```
 *
 * Usage:
 *   node scripts/release/registry-state.mjs --name synaphex --version 0.2.0 [--tarball <path>]
 */
import { spawnSync } from "node:child_process";
import { tarballIntegrity } from "./release-preflight.mjs";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * Classifies registry state.
 *
 * `view` is injected so tests can exercise every branch -- including registry
 * failure -- without touching the real registry or publishing anything.
 */
export function classifyRegistryState({ viewResult, localIntegrity }) {
  if (viewResult.status === 0) {
    const integrity = viewResult.stdout.trim().replace(/^"|"$/g, "");
    if (integrity.length === 0) {
      return { state: "unavailable", detail: "registry returned no integrity value" };
    }
    if (localIntegrity === undefined) {
      return { state: "published_unknown_artifact", integrity };
    }
    return integrity === localIntegrity
      ? { state: "published_match", integrity }
      : { state: "published_differs", integrity };
  }
  // npm reports a missing version as E404; anything else is an outage or an
  // auth/network problem, and must not be read as "safe to publish".
  const combined = `${viewResult.stdout}${viewResult.stderr}`;
  if (/E404|404 Not Found|is not in this registry|No match found/i.test(combined)) {
    return { state: "absent" };
  }
  return { state: "unavailable", detail: combined.trim().slice(0, 200) };
}

function main() {
  const name = arg("--name");
  const version = arg("--version");
  const tarball = arg("--tarball");
  if (name === undefined || version === undefined) {
    process.stderr.write("usage: --name <pkg> --version <x.y.z> [--tarball <path>]\n");
    process.exit(2);
  }
  const viewResult = spawnSync(
    "npm",
    ["view", `${name}@${version}`, "dist.integrity", "--json"],
    { encoding: "utf8", shell: false, timeout: 60_000 },
  );
  const result = classifyRegistryState({
    viewResult: {
      status: viewResult.status,
      stdout: viewResult.stdout ?? "",
      stderr: viewResult.stderr ?? "",
    },
    localIntegrity: tarball === undefined ? undefined : tarballIntegrity(tarball),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  // Only "absent" permits a publish attempt.
  process.exit(result.state === "absent" ? 0 : 1);
}

if (process.argv[1]?.endsWith("registry-state.mjs")) {
  main();
}
