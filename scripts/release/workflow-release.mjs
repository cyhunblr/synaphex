#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";

const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const TEST_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-test\.([1-9]\d*)$/;

export function validateStableVersion(version) {
  if (!STABLE_VERSION.test(version)) {
    throw new Error(`expected a stable X.Y.Z version, received ${version}`);
  }
  return version;
}

export function validateTestVersion(version) {
  if (!TEST_VERSION.test(version)) {
    throw new Error(`expected an X.Y.Z-test.N prerelease, received ${version}`);
  }
  return version;
}

export function deriveTestPrerelease(stableVersion, runNumber) {
  validateStableVersion(stableVersion);
  if (!/^[1-9]\d*$/.test(String(runNumber))) {
    throw new Error(`GitHub run number must be a positive integer, received ${runNumber}`);
  }
  const [, major, minor, patch] = STABLE_VERSION.exec(stableVersion);
  const nextPatch = Number(patch) + 1;
  if (!Number.isSafeInteger(nextPatch)) {
    throw new Error(`patch version cannot be incremented safely: ${patch}`);
  }
  return `${major}.${minor}.${nextPatch}-test.${runNumber}`;
}

export function assertExpectedBranch(actual, expected, refType = "branch") {
  if (refType !== "branch" || actual !== expected) {
    throw new Error(
      `release branch mismatch: actual=${actual} expected=${expected} refType=${refType}`,
    );
  }
  return actual;
}

export function selectReleaseArtifact({ directory, name, version, entries }) {
  const filename = `${name}-${version}.tgz`;
  const candidates = (entries ?? readdirSync(directory)).filter((entry) => entry.endsWith(".tgz"));
  if (candidates.length !== 1 || candidates[0] !== filename) {
    throw new Error(
      `expected exactly ${filename}; found ${candidates.length === 0 ? "none" : candidates.join(",")}`,
    );
  }
  const path = resolve(directory, filename);
  if (entries === undefined && !existsSync(path)) {
    throw new Error(`release artifact does not exist: ${path}`);
  }
  return path;
}

export function artifactIdentity(path, metadata = {}) {
  const bytes = readFileSync(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sha512Hex = createHash("sha512").update(bytes).digest("hex");
  const sha512Base64 = createHash("sha512").update(bytes).digest("base64");
  const shasum = createHash("sha1").update(bytes).digest("hex");
  return {
    name: metadata.name ?? "",
    version: metadata.version ?? "",
    git_sha: metadata.gitSha ?? "",
    artifact_path: resolve(path),
    artifact_filename: basename(path),
    size: String(statSync(path).size),
    sha256,
    sha512: sha512Hex,
    integrity: `sha512-${sha512Base64}`,
    shasum,
  };
}

export function verifyArtifactIdentity(actual, expected) {
  for (const field of ["size", "sha256", "sha512", "integrity", "shasum"]) {
    if (String(actual[field]) !== String(expected[field])) {
      throw new Error(`artifact ${field} mismatch: actual=${actual[field]} expected=${expected[field]}`);
    }
  }
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name) {
  const value = arg(name);
  if (value === undefined || value.length === 0) {
    throw new Error(`missing required argument ${name}`);
  }
  return value;
}

function appendOutputs(path, identity) {
  const lines = Object.entries(identity).map(([key, value]) => `${key}=${value}`);
  appendFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

function main() {
  const command = process.argv[2];
  switch (command) {
    case "derive-test-version":
      process.stdout.write(`${deriveTestPrerelease(required("--stable"), required("--run-number"))}\n`);
      return;
    case "assert-branch":
      assertExpectedBranch(
        required("--actual"),
        required("--expected"),
        required("--ref-type"),
      );
      process.stdout.write("branch validation passed\n");
      return;
    case "assert-stable":
      process.stdout.write(`${validateStableVersion(required("--version"))}\n`);
      return;
    case "assert-test-version":
      process.stdout.write(`${validateTestVersion(required("--version"))}\n`);
      return;
    case "artifact-path":
      process.stdout.write(`${selectReleaseArtifact({
        directory: required("--directory"),
        name: required("--name"),
        version: required("--version"),
      })}\n`);
      return;
    case "artifact-identity": {
      const identity = artifactIdentity(required("--path"), {
        name: required("--name"),
        version: required("--version"),
        gitSha: required("--git-sha"),
      });
      const output = arg("--github-output");
      if (output !== undefined) appendOutputs(output, identity);
      process.stdout.write(`${JSON.stringify(identity)}\n`);
      return;
    }
    case "verify-artifact": {
      const path = required("--path");
      const identity = artifactIdentity(path);
      verifyArtifactIdentity(identity, {
        size: required("--size"),
        sha256: required("--sha256"),
        sha512: required("--sha512"),
        integrity: required("--integrity"),
        shasum: required("--shasum"),
      });
      process.stdout.write(`${JSON.stringify(identity)}\n`);
      return;
    }
    default:
      throw new Error(`unknown workflow-release command: ${command ?? "(missing)"}`);
  }
}

if (process.argv[1]?.endsWith("workflow-release.mjs")) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
