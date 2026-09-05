import { AGENT_NAMES, isAgentName, type AgentName } from "../domain/agent.js";
import {
  AGENT_PROVIDERS,
  AGENT_SURFACES,
  type AgentProvider,
  type AgentSurface,
} from "../domain/agent-config.js";
import { InvalidAgentConfigError, InvalidRuleValueError } from "../domain/errors.js";
import type { ProjectId } from "../domain/project.js";
import {
  RULE_DECISIONS,
  RULE_SCOPES,
  type RuleDecision,
  type RuleScope,
} from "../domain/rule.js";
import type { TaskId } from "../domain/task.js";
import { ConfigLifecycle } from "../installer/config-lifecycle.js";
import type { ConfigureReadModels, RuleScopeSelection } from "./configure-read-models.js";

/**
 * The only mutation path the configure GUI has.
 *
 * Every write delegates to the same domain services the rest of Synaphex
 * uses, so the canonical parse/validate/preserve/render/atomic-replace
 * contract and the immutable role contracts are enforced once, in the place
 * that owns them. Nothing here touches the filesystem directly, and no
 * validation is reimplemented: a looser second validator would eventually
 * disagree with the authoritative one, which is exactly the drift the GUI
 * must not introduce.
 */

/** Raised when the on-disk configuration moved under an editing session. */
export class ConfigureStaleWriteError extends Error {
  readonly code = "CONFIGURE_STALE_WRITE" as const;
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      "The configuration changed on disk since this page loaded. Reload before saving.",
    );
    this.name = "ConfigureStaleWriteError";
  }
}

export interface AgentConfigWrite {
  readonly provider: string;
  readonly surface: string;
  readonly model: string;
}

export interface RuleWrite extends RuleScopeSelection {
  readonly caller: string;
  readonly target: string;
  /** `inherit` removes the override at this scope rather than being a decision. */
  readonly decision: RuleDecision | "inherit";
}

export class ConfigureWriteService {
  constructor(private readonly reads: ConfigureReadModels) {}

  /**
   * Re-renders the canonical documents after a mutation.
   *
   * The config managers persist values as plain JSON; the maintainer comments
   * and canonical formatting are produced by ConfigLifecycle, which normally
   * runs during `synaphex install`. Without this, editing through the GUI
   * would silently strip those comments from the user's files until their next
   * reinstall. Reusing the same lifecycle service keeps the
   * parse/validate/preserve/render/atomic-replace contract in one place.
   */
  private async renderCanonicalDocuments(): Promise<void> {
    await new ConfigLifecycle(this.reads.stateStore).apply();
  }

  /**
   * Rejects a write whose base version no longer matches disk.
   *
   * Two configure instances, or one instance plus a hand edit, would otherwise
   * race to last-write-wins. The caller must reload and re-decide.
   */
  private async assertFresh(expectedVersion: string): Promise<void> {
    const actual = await this.reads.configVersion();
    if (actual !== expectedVersion) {
      throw new ConfigureStaleWriteError(expectedVersion, actual);
    }
  }

  async setAgentConfig(
    agent: string,
    write: AgentConfigWrite,
    expectedVersion: string,
  ): Promise<void> {
    const name = parseAgent(agent);
    await this.assertFresh(expectedVersion);

    if (!(AGENT_PROVIDERS as readonly string[]).includes(write.provider)) {
      throw new InvalidAgentConfigError(name, "provider is not recognised");
    }
    if (!(AGENT_SURFACES as readonly string[]).includes(write.surface)) {
      throw new InvalidAgentConfigError(name, "surface is not recognised");
    }
    if (typeof write.model !== "string" || write.model.trim().length === 0) {
      throw new InvalidAgentConfigError(name, "model must not be empty");
    }

    // setConfigured runs the canonical capability validation and the atomic
    // config-document replace; no settings are forwarded because v0.1 accepts
    // none and the GUI must not widen that.
    await this.reads.agentConfigs.setConfigured(name, {
      provider: write.provider as AgentProvider,
      surface: write.surface as AgentSurface,
      model: write.model.trim(),
    });
    await this.renderCanonicalDocuments();
  }

  async clearAgentConfig(agent: string, expectedVersion: string): Promise<void> {
    const name = parseAgent(agent);
    await this.assertFresh(expectedVersion);
    await this.reads.agentConfigs.markUnconfigured(name);
    await this.renderCanonicalDocuments();
  }

  /**
   * Sets or clears one agent-call rule at one scope.
   *
   * `RuleResolver.setRule` asserts the immutable role contract before writing,
   * so an attempt to allow a forbidden edge is refused by the same code path
   * that protects every other caller.
   */
  async setRule(write: RuleWrite, expectedVersion: string): Promise<void> {
    const caller = parseAgent(write.caller);
    const target = parseAgent(write.target);
    if (!(RULE_SCOPES as readonly string[]).includes(write.scope)) {
      throw new InvalidRuleValueError("scope is not recognised");
    }
    await this.assertFresh(expectedVersion);

    const key = { kind: "agent_call", caller, target } as const;
    const context = {
      ...(write.projectId === undefined ? {} : { projectId: write.projectId }),
      ...(write.taskId === undefined ? {} : { taskId: write.taskId }),
    };

    if (write.decision === "inherit") {
      await this.reads.rules.removeRule(write.scope as RuleScope, key, context);
      await this.renderCanonicalDocuments();
      return;
    }
    if (!(RULE_DECISIONS as readonly string[]).includes(write.decision)) {
      throw new InvalidRuleValueError("decision is not recognised");
    }
    await this.reads.rules.setRule(
      write.scope as RuleScope,
      key,
      write.decision,
      context,
    );
    await this.renderCanonicalDocuments();
  }
}

function parseAgent(value: string): AgentName {
  if (!isAgentName(value)) {
    throw new InvalidAgentConfigError(
      AGENT_NAMES[0],
      `agent is not recognised: ${String(value).slice(0, 40)}`,
    );
  }
  return value;
}

export type { ProjectId, TaskId };
