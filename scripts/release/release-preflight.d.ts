/** Types for the release preflight helpers consumed by the test suite. */
export declare const CANONICAL_REPOSITORY: string;
export declare function tarballIntegrity(path: string): string;
export declare function tarballSha256(path: string): string;
export declare function checkVersionContract(input: {
  packageJson: Record<string, unknown>;
  lockfile: Record<string, unknown>;
  tag?: string | undefined;
}): string[];
export declare function checkPublishMetadata(
  packageJson: Record<string, unknown>,
): string[];
export declare function checkLicensePolicy(
  packageJson: Record<string, unknown>,
): string[];
