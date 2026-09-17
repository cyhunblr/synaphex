export interface ArtifactIdentity {
  readonly name: string;
  readonly version: string;
  readonly git_sha: string;
  readonly artifact_path: string;
  readonly artifact_filename: string;
  readonly size: string;
  readonly sha256: string;
  readonly sha512: string;
  readonly integrity: string;
  readonly shasum: string;
}

export function validateStableVersion(version: string): string;
export function validateTestVersion(version: string): string;
export function deriveTestPrerelease(stableVersion: string, runNumber: string | number): string;
export function assertExpectedBranch(
  actual: string,
  expected: string,
  refType?: string,
): string;
export function selectReleaseArtifact(input: {
  readonly directory: string;
  readonly name: string;
  readonly version: string;
  readonly entries?: readonly string[];
}): string;
export function tarballPackageIdentity(path: string): {
  readonly name: string;
  readonly version: string;
};
export function assertTarballPackageIdentity(
  path: string,
  expected: { readonly name: string; readonly version: string },
): { readonly name: string; readonly version: string };
export function artifactIdentity(
  path: string,
  metadata?: { readonly name?: string; readonly version?: string; readonly gitSha?: string },
): ArtifactIdentity;
export function verifyArtifactIdentity(
  actual: ArtifactIdentity,
  expected: Pick<ArtifactIdentity, "size" | "sha256" | "sha512" | "integrity" | "shasum">,
): void;
