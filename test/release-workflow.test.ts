import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { type TestContext } from "node:test";

const REPO = process.cwd();
const helperModule = pathToFileURL(
  join(REPO, "scripts/release/workflow-release.mjs"),
).href;

test("test prerelease is the next patch plus the GitHub run number", async () => {
  const { deriveTestPrerelease } = await import(helperModule);
  assert.equal(deriveTestPrerelease("0.1.1", "145"), "0.1.2-test.145");
  assert.equal(deriveTestPrerelease("2.9.9", 7), "2.9.10-test.7");
  assert.throws(() => deriveTestPrerelease("0.1.1-test.1", 2), /stable X\.Y\.Z/);
  assert.throws(() => deriveTestPrerelease("0.1.1", "0"), /positive integer/);
});

test("release branch and version validators fail closed", async () => {
  const {
    assertExpectedBranch,
    validateStableVersion,
    validateTestVersion,
  } = await import(helperModule);
  assert.equal(assertExpectedBranch("main", "main"), "main");
  assert.throws(() => assertExpectedBranch("test", "main"), /actual=test expected=main/);
  assert.throws(
    () => assertExpectedBranch("main", "main", "tag"),
    /actual=main expected=main refType=tag/,
  );
  assert.equal(validateStableVersion("1.2.3"), "1.2.3");
  assert.throws(() => validateStableVersion("1.2.3-test.1"), /stable X\.Y\.Z/);
  assert.equal(validateTestVersion("1.2.4-test.99"), "1.2.4-test.99");
  assert.throws(() => validateTestVersion("1.2.4-beta.1"), /X\.Y\.Z-test\.N/);
});

test("artifact selection requires the one exact name and version", async () => {
  const { selectReleaseArtifact } = await import(helperModule);
  assert.equal(
    selectReleaseArtifact({
      directory: "/tmp/release-candidate",
      name: "synaphex",
      version: "0.1.2-test.4",
      entries: ["synaphex-0.1.2-test.4.tgz"],
    }),
    "/tmp/release-candidate/synaphex-0.1.2-test.4.tgz",
  );
  assert.throws(
    () => selectReleaseArtifact({
      directory: "/tmp/release-candidate",
      name: "synaphex",
      version: "0.1.2-test.4",
      entries: ["synaphex-0.1.2-test.3.tgz"],
    }),
    /expected exactly/,
  );
  assert.throws(
    () => selectReleaseArtifact({
      directory: "/tmp/release-candidate",
      name: "synaphex",
      version: "0.1.2-test.4",
      entries: ["synaphex-0.1.2-test.4.tgz", "stale.tgz"],
    }),
    /expected exactly/,
  );
});

test("publication artifact paths are absolute local paths to basename-only tarballs", async () => {
  const { localArtifactPath } = await import(helperModule);
  assert.equal(
    localArtifactPath("/github/workspace", "synaphex-0.1.2-test.4.tgz"),
    "/github/workspace/release-candidate/synaphex-0.1.2-test.4.tgz",
  );

  for (const unsafe of [
    "release-candidate/synaphex-0.1.2-test.4.tgz",
    "owner/repository",
    "git+ssh://git@github.com/owner/repository.git",
    "synaphex",
    ".",
  ]) {
    assert.throws(
      () => localArtifactPath("/github/workspace", unsafe),
      /basename ending in \.tgz/,
    );
  }
  assert.throws(
    () => localArtifactPath("github/workspace", "synaphex-0.1.2-test.4.tgz"),
    /workspace must be an absolute path/,
  );
});

test("tarball package identity must match the derived release coordinate", async (t: TestContext) => {
  const { assertTarballPackageIdentity } = await import(helperModule);
  const directory = await mkdtemp(join(tmpdir(), "synaphex-tarball-identity-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const packageDirectory = join(directory, "package");
  await mkdir(packageDirectory);
  await writeFile(
    join(packageDirectory, "package.json"),
    JSON.stringify({ name: "synaphex", version: "0.1.2-test.145" }),
  );
  const tarball = join(directory, "synaphex-0.1.2-test.145.tgz");
  const packed = spawnSync(
    "tar",
    ["-czf", tarball, "-C", directory, "package"],
    { encoding: "utf8", shell: false },
  );
  assert.equal(packed.status, 0, packed.stderr);

  assert.deepEqual(
    assertTarballPackageIdentity(tarball, {
      name: "synaphex",
      version: "0.1.2-test.145",
    }),
    { name: "synaphex", version: "0.1.2-test.145" },
  );
  assert.throws(
    () => assertTarballPackageIdentity(tarball, {
      name: "synaphex",
      version: "0.1.2-test.146",
    }),
    /actual=synaphex@0\.1\.2-test\.145 expected=synaphex@0\.1\.2-test\.146/,
  );
});

test("artifact identity verification detects byte changes", async (t: TestContext) => {
  const { artifactIdentity, verifyArtifactIdentity } = await import(helperModule);
  const directory = await mkdtemp(join(tmpdir(), "synaphex-workflow-release-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "synaphex-1.2.3.tgz");
  await writeFile(path, "first bytes");
  const expected = artifactIdentity(path, {
    name: "synaphex",
    version: "1.2.3",
    gitSha: "abc123",
  });
  verifyArtifactIdentity(expected, expected);
  await writeFile(path, "different bytes");
  assert.throws(
    () => verifyArtifactIdentity(artifactIdentity(path), expected),
    /artifact (size|sha256) mismatch/,
  );
});
