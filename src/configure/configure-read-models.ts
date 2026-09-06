import { createHash } from "node:crypto";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { AgentConfigManager } from "../core/agent-config-manager.js";
import { ProjectManager } from "../core/project-manager.js";
import { RoleContractRegistry } from "../core/role-contract-registry.js";
import { RuleResolver } from "../core/rule-resolver.js";
import { TaskManager } from "../core/task-manager.js";
import {
  EXECUTION_TARGET_CAPABILITIES,
  PROVIDER_CAPABILITY_CATALOG_VERSION,
  PROVIDER_INTEGRATION_CAPABILITIES,
  findExecutionTargetCapability,
  getProviderModelCapability,
} from "../core/provider-model-capability-registry.js";
import { AGENT_NAMES, type AgentName } from "../domain/agent.js";
import type { AgentProvider } from "../domain/agent-config.js";
import type {
  ExecutionTargetId,
  HostRegistrationObservation,
  HostSurfaceIdentity,
  ProviderRuntimeId,
  RuntimeObservation,
} from "../domain/provider-capability.js";
import type { ProjectId } from "../domain/project.js";
import type { TaskId } from "../domain/task.js";
import { RULE_DECISIONS, type RuleDecision, type RuleScope } from "../domain/rule.js";
import { StateStore } from "../infrastructure/state-store.js";
import {
  AGENT_BEHAVIOR_FILE,
  AGENT_CONFIG_FILE,
  GLOBAL_RULES_FILE,
} from "../installer/config-lifecycle.js";
import { InstallationManifestStore } from "../installer/installation-manifest.js";
import { INSTALLER_MINIMUM_VERSIONS } from "../installer/provider-runtime-versions.js";
import { AntigravityCliRuntimeAvailability } from "../providers/antigravity-cli-runtime-availability.js";
import { ClaudeCliRuntimeAvailability } from "../providers/claude-cli-runtime-availability.js";
import { CodexCliRuntimeAvailability } from "../providers/codex-cli-runtime-availability.js";

export interface ConfigureRuntimeProbes {
  readonly codex: Pick<CodexCliRuntimeAvailability, "probe">;
  readonly claude: Pick<ClaudeCliRuntimeAvailability, "probe">;
  readonly antigravity: Pick<AntigravityCliRuntimeAvailability, "probe">;
}

/**
 * Read models for the configure GUI.
 *
 * Every value here is derived from the same canonical services the rest of
 * Synaphex uses. This module deliberately holds no configuration of its own:
 * it is a projection, never an authority, so what the GUI shows cannot drift
 * from what an actual agent invocation would see.
 */

export const CONFIG_DOCUMENTS: readonly string[] = Object.freeze([
  AGENT_CONFIG_FILE,
  AGENT_BEHAVIOR_FILE,
  GLOBAL_RULES_FILE,
]);

export interface ConfigureReadDependencies {
  readonly synaphexRoot?: string;
  readonly homeDirectory?: string;
  /** Injectable only so deterministic diagnostics tests never run user CLIs. */
  readonly runtimeProbes?: Partial<ConfigureRuntimeProbes>;
}

export interface RuleScopeSelection {
  readonly scope: RuleScope;
  readonly projectId?: ProjectId;
  readonly taskId?: TaskId;
}

export class ConfigureReadModels {
  readonly stateStore: StateStore;
  readonly agentConfigs: AgentConfigManager;
  readonly projects: ProjectManager;
  readonly tasks: TaskManager;
  readonly rules: RuleResolver;
  readonly contracts = new RoleContractRegistry();
  private readonly manifest: InstallationManifestStore;
  private readonly runtimeProbes: ConfigureRuntimeProbes;

  constructor(dependencies: ConfigureReadDependencies = {}) {
    this.stateStore = new StateStore(dependencies.synaphexRoot);
    this.agentConfigs = new AgentConfigManager(this.stateStore);
    this.projects = new ProjectManager(this.stateStore, {
      ...(dependencies.homeDirectory === undefined
        ? {}
        : { homeDirectory: dependencies.homeDirectory }),
    });
    this.tasks = new TaskManager(this.stateStore, this.projects);
    this.rules = new RuleResolver(this.stateStore, this.projects, this.tasks);
    this.manifest = new InstallationManifestStore(this.stateStore);
    this.runtimeProbes = {
      codex:
        dependencies.runtimeProbes?.codex ??
        new CodexCliRuntimeAvailability(),
      claude:
        dependencies.runtimeProbes?.claude ??
        new ClaudeCliRuntimeAvailability(),
      antigravity:
        dependencies.runtimeProbes?.antigravity ??
        new AntigravityCliRuntimeAvailability(),
    };
  }

