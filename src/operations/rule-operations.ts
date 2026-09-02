import { ProjectManager } from "../core/project-manager.js";
import { RoleContractRegistry } from "../core/role-contract-registry.js";
import {
  RuleResolver,
  type RuleResolutionContext,
} from "../core/rule-resolver.js";
import { SessionManager } from "../core/session-manager.js";
import { TaskManager } from "../core/task-manager.js";
import {
  NoProjectBoundError,
  NoTaskBoundError,
} from "../domain/errors.js";
import type {
  EffectiveRule,
  RuleDecision,
  RuleKey,
  RuleScope,
  RuleViewScope,
  ScopedRule,
} from "../domain/rule.js";
import type { SessionId } from "../domain/session.js";
import { StateStore } from "../infrastructure/state-store.js";

export interface RuleOperationsOptions {
  readonly synaphexRoot?: string;
  readonly homeDirectory?: string;
}

export class RuleOperations {
  private readonly sessionManager: SessionManager;
  private readonly resolver: RuleResolver;

  constructor(options: RuleOperationsOptions = {}) {
    const stateStore = new StateStore(options.synaphexRoot);
    const projectManager = new ProjectManager(stateStore, {
      ...(options.homeDirectory === undefined
        ? {}
        : { homeDirectory: options.homeDirectory }),
    });
    const taskManager = new TaskManager(stateStore, projectManager);
    this.sessionManager = new SessionManager(stateStore);
    this.resolver = new RuleResolver(
      stateStore,
      projectManager,
      taskManager,
      new RoleContractRegistry(),
    );
  }

  async setRule(
    sessionId: SessionId,
    scope: RuleScope,
    key: RuleKey,
    decision: RuleDecision,
  ): Promise<void> {
    const context = await this.contextForScope(sessionId, scope);
    await this.resolver.setRule(scope, key, decision, context);
  }

  async removeRule(
    sessionId: SessionId,
    scope: RuleScope,
    key: RuleKey,
  ): Promise<void> {
    const context = await this.contextForScope(sessionId, scope);
    await this.resolver.removeRule(scope, key, context);
  }

  async showRules(
    sessionId: SessionId,
    scope: "effective",
  ): Promise<EffectiveRule[]>;
  async showRules(
    sessionId: SessionId,
    scope: RuleScope,
  ): Promise<ScopedRule[]>;
  async showRules(
    sessionId: SessionId,
    scope: RuleViewScope,
  ): Promise<EffectiveRule[] | ScopedRule[]> {
    if (scope === "effective") {
      return this.resolver.listEffectiveRules(
        await this.effectiveContext(sessionId),
      );
    }
    return this.resolver.listRules(
      scope,
      await this.contextForScope(sessionId, scope),
    );
  }

  private async contextForScope(
    sessionId: SessionId,
    scope: RuleScope,
  ): Promise<RuleResolutionContext> {
    if (scope === "global") {
      return {};
    }

    const binding = await this.sessionManager.getCurrentBinding(sessionId);
    if (binding.projectId === null) {
      throw new NoProjectBoundError(sessionId);
    }
    if (scope === "task" && binding.taskId === null) {
      throw new NoTaskBoundError(sessionId);
    }

    return {
      projectId: binding.projectId,
      ...(binding.taskId === null ? {} : { taskId: binding.taskId }),
    };
  }

  private async effectiveContext(
    sessionId: SessionId,
  ): Promise<RuleResolutionContext> {
    const binding = await this.sessionManager.getCurrentBinding(sessionId);
    if (binding.projectId === null) {
      return {};
    }
    return {
      projectId: binding.projectId,
      ...(binding.taskId === null ? {} : { taskId: binding.taskId }),
    };
  }
}
