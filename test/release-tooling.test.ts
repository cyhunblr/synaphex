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
const NPM_TEST_WORKFLOW = join(REPO, ".github/workflows/npm-test.yml");
const PROMOTION_GUARD_WORKFLOW = join(REPO, ".github/workflows/promotion-guard.yml");
const SYNAPHEX_WORKFLOWS = [
  CI_WORKFLOW,
  PROMOTION_GUARD_WORKFLOW,
  NPM_TEST_WORKFLOW,
  RELEASE_WORKFLOW,
] as const;

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

function jobBlock(source: string, jobId: string): string {
  const marker = `\n  ${jobId}:\n`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `workflow must define job ${jobId}`);
  const bodyStart = start + marker.length;
  const remainder = source.slice(bodyStart);
  const nextJob = remainder.search(/^  [A-Za-z0-9_-]+:\s*$/m);
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
}

function namedSteps(job: string): readonly string[] {
  return [...job.matchAll(/^      - name: (.+)$/gm)].map((match) => match[1]!);
}

function assertOrderedSubsequence(
  actual: readonly string[],
  expected: readonly string[],
): void {
  let previous = -1;
  for (const step of expected) {
    const index = actual.indexOf(step);
    assert.ok(index > previous, `${step} must appear in canonical order`);
    previous = index;
  }
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

test("stable releases reject prereleases while the test channel accepts its exact grammar", async () => {
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
  const prerelease = "0.2.0-test.145";
  assert.deepEqual(
    checkVersionContract({
      packageJson: { name: "synaphex", version: prerelease },
      lockfile: {
        name: "synaphex",
        version: prerelease,
        packages: { "": { version: prerelease } },
      },
      channel: "test",
    }),
    [],
  );
  assert.match(
    checkVersionContract({
      packageJson: { name: "synaphex", version: "0.2.0-beta.1" },
      lockfile: {
        name: "synaphex",
        version: "0.2.0-beta.1",
        packages: { "": { version: "0.2.0-beta.1" } },
      },
      channel: "test",
    }).join(" "),
    /X\.Y\.Z-test\.N/,
  );
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
  assert.match(
    checkLicensePolicy({ license: "UNLICENSED" }, true).join(" "),
    /licensing decision/,
  );
  assert.match(checkLicensePolicy({}, true).join(" "), /no license/);
  assert.deepEqual(checkLicensePolicy({ license: "Apache-2.0" }, true), []);
  // A declared identifier without the licence text would publish an
  // unsubstantiated claim.
  assert.match(
    checkLicensePolicy({ license: "Apache-2.0" }, false).join(" "),
    /no LICENSE file/,
  );
});

test("the package is Apache-2.0 with the licence text present", async () => {
  const packageJson = JSON.parse(await readFile(join(REPO, "package.json"), "utf8"));
  assert.equal(packageJson.license, "Apache-2.0");

  const license = await readFile(join(REPO, "LICENSE"), "utf8");
  // The standard text, unmodified: no paraphrase, no added restriction and no
  // dual licensing.
  for (const section of [
    "Apache License",
    "Version 2.0, January 2004",
    "TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION",
    "1. Definitions.",
    "2. Grant of Copyright License.",
    "3. Grant of Patent License.",
    "9. Accepting Warranty or Additional Liability.",
    "END OF TERMS AND CONDITIONS",
    "APPENDIX: How to apply the Apache License",
  ]) {
    assert.ok(license.includes(section), `LICENSE is missing: ${section}`);
  }
  // Word-boundary matching: the standard text contains "individual", which a
  // naive substring check for "dual" would flag.
  for (const forbidden of [/\bMIT License\b/i, /\bdual[- ]licen[sc]/i, /\badditional restrictions\b/i]) {
    assert.equal(
      forbidden.test(license),
      false,
      `LICENSE must not match ${forbidden}`,
    );
  }
  // Exactly the canonical byte length of the upstream Apache-2.0 text.
  assert.equal(Buffer.byteLength(license, "utf8"), 11_358);
  // The live policy gate is now clear.
  const { checkLicensePolicy } = await import(preflightModule);
  assert.deepEqual(checkLicensePolicy(packageJson), []);
});

test("package identity is the unscoped name at the first version", async () => {
  const packageJson = JSON.parse(await readFile(join(REPO, "package.json"), "utf8"));
  const lockfile = JSON.parse(await readFile(join(REPO, "package-lock.json"), "utf8"));

  // Unscoped and unchanged: this repository is the new Synaphex product, not a
  // continuation of the unrelated package that formerly held this name.
  assert.equal(packageJson.name, "synaphex");
  assert.equal(packageJson.name.startsWith("@"), false, "must not be scoped");
  assert.equal(packageJson.version, "0.1.1");
  assert.equal(lockfile.version, "0.1.1");
  assert.equal(lockfile.packages?.[""]?.version, "0.1.1");
  assert.equal(lockfile.name, "synaphex");

  // The user-facing CLI name is part of that identity.
  assert.ok(Object.hasOwn(packageJson.bin, "synaphex"));
  // An unscoped package is public by default, so publishConfig would be
  // redundant configuration rather than a policy statement.
  assert.equal(packageJson.publishConfig, undefined);
  assert.notEqual(packageJson.private, true);
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

test("Linux workflows pin Ubuntu 24.04 and use Node 24 action majors", async () => {
  const sources = await Promise.all(SYNAPHEX_WORKFLOWS.map(executableWorkflow));
  const combined = sources.join("\n");

  for (const source of sources) {
    const runnerLabels = [...source.matchAll(/^\s*runs-on:\s*(\S+)\s*$/gm)]
      .map((match) => match[1]);
    assert.ok(runnerLabels.length > 0, "every workflow must define a runner");
    assert.deepEqual(
      [...new Set(runnerLabels)],
      ["ubuntu-24.04"],
      "every Synaphex-owned Linux job must use the pinned Ubuntu 24.04 image",
    );
  }

  for (const [action, major] of [
    ["checkout", "v7"],
    ["setup-node", "v7"],
    ["upload-artifact", "v7"],
    ["download-artifact", "v8"],
  ] as const) {
    const references = [...combined.matchAll(
      new RegExp(`actions/${action}@(v\\d+)`, "g"),
    )].map((match) => match[1]);
    assert.ok(references.length > 0, `expected at least one actions/${action} reference`);
    assert.deepEqual(
      [...new Set(references)],
      [major],
      `every actions/${action} reference must use ${major}`,
    );
  }

  assert.equal(combined.includes("ubuntu-latest"), false);
  for (const legacy of [
    "actions/checkout@v4",
    "actions/setup-node@v4",
    "actions/upload-artifact@v4",
    "actions/download-artifact@v4",
  ]) {
    assert.equal(combined.includes(legacy), false, `${legacy} must be fully removed`);
  }
});

test("both release channels use only environment-gated Trusted Publishing", async () => {
  for (const [path, environment] of [
    [NPM_TEST_WORKFLOW, "npm-test"],
    [RELEASE_WORKFLOW, "npm-release"],
  ] as const) {
    const release = await executableWorkflow(path);
    const publish = jobBlock(release, "publish");

    assert.match(publish, new RegExp(`environment:\\s*${environment}`));
    assert.match(publish, /permissions:\s*\n\s*contents:\s*read\s*\n\s*id-token:\s*write/);
    assert.match(publish, /node-version:\s*"22\.23\.2"/);
    assert.match(publish, /npm install --global npm@11\.5\.1/);
    assert.match(publish, /test "\$NODE_VERSION" = "v22\.23\.2"/);
    assert.match(publish, /test "\$NPM_VERSION" = "11\.5\.1"/);
    assert.equal(release.includes("NPM_TOKEN"), false);
    assert.equal(release.includes("NODE_AUTH_TOKEN"), false);
    assert.equal(release.includes("npm whoami"), false);
    assert.equal(publish.includes("registry-url:"), false);
    assert.equal(publish.includes("_authToken"), false);
  }
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
  assert.match(release, /npm publish "\$ARTIFACT" --access public --tag latest/);
  // The canonical helper owns the one pack and exact-artifact product gate.
  assert.equal((release.match(/release:prepare/g) ?? []).length, 1);
  assert.equal((release.match(/npm pack --dry-run/g) ?? []).length, 1);
  assert.equal(release.replace("npm pack --dry-run", "").includes("npm pack"), false);
  // All recorded hashes are checked before and after the irreversible step.
  assert.equal((release.match(/verify-artifact/g) ?? []).length, 2);
  for (const field of ["size", "sha256", "sha512", "integrity", "shasum"]) {
    assert.match(release, new RegExp(`--${field}`));
  }
});

test("both channels publish the exact validated artifact through one absolute local path", async () => {
  for (const [path, tag, verificationCount] of [
    [NPM_TEST_WORKFLOW, "test", 1],
    [RELEASE_WORKFLOW, "latest", 2],
  ] as const) {
    const publish = jobBlock(await workflow(path), "publish");
    assert.match(publish, /- name: Resolve exact local artifact path/);
    assert.match(publish, /local-artifact-path/);
    assert.match(publish, /--workspace "\$GITHUB_WORKSPACE"/);
    assert.match(publish, /--filename "\$ARTIFACT_FILENAME"/);
    assert.equal(
      (publish.match(/ARTIFACT: \$\{\{ steps\.artifact-path\.outputs\.path \}\}/g) ?? []).length,
      verificationCount + 2,
      "verification, registry preflight, publication, and any post-publish check must share one path",
    );
    assert.equal(publish.includes("ARTIFACT: release-candidate/"), false);
    assert.match(publish, new RegExp(`npm publish "\\$ARTIFACT" --access public --tag ${tag}`));
    assert.equal(/npm publish\s+\.(\s|$)/m.test(publish), false);
    assert.equal(publish.includes("npm run build"), false);
    assert.equal(publish.includes("npm pack"), false);
    assert.equal(publish.includes("release:prepare"), false);
  }
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

test("provenance is neither explicitly requested nor disabled", async () => {
  for (const path of [RELEASE_WORKFLOW, NPM_TEST_WORKFLOW]) {
    const release = await executableWorkflow(path);
    assert.equal(release.includes("NPM_CONFIG_PROVENANCE=false"), false);
    assert.equal(release.includes("--no-provenance"), false);
    assert.equal(release.includes("provenance: false"), false);
    assert.equal(release.includes("--provenance"), false);
  }
});

test("registry mutation is gated behind a protected environment", async () => {
  const release = await workflow(RELEASE_WORKFLOW);
  assert.match(release, /environment:\s*npm-release/);
  // Preparation carries neither a credential nor an environment gate.
  const prepareBlock = release.slice(
    release.indexOf("  prepare:"),
    release.indexOf("  publish:"),
  );
  assert.equal(prepareBlock.includes("NODE_AUTH_TOKEN"), false);
  assert.equal(prepareBlock.includes("environment:"), false);
});

test("production release is manual and fails closed outside main", async () => {
  const release = await workflow(RELEASE_WORKFLOW);
  assert.match(release, /on:\s*\n\s*workflow_dispatch:/);
  assert.match(release, /--actual "\$GITHUB_REF_NAME"[\s\S]*--expected main/);
  assert.match(release, /--ref-type "\$GITHUB_REF_TYPE"/);
  assert.equal(/push:\s*\n/.test(release.slice(0, release.indexOf("jobs:"))), false);
  assert.equal(release.includes("git tag"), false);
});

test("test channel is manual, test-branch-only, and publishes a derived prerelease", async () => {
  const release = await workflow(NPM_TEST_WORKFLOW);
  assert.match(release, /on:\s*\n\s*workflow_dispatch:/);
  assert.match(release, /--actual "\$GITHUB_REF_NAME"[\s\S]*--expected test/);
  assert.match(release, /--ref-type "\$GITHUB_REF_TYPE"/);
  assert.match(release, /derive-test-version/);
  assert.match(release, /npm version "\$VERSION" --no-git-tag-version --ignore-scripts/);
  assert.match(release, /release:prepare -- --channel test/);
  assert.match(release, /assert-tarball-package/);
  assert.match(release, /test "\$VERSION" = "\$\{\{ steps\.prerelease\.outputs\.version \}\}"/);
  assert.match(release, /npm publish "\$ARTIFACT" --access public --tag test/);
  assert.equal(/push:\s*\n/.test(release.slice(0, release.indexOf("jobs:"))), false);
});

test("test prerelease mutation follows the complete pristine source-validation contract", async () => {
  const ci = await workflow(CI_WORKFLOW);
  const testRelease = await workflow(NPM_TEST_WORKFLOW);
  const canonicalSourceSteps = namedSteps(jobBlock(ci, "source-validation"));
  assert.deepEqual(canonicalSourceSteps, [
    "Install dependencies",
    "Typecheck",
    "Build",
    "Test",
    "MCP stdio protocol tests",
    "Whitespace check",
    "Package dry run",
  ]);

  const testSteps = namedSteps(jobBlock(testRelease, "prepare"));
  assertOrderedSubsequence(testSteps, canonicalSourceSteps);
  const mutation = testSteps.indexOf("Derive ephemeral test prerelease");
  assert.ok(mutation > testSteps.indexOf("Package dry run"));
  assert.ok(testSteps.indexOf("Build") < testSteps.indexOf("Test"));
  assert.ok(testSteps.indexOf("Build") < testSteps.indexOf("MCP stdio protocol tests"));
  assertOrderedSubsequence(testSteps, [
    "Derive ephemeral test prerelease",
    "Verify only package metadata changed",
    "Prepare and validate exact test artifact",
    "Record artifact identity",
    "Confirm prerelease coordinate is unused",
    "Upload exact test artifact",
  ]);
});

test("production runs the same build-before-test source validation without mutating its version", async () => {
  const ci = await workflow(CI_WORKFLOW);
  const production = await workflow(RELEASE_WORKFLOW);
  const canonicalSourceSteps = namedSteps(jobBlock(ci, "source-validation"));
  const productionPrepare = jobBlock(production, "prepare");
  assertOrderedSubsequence(namedSteps(productionPrepare), canonicalSourceSteps);
  assert.equal(productionPrepare.includes("npm version"), false);
});

test("CI covers pull requests and pushes for dev, test, and main", async () => {
  const ci = await workflow(CI_WORKFLOW);
  assert.match(ci, /pull_request:\s*\n\s*branches: \[dev, test, main\]/);
  assert.match(ci, /push:\s*\n\s*branches: \[dev, test, main\]/);
  assert.match(ci, /Source validation \(Node \$\{\{ matrix\.node \}\}\)/);
  assert.match(ci, /Packed product \(Node \$\{\{ matrix\.node \}\}\)/);
  assert.equal(
    (ci.match(/node: \["20", "22"\]/g) ?? []).length,
    2,
    "source and packed-product validation must retain the Node 20/22 matrix",
  );
});

test("the release workflow invokes no provider or model command", async () => {
  const release = await executableWorkflow(RELEASE_WORKFLOW);
  for (const forbidden of ["codex ", "claude ", "agy ", "--dangerously"]) {
    assert.equal(release.includes(forbidden), false, `must not run ${forbidden}`);
  }
});


// ---------------------------------------------------------------------------
// Bootstrap and registry-state expectations
// ---------------------------------------------------------------------------

test("an absent registry version is bootstrap-ready, not publish-authorised", async () => {
  const { classifyRegistryState } = await import(registryModule);
  // After a full unpublish the package itself is gone, so a version query
  // reports absent. That is the expected BOOTSTRAP state -- it says nothing
  // about whether a Trusted Publisher exists or whether npm's 24-hour
  // name cooldown has elapsed, and must never be read as "publish now".
  assert.deepEqual(
    classifyRegistryState({
      viewResult: {
        status: 1,
        stdout: "",
        stderr: "npm error code E404\nnpm error 404 Unpublished on 2026-09-05T09:35:17.872Z",
      },
      localIntegrity: "sha512-AAAA",
    }),
    { state: "absent" },
  );
});

test("release tooling never selects a version from registry history", async () => {
  // Historical 1.x/2.x/3.x versions belonged to an unrelated product and must
  // never be reused. Version authority is package.json alone, so no release
  // script may query the registry for a version to publish.
  for (const file of [
    "scripts/release/release-preflight.mjs",
    "scripts/release/registry-state.mjs",
  ]) {
    const code = (await readFile(join(REPO, file), "utf8"))
      .replaceAll(/\/\*[\s\S]*?\*\//g, "")
      .replaceAll(/\/\/.*$/gm, "");
    for (const forbidden of ["dist-tags", "versions", "latest", "semver.inc", "maxSatisfying"]) {
      assert.equal(
        code.includes(forbidden),
        false,
        `${file} must not derive a version from registry state (${forbidden})`,
      );
    }
  }
});

test("bootstrap documentation never recommends publishing from the checkout", async () => {
  const adr = await readFile(join(REPO, "docs/architecture/0008-release.md"), "utf8");
  // `npm publish .` repacks, shipping bytes nothing validated. The exact-tarball
  // rule applies to the one-time manual bootstrap exactly as it does to CD.
  assert.equal(/npm publish\s+\.(\s|$)/m.test(adr), false);
  assert.match(adr, /npm publish <exact/i);
});

test("no test reads real credentials", async () => {
  const { readdir } = await import("node:fs/promises");
  const directory = join(REPO, "test");
  // Assembled so this audit does not flag its own literals, and skipping this
  // file, which necessarily names what it forbids.
  const forbidden = [
    [".", "npmrc"].join(""),
    ["NPM", "TOKEN"].join("_"),
    ["NODE", "AUTH", "TOKEN"].join("_"),
    ["_auth", "Token"].join(""),
  ];
  const names = (await readdir(directory)).filter(
    (n) => n.endsWith(".ts") && n !== "release-tooling.test.ts",
  );
  assert.ok(names.length > 0, "expected test files to audit");
  for (const name of names) {
    const code = (await readFile(join(directory, name), "utf8"))
      .replaceAll(/\/\*[\s\S]*?\*\//g, "")
      .replaceAll(/\/\/.*$/gm, "");
    for (const secret of forbidden) {
      assert.equal(code.includes(secret), false, `${name} must not touch ${secret}`);
    }
  }
});

test("the release helper cannot publish, tag or authenticate", async () => {
  const code = (
    await readFile(join(REPO, "scripts/release/release-prepare.mjs"), "utf8")
  )
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/\/\/.*$/gm, "");
  // It prepares a candidate for a human to review; every irreversible or
  // credential-bearing action stays outside the tooling.
  for (const forbidden of [
    '"publish"',
    "npm login",
    "adduser",
    '"version"',
    "git tag",
    "dist-tag",
    "unpublish",
    ["_auth", "Token"].join(""),
    ["NPM", "TOKEN"].join("_"),
    [".", "npmrc"].join(""),
  ]) {
    assert.equal(code.includes(forbidden), false, `helper must not use ${forbidden}`);
  }
  // It packs exactly once, so the validated artifact is the published one.
  assert.equal((code.match(/"pack"/g) ?? []).length, 1);
});
