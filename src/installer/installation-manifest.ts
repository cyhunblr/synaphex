import type { InstallationTarget } from "../domain/installation.js";
import type { StateStore } from "../infrastructure/state-store.js";

const MANIFEST_PATH = "state/installation.json";

export interface ManifestEntry {
  readonly provider: InstallationTarget["provider"];
  /**
   * Present only on records written before host identity became
   * provider-only. Kept readable for migration; never authority.
   */
  readonly surface?: string;
  readonly registrationName: string;
  /** The launcher argv that was registered, for drift diagnostics only. */
  readonly launcherCommand: string;
  readonly launcherArgs: readonly string[];
  readonly configuredAt: string;
}

export interface InstallationManifest {
  readonly version: 1;
  readonly entries: readonly ManifestEntry[];
}

/**
 * Records which hosts Synaphex configured, so `uninstall` knows where to look
 * without asking the user to remember.
 *
 * Deliberately NOT authority for deletion. An entry here only says "we once
 * registered this host"; the external registration must still match the
 * Synaphex ownership fingerprint before anything is removed, so a manifest
 * that has gone stale can never cause a foreign server to be deleted.
 *
 * Contains no token, credential or provider secret -- only non-sensitive
 * installation metadata.
 */
export class InstallationManifestStore {
  constructor(private readonly stateStore: StateStore) {}

  async read(): Promise<InstallationManifest> {
    const value = await this.stateStore.readJson<unknown>(MANIFEST_PATH);
    if (
      value === null ||
      typeof value !== "object" ||
      (value as InstallationManifest).version !== 1 ||
      !Array.isArray((value as InstallationManifest).entries)
    ) {
      return { version: 1, entries: [] };
    }
    return value as InstallationManifest;
  }

  async record(entries: readonly ManifestEntry[]): Promise<void> {
    const existing = await this.read();
    const merged = new Map<string, ManifestEntry>();
    for (const entry of [...existing.entries, ...entries]) {
      merged.set(entry.provider, entry);
    }
    await this.stateStore.writeJson(MANIFEST_PATH, {
      version: 1,
      entries: [...merged.values()],
    } satisfies InstallationManifest);
  }

  async forget(targets: readonly InstallationTarget[]): Promise<void> {
    const removed = new Set(targets.map((t) => t.provider));
    const existing = await this.read();
    await this.stateStore.writeJson(MANIFEST_PATH, {
      version: 1,
      entries: existing.entries.filter(
        (entry) => !removed.has(entry.provider),
      ),
    } satisfies InstallationManifest);
  }
}
