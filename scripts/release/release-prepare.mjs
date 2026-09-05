#!/usr/bin/env node
/**
 * Produces and validates ONE exact release candidate.
 *
 * Developer release tooling, not a `synaphex` runtime command. It exists so the
 * manual bootstrap publish follows the same exact-artifact rule as automated
 * CD: pack once, validate that file, publish that file.
 *
 * It deliberately CANNOT publish, tag, authenticate, read a credential, or
 * mutate anything on npm or GitHub. It prints what a human needs in order to
 * review the candidate and then run `npm publish <path>` themselves.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tarballIntegrity, tarballSha256 } from "./release-preflight.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(REPO, "release-candidate");

function step(name, command, args) {
  process.stdout.write(`\n== ${name}\n`);
  const result = spawnSync(command, args, {
    cwd: REPO,
    stdio: "inherit",
    shell: false,
    timeout: 900_000,
  });
  if (result.status !== 0) {
    process.stdout.write(`\nrelease:prepare failed at: ${name}\n`);
    process.exit(1);
  }
}

const packageJson = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));

step("build", "npm", ["run", "build"]);

// Packed exactly once. Everything below validates THIS file, and the maintainer
// publishes THIS file -- re-packing later would ship unvalidated bytes.
process.stdout.write("\n== pack (once)\n");
mkdirSync(OUT, { recursive: true });
const packed = spawnSync("npm", ["pack", "--silent", "--pack-destination", OUT], {
  cwd: REPO,
  encoding: "utf8",
  shell: false,
});
if (packed.status !== 0) {
  process.stdout.write("release:prepare failed at: pack\n");
  process.exit(1);
}
const tarball = join(OUT, (packed.stdout ?? "").trim().split("\n").pop() ?? "");
if (!existsSync(tarball)) {
  process.stdout.write("release:prepare failed: no tarball produced\n");
  process.exit(1);
}
process.stdout.write(`${tarball}\n`);

step("release preflight", process.execPath, [
  join(REPO, "scripts/release/release-preflight.mjs"),
  "--tarball",
  tarball,
]);

step("packed-product validation", "npm", [
  "run",
  "test:packed-product",
  "--",
  "--tarball",
  tarball,
]);

process.stdout.write(
  [
    "",
    "== release candidate",
    `package    ${packageJson.name}@${packageJson.version}`,
    `tarball    ${tarball}`,
    `sha256     ${tarballSha256(tarball)}`,
    `integrity  ${tarballIntegrity(tarball)}`,
    "",
    "This script does not publish, tag or authenticate.",
    "Review the checksum and contents, then publish that exact file yourself:",
    "",
    `  npm publish ${tarball}`,
    "",
  ].join("\n"),
);
