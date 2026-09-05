import type {
  HostAvailability,
  InstallationTarget,
  SynaphexLauncher,
} from "../domain/installation.js";

/** What a provider host currently holds under the Synaphex registration name. */
export type RegistrationInspection =
  | { readonly state: "absent" }
  /** Present and provably Synaphex-managed with the expected launcher. */
  | { readonly state: "current" }
  /** Present, Synaphex-managed, but pointing at a stale launcher or args. */
  | { readonly state: "outdated"; readonly detail: string }
  /** Present but NOT provably Synaphex-owned. Never overwritten or deleted. */
  | { readonly state: "foreign"; readonly detail: string }
  | { readonly state: "unknown"; readonly detail: string };

/**
 * Provider-specific MCP registration, behind one narrow interface.
 *
 * Each adapter owns its runtime's exact CLI syntax; the installer core owns
 * selection, collision policy and partial-failure behaviour, so there is no
 * provider conditional spread through the planner or the terminal layer.
 */
export interface ProviderMcpRegistrar {
  readonly target: InstallationTarget;
  /** Detects the runtime without inferring availability from config files. */
  detect(home?: string): Promise<HostAvailability>;
  inspect(
    launcher: SynaphexLauncher,
    home?: string,
  ): Promise<RegistrationInspection>;
  register(launcher: SynaphexLauncher, home?: string): Promise<void>;
  unregister(home?: string): Promise<void>;
}
