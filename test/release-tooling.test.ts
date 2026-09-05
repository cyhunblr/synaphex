import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { type TestContext } from "node:test";

const REPO = process.cwd();
/**
 * Release helpers are plain `.mjs` scripts outside the compiled test tree, so
 * they are imported by absolute path from the repository root rather than by a
 * relative specifier that would differ between source and `.test-dist`.
 */
const preflightModule = pathToFileURL(
  join(REPO, "scripts/release/release-preflight.mjs"),
).href;
const registryModule = pathToFileURL(
  join(REPO, "scripts/release/registry-state.mjs"),
).href;
const RELEASE_WORKFLOW = join(REPO, ".github/workflows/release.yml");
const CI_WORKFLOW = join(REPO, ".github/workflows/ci.yml");

async function workflow(path: string): Promise<string> {
  return readFile(path, "utf8");
}

/**
 * Workflow content with YAML comments removed.
 *
 * The audits must judge what the workflow DOES, not what it documents:
 * a comment stating "there is deliberately no NPM_TOKEN" would otherwise trip
 * the very check it explains, pressuring the accurate comment out of existence.
 */
async function executableWorkflow(path: string): Promise<string> {
  return (await workflow(path))
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Version and tag authority
// ---------------------------------------------------------------------------

test("package.json owns the version and the tag only confirms it", async () => {
  const { checkVersionContract } = await import(preflightModule);
  const packageJson = { name: "synaphex", version: "1.2.3" };
  const lockfile = { name: "synaphex", version: "1.2.3", packages: { "": { version: "1.2.3" } } };

  assert.deepEqual(
    checkVersionContract({ packageJson, lockfile, tag: "v1.2.3" }),
    [],
    "a matching tag is accepted",
  );
  // A tag can never SUPPLY a version, so any disagreement is fatal.
  assert.match(
    checkVersionContract({ packageJson, lockfile, tag: "v1.2.4" }).join(" "),
    /does not match v1\.2\.3/,
  );
  assert.match(
    checkVersionContract({ packageJson, lockfile, tag: "1.2.3" }).join(" "),
    /does not match/,
    "an unprefixed tag is not the canonical form",
  );
  // The lockfile must agree, or `npm ci` would install a different tree.
  assert.match(
    checkVersionContract({
      packageJson,
      lockfile: { ...lockfile, version: "1.2.2" },
      tag: "v1.2.3",
    }).join(" "),
    /package-lock\.json version/,
  );
  assert.match(
    checkVersionContract({
      packageJson,
      lockfile: { ...lockfile, packages: { "": { version: "9.9.9" } } },
      tag: "v1.2.3",
    }).join(" "),
    /package-lock root version/,
  );
});

test("prerelease versions are refused while no dist-tag policy exists", async () => {
  const { checkVersionContract } = await import(preflightModule);
  for (const version of ["0.2.0-beta.1", "1.0.0-rc.1", "1.0"]) {
    const problems = checkVersionContract({
      packageJson: { name: "synaphex", version },
      lockfile: { name: "synaphex", version, packages: { "": { version } } },
      tag: `v${version}`,
    });
    assert.ok(
      problems.some((p: string) => /stable X\.Y\.Z/.test(p)),
      `${version} must be refused`,
    );
  }
});

// ---------------------------------------------------------------------------
// Publish metadata and licensing policy
// ---------------------------------------------------------------------------

test("publish metadata requires the canonical repository for provenance", async () => {
  const { checkPublishMetadata } = await import(preflightModule);
  const base = {
    name: "synaphex",
    files: ["dist"],
    repository: { type: "git", url: "git+https://github.com/cyhunblr/synaphex.git" },
  };
  assert.deepEqual(checkPublishMetadata(base), []);
  assert.match(
    checkPublishMetadata({ ...base, repository: undefined }).join(" "),
    /repository must point at/,
  );
  assert.match(
    checkPublishMetadata({ ...base, repository: "git+https://github.com/someone/else.git" }).join(" "),
    /repository must point at/,
  );
  assert.match(checkPublishMetadata({ ...base, private: true }).join(" "), /private/);
  assert.match(checkPublishMetadata({ ...base, files: [] }).join(" "), /files allowlist/);
});

test("an unresolved licensing decision blocks publication", async () => {
  const { checkLicensePolicy } = await import(preflightModule);
  // Public source visibility does not itself choose a distribution licence.
  assert.match(checkLicensePolicy({ license: "UNLICENSED" }).join(" "), /licensing decision/);
  assert.match(checkLicensePolicy({}).join(" "), /no license/);
  assert.deepEqual(checkLicensePolicy({ license: "MIT" }), []);
});

test("the repository's own metadata satisfies the provenance requirement", async () => {
  const { checkPublishMetadata, checkLicensePolicy } = await import(preflightModule);
  const packageJson = JSON.parse(await readFile(join(REPO, "package.json"), "utf8"));
  assert.deepEqual(
    checkPublishMetadata(packageJson),
    [],
    "real package metadata must be publish-ready",
  );
  // Recorded rather than asserted clean: this is the live policy blocker.
  const policy = checkLicensePolicy(packageJson);
  assert.equal(
    policy.length > 0,
    packageJson.license === "UNLICENSED",
    "licensing state must match what the preflight reports",
  );
});

// ---------------------------------------------------------------------------
// Registry state classification
// ---------------------------------------------------------------------------

test("registry state distinguishes absent, matching, differing and unavailable", async () => {
  const { classifyRegistryState } = await import(registryModule);
  const integrity = "sha512-AAAA";

  assert.deepEqual(
    classifyRegistryState({
      viewResult: { status: 1, stdout: "", stderr: "npm error code E404" },
      localIntegrity: integrity,
    }),
    { state: "absent" },
  );
  assert.equal(
    classifyRegistryState({
      viewResult: { status: 0, stdout: `"${integrity}"`, stderr: "" },
      localIntegrity: integrity,
    }).state,
    "published_match",
  );
  assert.equal(
    classifyRegistryState({
      viewResult: { status: 0, stdout: `"sha512-DIFFERENT"`, stderr: "" },
      localIntegrity: integrity,
    }).state,
    "published_differs",
  );
  // A registry outage must never be read as "safe to publish".
  for (const stderr of [
    "npm error network ETIMEDOUT",
    "npm error code E500",
    "npm error code EAUTHUNKNOWN",
  ]) {
    assert.equal(
      classifyRegistryState({
        viewResult: { status: 1, stdout: "", stderr },
        localIntegrity: integrity,
      }).state,
      "unavailable",
      `${stderr} must fail closed`,
    );
  }
});

test("the derived integrity matches npm's dist.integrity format", async (t: TestContext) => {
  const { tarballIntegrity, tarballSha256 } = await import(preflightModule);
  const dir = await mkdtemp(join(tmpdir(), "synaphex-release-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "sample.tgz");
  await writeFile(file, "synaphex release artifact");

  const integrity = tarballIntegrity(file);
  assert.match(integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
  assert.match(tarballSha256(file), /^[0-9a-f]{64}$/);
  // Deterministic: the same bytes always yield the same value.
  assert.equal(tarballIntegrity(file), integrity);
  await writeFile(file, "different bytes");
  assert.notEqual(tarballIntegrity(file), integrity);
});

// ---------------------------------------------------------------------------
// Workflow security audits
// ---------------------------------------------------------------------------

test("the release workflow uses no long-lived publish credential", async () => {
  const release = await executableWorkflow(RELEASE_WORKFLOW);
  for (const forbidden of [
    "NPM_TOKEN",
    "NODE_AUTH_TOKEN",
    "npm_token",
    "secrets.NPM",
    "//registry.npmjs.org/:_authToken",
  ]) {
    assert.equal(
      release.includes(forbidden),
      false,
      `release workflow must not reference ${forbidden}`,
    );
  }
  // OIDC is the only publish credential.
  assert.match(release, /id-token:\s*write/);
});

test("no workflow smuggles a publish credential into CI", async () => {
  const ci = await executableWorkflow(CI_WORKFLOW);
  for (const forbidden of ["NPM_TOKEN", "NODE_AUTH_TOKEN", "id-token", "npm publish"]) {
    assert.equal(ci.includes(forbidden), false, `ci.yml must not reference ${forbidden}`);
  }
  // PR CI stays fork-safe.
  assert.match(ci, /permissions:\s*\n\s*contents:\s*read/);
});

test("the release workflow publishes only the exact validated tarball", async () => {
  const release = await workflow(RELEASE_WORKFLOW);
  // Never `npm publish .` or a bare publish from the checkout.
  assert.equal(/npm publish\s*(\.|--|$)/m.test(release), false);
  assert.equal(/npm publish\s+\.\s/.test(release), false);
  assert.match(release, /npm publish "release-artifact\/[^"]*\.tgz"/);
  // Packed exactly once, then validated by path.
  assert.equal((release.match(/npm pack/g) ?? []).length, 1);
  assert.match(release, /test:packed-product -- --tarball/);
  // Integrity is re-checked before the irreversible step.
  assert.match(release, /sha256sum --check SHA256SUMS/);
});

test("the release workflow never creates versions or tags", async () => {
  const release = await executableWorkflow(RELEASE_WORKFLOW);
  for (const forbidden of [
    "npm version",
    "git tag",
    "git push --tags",
    "semantic-release",
    "changeset",
    "npm unpublish",
    "npm deprecate",
    "dist-tag",
  ]) {
    assert.equal(
      release.includes(forbidden),
      false,
      `release workflow must not run ${forbidden}`,
    );
  }
});

test("provenance is never disabled", async () => {
  const release = await executableWorkflow(RELEASE_WORKFLOW);
  assert.equal(release.includes("NPM_CONFIG_PROVENANCE=false"), false);
  assert.equal(release.includes("--no-provenance"), false);
  assert.equal(release.includes("provenance: false"), false);
});

test("registry mutation is gated behind a protected environment", async () => {
  const release = await workflow(RELEASE_WORKFLOW);
  assert.match(release, /environment:\s*npm-release/);
  // The verify job must not hold OIDC or an environment.
  const verifyBlock = release.slice(
    release.indexOf("  verify:"),
    release.indexOf("  publish:"),
  );
  assert.equal(verifyBlock.includes("id-token"), false);
  assert.equal(verifyBlock.includes("environment:"), false);
});

test("release runs only on a version tag, never on a main push", async () => {
  const release = await workflow(RELEASE_WORKFLOW);
  assert.match(release, /tags:\s*\n\s*- "v\*\.\*\.\*"/);
  // No branch trigger and no manual version input that could bypass the tag.
  assert.equal(/on:[\s\S]*?branches:/.test(release.slice(0, release.indexOf("jobs:"))), false);
  assert.equal(release.includes("workflow_dispatch"), false);
  assert.equal(/inputs:/.test(release), false);
});

test("the release workflow invokes no provider or model command", async () => {
  const release = await executableWorkflow(RELEASE_WORKFLOW);
  for (const forbidden of ["codex ", "claude ", "agy ", "--dangerously"]) {
    assert.equal(release.includes(forbidden), false, `must not run ${forbidden}`);
  }
});