  /**
   * A content identity for the canonical documents.
   *
   * The GUI echoes this back when saving, so a write cannot silently clobber a
   * change made by another configure instance or by hand-editing the files.
   */
  async configVersion(): Promise<string> {
    const digest = createHash("sha256");
    for (const document of CONFIG_DOCUMENTS) {
      digest.update(document);
      digest.update("\0");
      digest.update((await this.stateStore.readText(document)) ?? "");
      digest.update("\0");
    }
    return digest.digest("hex").slice(0, 32);
  }

  async agents(): Promise<AgentReadModel[]> {
    const configs = await this.agentConfigs.getAllConfigs();
    return AGENT_NAMES.map((agent) => {
      const config = configs[agent];
      const snapshot = this.contracts.getSnapshot(agent);
      const lifecycle = this.contracts.getInvocationLifecycleContract(agent);
      const configured = config.status === "configured";
      return {
        agent,
        status: config.status,
        ...(config.status === "configured"
          ? {
              provider: config.provider,
              surface: config.surface,
              model: config.model,
              ...(config.settings === undefined
                ? {}
                : { settings: config.settings }),
            }
          : {}),
        ...(config.status === "removed"
          ? { previousProvider: config.previousProvider }
          : {}),
        executable:
          configured &&
          config.status === "configured" &&
          findExecutionTargetCapability(config.provider, config.surface)
            ?.support === "supported" &&
          getProviderModelCapability(
            config.provider,
            config.surface,
            config.model,
          ) !== undefined,
        contract: {
          mayModifySourceCode: snapshot.mayModifySourceCode,
          mayWriteCanonicalMemory: snapshot.mayWriteCanonicalMemory,
          forbiddenOutgoingTargets: [...snapshot.forbiddenOutgoingTargets],
          taskBinding: lifecycle.taskBinding,
          allowedTaskStatuses: [...lifecycle.allowedTaskStatuses],
        },
      };
    });
  }

  /** UI-safe projection of the same registry used by config validation. */
  modelCapabilities(): ModelCapabilityCatalogReadModel {
    return {
      catalogVersion: PROVIDER_CAPABILITY_CATALOG_VERSION,
      targets: EXECUTION_TARGET_CAPABILITIES.map((target) => ({
        id: target.id,
        provider: target.provider,
        label: target.label,
        runtime: target.runtime,
        persistedSurface: target.persistedSurface,
        support: target.support,
        executionPolicy: { ...target.executionPolicy },
        ...(target.unavailableReason === undefined
          ? {}
          : { unavailableReason: target.unavailableReason }),
        models: target.models.map((model) => ({
          id: model.id,
          label: model.label,
          supportTier: model.supportTier,
          settings: model.settings.map((setting) => ({
            key: setting.key,
            label: setting.label,
            description: setting.description,
            scope: setting.scope,
            type: setting.type,
            values: setting.values.map((value) => ({ ...value })),
            required: setting.required,
            omission: setting.omission,
          })),
        })),
      })),
    };
  }

  /**
   * Every directed agent-to-agent edge with both its immutable contract
   * verdict and its effective rule decision resolved through the real
   * precedence chain. Direction matters: caller to target is not symmetric.
   */
  async edges(selection: RuleScopeSelection): Promise<EdgeReadModel[]> {
    const context = scopeContext(selection);
    const edges: EdgeReadModel[] = [];
    for (const caller of AGENT_NAMES) {
      for (const target of AGENT_NAMES) {
        if (caller === target) {
          continue;
        }
        const evaluation = this.contracts.evaluateAgentCall(caller, target);
        const effective = await this.rules.resolveRuleReadOnly(
          { kind: "agent_call", caller, target },
          context,
        );
        edges.push({
          caller,
          target,
          immutable:
            !evaluation.allowed && evaluation.reason === "forbidden_edge",
          contractReason: evaluation.reason,
          decision: effective.decision,
          source: effective.source,
        });
      }
    }
    return edges;
  }

