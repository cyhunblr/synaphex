import type { AgentConfigManager } from "../core/agent-config-manager.js";
import type { StateStore } from "../infrastructure/state-store.js";

export interface SynaphexStateInitializerDependencies {
  readonly stateStore: StateStore;
  readonly agentConfigs: Pick<AgentConfigManager, "getAllConfigs">;
}

export interface StateInitializationResult {
  readonly created: readonly string[];
  readonly preserved: boolean;
}

/**
 * Prepares Synaphex-owned local state under `~/.synaphex`.
 *
 * Reinstall-safe by construction: every managed file is created with an
 * exclusive atomic write, so an existing file is never overwritten and no user
 * value is ever rewritten. Nothing here touches provider configuration, and no
 * credential is written -- Synaphex never stores provider secrets.
 *
 * Registering a provider host deliberately does NOT configure any agent.
 * Provider host installation and logical agent configuration are separate
 * concerns: `agent_config.jsonc` stays authoritative, unconfigured agents stay
 * unconfigured, and no model is ever invented for an agent just because a host
 * became available.
 */
export class SynaphexStateInitializer {
  constructor(
    private readonly dependencies: SynaphexStateInitializerDependencies,
  ) {}

  async initialize(): Promise<StateInitializationResult> {
    const created: string[] = [];
    for (const directory of [
      "state",
      "projects",
      "state/task-bindings",
      "state/sessions",
    ]) {
      await this.dependencies.stateStore.ensureDirectory(directory);
    }
    // Touching the managers is enough: each lazily creates its own defaults
    // exclusively, so this both initializes and preserves.
    const existedBefore = await this.dependencies.stateStore.exists(
      "agent_config.jsonc",
    );
    await this.dependencies.agentConfigs.getAllConfigs();
    if (!existedBefore) {
      created.push("agent_config.jsonc");
    }
    return { created, preserved: existedBefore };
  }
}
