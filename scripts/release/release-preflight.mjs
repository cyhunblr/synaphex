#!/usr/bin/env node
/**
 * Release preflight: deterministic local facts that must hold before any
 * registry mutation.
 *
 * Version authority lives in `package.json` and nowhere else. A Git tag only
 * CONFIRMS that decision -- it never supplies it -- so a mismatch is a hard
 * failure rather than something to reconcile. Nothing here bumps a version,
 * creates a tag, or contacts a provider.
 *
 * Usage:
 *   node scripts/release/release-preflight.mjs [--tag vX.Y.Z] [--tarball <path>]
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const CANONICAL_REPOSITORY = "github.com/cyhunblr/synaphex";
/** Versions npm will never accept a publish for, whatever the tag says. */
const STABLE_VERSION = /^\d+\.\d+\.\d+$/;

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function git(args) {
  const result = spawnSync("git", args, { cwd: REPO, encoding: "utf8", shell: false });
  return { status: result.status, stdout: (result.stdout ?? "").trim() };
}

/** Derives the Subresource Integrity value npm records as `dist.integrity`. */
export function tarballIntegrity(path) {
  return `sha512-${createHash("sha512").update(readFileSync(path)).digest("base64")}`;
}

export function tarballSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Validates the version/tag/lockfile contract.
 *
 * Exported so the release tests can exercise the real rules against fixtures
 * rather than re-implementing them.
 */
export function checkVersionContract({ packageJson, lockfile, tag }) {
  const problems = [];
  const version = packageJson.version;
  if (typeof version !== "string" || version.length === 0) {
    problems.push("package.json has no version");
    return problems;
  }
  if (!STABLE_VERSION.test(version)) {
    // Prerelease channels are deliberately deferred: shipping one would mean
    // choosing a dist-tag policy that does not exist yet.
    problems.push(
      `version ${version} is not a stable X.Y.Z release; prerelease channels are not supported yet`,
    );
  }
  if (lockfile.version !== version) {
    problems.push(`package-lock.json version ${lockfile.version} != ${version}`);
  }
  const lockRoot = lockfile.packages?.[""]?.version;
  if (lockRoot !== undefined && lockRoot !== version) {
    problems.push(`package-lock root version ${lockRoot} != ${version}`);
  }
  if (lockfile.name !== packageJson.name) {
    problems.push(`package-lock name ${lockfile.name} != ${packageJson.name}`);
  }
  if (tag !== undefined) {
    if (tag !== `v${version}`) {
      problems.push(`tag ${tag} does not match v${version}`);
    }
  }
  return problems;
}

/** Metadata npm and provenance require, separated from licensing policy. */
export function checkPublishMetadata(packageJson) {
  const problems = [];
  if (packageJson.private === true) {
    problems.push("package.json marks the package private");
  }
  const repositoryUrl =
    typeof packageJson.repository === "string"
      ? packageJson.repository
      : packageJson.repository?.url;
  if (typeof repositoryUrl !== "string" || !repositoryUrl.includes(CANONICAL_REPOSITORY)) {
    problems.push(
      `package.json repository must point at ${CANONICAL_REPOSITORY} for provenance`,
    );
  }
  if (!Array.isArray(packageJson.files) || packageJson.files.length === 0) {
    problems.push("package.json declares no files allowlist");
  }
  for (const [name, path] of Object.entries(packageJson.bin ?? {})) {
    if (!existsSync(resolve(REPO, path))) {
      problems.push(`bin ${name} points at a missing build output (${path})`);
    }
  }
  return problems;
}

/**
 * Licensing is a maintainer POLICY decision, never an implementation guess.
 *
 * Reported separately so the mechanics can be verified today while the policy
 * gate stays visibly unresolved.
 */
export function checkLicensePolicy(packageJson, licenseFileExists = undefined) {
  const license = packageJson.license;
  if (typeof license !== "string" || license.trim().length === 0) {
    return ["package.json declares no license"];
  }
  if (license === "UNLICENSED") {
    return [
      "package.json license is UNLICENSED; public npm distribution requires an explicit maintainer licensing decision",
    ];
  }
  // A declared SPDX identifier without the licence text would publish a claim
  // the package cannot substantiate. npm always includes a root LICENSE file
  // regardless of the `files` allowlist, so requiring it here is sufficient.
  const present =
    licenseFileExists ?? existsSync(resolve(REPO, "LICENSE"));
  if (!present) {
    return [`package.json declares ${license} but no LICENSE file is present`];
  }
  return [];
}

function main() {
  const tag = arg("--tag") ?? process.env.RELEASE_TAG;
  const tarball = arg("--tarball");
  const packageJson = JSON.parse(readFileSync(resolve(REPO, "package.json"), "utf8"));
  const lockfile = JSON.parse(readFileSync(resolve(REPO, "package-lock.json"), "utf8"));

  const blocking = [
    ...checkVersionContract({ packageJson, lockfile, tag }),
    ...checkPublishMetadata(packageJson),
  ];

  // The tagged commit must be an ancestor of the release branch. A valid tag
  // on a detached or fork commit is not release authority.
  if (tag !== undefined && process.env.SKIP_GIT_ANCESTRY !== "1") {
    const tagCommit = git(["rev-list", "-n", "1", tag]);
    if (tagCommit.status !== 0) {
      blocking.push(`tag ${tag} does not exist locally`);
    } else {
      const contained = git(["merge-base", "--is-ancestor", tagCommit.stdout, "origin/main"]);
      if (contained.status !== 0) {
        blocking.push(`tag ${tag} is not contained in origin/main`);
      }
    }
  }

  if (tarball !== undefined) {
    if (!existsSync(tarball)) {
      blocking.push(`tarball not found: ${tarball}`);
    } else {
      process.stdout.write(`tarball        ${tarball}\n`);
      process.stdout.write(`sha256         ${tarballSha256(tarball)}\n`);
      process.stdout.write(`integrity      ${tarballIntegrity(tarball)}\n`);
    }
  }

  const policy = checkLicensePolicy(packageJson);

  process.stdout.write(`package        ${packageJson.name}@${packageJson.version}\n`);
  process.stdout.write(`tag            ${tag ?? "(none supplied)"}\n\n`);

  for (const problem of blocking) {
    process.stdout.write(`BLOCKING  ${problem}\n`);
  }
  for (const problem of policy) {
    process.stdout.write(`POLICY    ${problem}\n`);
  }
  if (blocking.length === 0 && policy.length === 0) {
    process.stdout.write("release preflight: all checks passed\n");
  }
  // Policy gates fail the preflight too: publishing under UNLICENSED would be
  // an irreversible distribution decision made by automation.
  process.exit(blocking.length + policy.length === 0 ? 0 : 1);
}

if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) {
  main();
}