  /** Overrides recorded at one scope, distinct from what is inherited. */
  async scopeOverrides(
    selection: RuleScopeSelection,
  ): Promise<OverrideReadModel[]> {
    const scoped = await this.rules.listRules(
      selection.scope,
      scopeContext(selection),
    );
    return scoped.map((rule) => ({
      key:
        rule.key.kind === "agent_call"
          ? {
              kind: "agent_call" as const,
              caller: rule.key.caller,
              target: rule.key.target,
            }
          : { kind: "action" as const, action: rule.key.action },
      decision: rule.decision,
    }));
  }

  async projectsAndTasks(): Promise<ProjectReadModel[]> {
    const projects = await this.projects.list();
    const models: ProjectReadModel[] = [];
    for (const project of projects) {
      const [open, archived] = await Promise.all([
        this.tasks.listOpen(project.id),
        this.tasks.listArchived(project.id),
      ]);
      models.push({
        id: project.id,
        name: project.name,
        sourcePath: project.sourcePath,
        tasks: [...open, ...archived].map((task) => ({
          id: task.id,
          description: task.description,
          status: task.status,
        })),
      });
    }
    return models;
  }

  /**
   * Static runtime and registration diagnostics.
   *
   * Deliberately probe-only: presence, version and registration shape. No
   * model request is made, so "available" never costs the user a provider call
   * and never touches authentication.
   */
  async diagnostics(): Promise<DiagnosticsReadModel> {
    const manifest = await this.manifest.read();
    const registered = new Set<string>(
      manifest.entries.map((entry) => entry.provider),
    );

    const [codex, claude, antigravity] = await Promise.all([
      this.runtimeProbes.codex.probe(),
      this.runtimeProbes.claude.probe(),
      this.runtimeProbes.antigravity.probe(),
    ]);

    return {
      platform: platform(),
      nodeVersion: process.version,
      providers: PROVIDER_INTEGRATION_CAPABILITIES.map((integration) => {
        const observation = {
          openai: codex,
          anthropic: claude,
          google: antigravity,
        }[integration.provider];
        return {
          provider: integration.provider,
          runtime: {
            id: integration.runtime,
            installed: observation.available,
            ...(observation.version === undefined
              ? {}
              : { version: observation.version }),
          },
          hostIntegration: {
            support: "supported" as const,
            registrationMinimum: INSTALLER_MINIMUM_VERSIONS[integration.provider],
            registration: {
              state: registered.has(integration.provider)
                ? ("recorded" as const)
                : ("not_recorded" as const),
              source: "installation_manifest" as const,
            },
            surfaces: integration.hostSurfaces.map((surface) => ({
              id: surface.id,
              label: surface.label,
              surface: surface.surface,
              detection: surface.detection,
              callableTarget: surface.callableTarget,
            })),
          },
          executionTargets: integration.executionTargets.map((target) => ({
            id: target.id,
            label: target.label,
            support: target.support,
            executionPolicySupport:
              target.support === "supported"
                ? ("supported" as const)
                : ("unavailable" as const),
            targetRuntimeReadiness:
              target.support === "supported" && observation.available
                ? ("ready" as const)
                : ("unavailable" as const),
            ...(target.unavailableReason === undefined
              ? {}
              : { unavailableReason: target.unavailableReason }),
          })),
        };
      }),
    };
  }

  /** Read-only rendering of the canonical documents, exactly as stored. */
  async configPreview(): Promise<ConfigPreviewReadModel> {
    const documents: ConfigDocumentPreview[] = [];
    for (const document of CONFIG_DOCUMENTS) {
      documents.push({
        file: document,
        path: join(homedir(), ".synaphex", document),
        content: (await this.stateStore.readText(document)) ?? null,
      });
    }
    return { documents, configVersion: await this.configVersion() };
  }

  async status(): Promise<StatusReadModel> {
    // Sequenced deliberately: reading agents can lazily seed the canonical
    // config document, so hashing concurrently would capture a pre-seed
    // version and make the very next save look stale.
    const agents = await this.agents();
    const diagnostics = await this.diagnostics();
    const configVersion = await this.configVersion();
    return {
      agents: agents.length,
      configured: agents.filter((agent) => agent.status === "configured").length,
      unconfigured: agents.filter((agent) => agent.status === "unconfigured")
        .length,
      executableAgentConfigurations: agents.filter((agent) => agent.executable).length,
      providers: diagnostics.providers.length,
      hostRegistrationsRecorded: diagnostics.providers.filter(
        (provider) => provider.hostIntegration.registration.state === "recorded",
      ).length,
      configVersion,
      decisions: [...RULE_DECISIONS],
    };
  }
}

