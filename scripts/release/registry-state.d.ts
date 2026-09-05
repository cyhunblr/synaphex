/** Types for the read-only registry state classifier. */
export type RegistryState =
  | { readonly state: "absent" }
  | { readonly state: "published_match"; readonly integrity: string }
  | { readonly state: "published_differs"; readonly integrity: string }
  | { readonly state: "published_unknown_artifact"; readonly integrity: string }
  | { readonly state: "unavailable"; readonly detail?: string };

export declare function classifyRegistryState(input: {
  viewResult: { status: number | null; stdout: string; stderr: string };
  localIntegrity?: string | undefined;
}): RegistryState;