function scopeContext(selection: RuleScopeSelection): {
  projectId?: ProjectId;
  taskId?: TaskId;
} {
  return {
    ...(selection.projectId === undefined
      ? {}
      : { projectId: selection.projectId }),
    ...(selection.taskId === undefined ? {} : { taskId: selection.taskId }),
  };
}

export interface AgentReadModel {
  readonly agent: AgentName;
  readonly status: "configured" | "unconfigured" | "removed";
  readonly provider?: AgentProvider;
  readonly surface?: string;
  readonly model?: string;
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly previousProvider?: AgentProvider;
  readonly executable: boolean;
  readonly contract: {
    readonly mayModifySourceCode: boolean;
    readonly mayWriteCanonicalMemory: boolean;
    readonly forbiddenOutgoingTargets: readonly string[];
    readonly taskBinding: string;
    readonly allowedTaskStatuses: readonly string[];
  };
}

export interface ModelCapabilityCatalogReadModel {
  readonly catalogVersion: number;
  readonly targets: readonly {
    readonly id: string;
    readonly provider: AgentProvider;
    readonly label: string;
    readonly runtime: string;
    readonly persistedSurface: "cli";
    readonly support: "supported" | "unavailable";
    readonly executionPolicy: {
      readonly sourceModification: "invocation_scoped" | "unavailable";
      readonly network: "invocation_scoped" | "unavailable";
      readonly toolRestrictions: "invocation_scoped" | "unavailable";
    };
    readonly unavailableReason?: string;
    readonly models: readonly {
      readonly id: string;
      readonly label: string;
      readonly supportTier: "recommended" | "supported";
      readonly settings: readonly {
        readonly key: string;
        readonly label: string;
        readonly description: string;
        readonly scope: "target" | "model";
        readonly type: "enum";
        readonly values: readonly { readonly value: string; readonly label: string }[];
        readonly required: false;
        readonly omission: "provider_native";
      }[];
    }[];
  }[];
}

export interface EdgeReadModel {
  readonly caller: AgentName;
  readonly target: AgentName;
  readonly immutable: boolean;
  readonly contractReason: string;
  readonly decision: RuleDecision;
  readonly source: string;
}

export type OverrideKey =
  | { readonly kind: "agent_call"; readonly caller: string; readonly target: string }
  | { readonly kind: "action"; readonly action: string };

export interface OverrideReadModel {
  readonly key: OverrideKey;
  readonly decision: RuleDecision;
}

export interface ProjectReadModel {
  readonly id: string;
  readonly name: string;
  readonly sourcePath: string;
  readonly tasks: readonly {
    readonly id: string;
    readonly description: string;
    readonly status: string;
  }[];
}

export interface ProviderDiagnostic {
  readonly provider: AgentProvider;
  readonly runtime: Omit<RuntimeObservation, "runtime"> & {
    readonly id: ProviderRuntimeId;
  };
  readonly hostIntegration: {
    readonly support: "supported";
    readonly registrationMinimum: string;
    readonly registration: HostRegistrationObservation;
    readonly surfaces: readonly {
      readonly id: HostSurfaceIdentity;
      readonly label: string;
      readonly surface: string;
      readonly detection: string;
      readonly callableTarget: false;
    }[];
  };
  readonly executionTargets: readonly {
    readonly id: ExecutionTargetId;
    readonly label: string;
    readonly support: "supported" | "unavailable";
    readonly executionPolicySupport: "supported" | "unavailable";
    readonly targetRuntimeReadiness: "ready" | "unavailable";
    readonly unavailableReason?: string;
  }[];
}

export interface DiagnosticsReadModel {
  readonly platform: string;
  readonly nodeVersion: string;
  readonly providers: readonly ProviderDiagnostic[];
}

export interface ConfigDocumentPreview {
  readonly file: string;
  readonly path: string;
  readonly content: string | null;
}

export interface ConfigPreviewReadModel {
  readonly documents: readonly ConfigDocumentPreview[];
  readonly configVersion: string;
}

export interface StatusReadModel {
  readonly agents: number;
  readonly configured: number;
  readonly unconfigured: number;
  readonly executableAgentConfigurations: number;
  readonly providers: number;
  readonly hostRegistrationsRecorded: number;
  readonly configVersion: string;
  readonly decisions: readonly RuleDecision[];
}
