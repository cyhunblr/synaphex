import {
  InvalidRuleError,
  InvalidRuleValueError,
} from "../domain/errors.js";
import type { ProjectId } from "../domain/project.js";
import {
  formatRuleKey,
  isRuleDecision,
  type EffectiveRule,
  type RuleDecision,
  type RuleKey,
  type RuleScope,
  type ScopedRule,
} from "../domain/rule.js";
import type { TaskId } from "../domain/task.js";
import { StateStore } from "../infrastructure/state-store.js";
import { ProjectManager } from "./project-manager.js";
import { projectStateDirectory } from "./project-state-path.js";
import { RoleContractRegistry } from "./role-contract-registry.js";
import {
  ensureGlobalRuleState,
  getDocumentDecision,
  GLOBAL_RULES_PATH,
  listDocumentRules,
  readRuleDocument,
  validateRuleKey,
  withRule,
  withoutRule,
  type RuleDocument,
} from "./rule-store.js";
import { TaskManager } from "./task-manager.js";

export interface RuleResolutionContext {
  readonly projectId?: ProjectId;
  readonly taskId?: TaskId;
}

interface ScopedDocument {
  readonly scope: RuleScope;
  readonly document: RuleDocument;
}

export class RuleResolver {
  constructor(
    private readonly stateStore: StateStore,
    private readonly projectManager: ProjectManager,
    private readonly taskManager: TaskManager,
    private readonly roleContracts: RoleContractRegistry =
      new RoleContractRegistry(),
  ) {}

  async setRule(
    scope: RuleScope,
    key: RuleKey,
    decision: RuleDecision,
    context: RuleResolutionContext = {},
  ): Promise<void> {
    validateScope(scope);
    validateRuleKey(key);
    if (!isRuleDecision(decision)) {
      throw new InvalidRuleValueError(decision);
    }
    this.roleContracts.assertConfigurableRuleAllowed(key, decision);

    await ensureGlobalRuleState(this.stateStore);
    const path = await this.rulePath(scope, context);
    const document = await readRuleDocument(this.stateStore, path);
    await this.stateStore.writeJson(path, withRule(document, key, decision));
  }

  async removeRule(
    scope: RuleScope,
    key: RuleKey,
    context: RuleResolutionContext = {},
  ): Promise<void> {
    validateScope(scope);
    validateRuleKey(key);
    await ensureGlobalRuleState(this.stateStore);
    const path = await this.rulePath(scope, context);
    const document = await readRuleDocument(this.stateStore, path);
    await this.stateStore.writeJson(path, withoutRule(document, key));
  }

  async resolveRule(
    key: RuleKey,
    context: RuleResolutionContext = {},
  ): Promise<EffectiveRule> {
    validateRuleKey(key);
    const documents = await this.loadAvailableDocuments(context);
    for (const { scope, document } of [...documents].reverse()) {
      const decision = getDocumentDecision(document, key);
      if (decision !== undefined) {
        return { key, decision, source: scope };
      }
    }
    return { key, decision: "deny", source: "default_deny" };
  }

  async resolveRuleReadOnly(
    key: RuleKey,
    context: RuleResolutionContext = {},
  ): Promise<EffectiveRule> {
    validateRuleKey(key);
    const documents = await this.loadAvailableDocuments(context, false);
    for (const { scope, document } of [...documents].reverse()) {
      const decision = getDocumentDecision(document, key);
      if (decision !== undefined) {
        return { key, decision, source: scope };
      }
    }
    return { key, decision: "deny", source: "default_deny" };
  }

  async listRules(
    scope: RuleScope,
    context: RuleResolutionContext = {},
  ): Promise<ScopedRule[]> {
    validateScope(scope);
    await ensureGlobalRuleState(this.stateStore);
    const path = await this.rulePath(scope, context);
    return listDocumentRules(await readRuleDocument(this.stateStore, path));
  }

  async listEffectiveRules(
    context: RuleResolutionContext = {},
  ): Promise<EffectiveRule[]> {
    const documents = await this.loadAvailableDocuments(context);
    const effectiveRules = new Map<string, EffectiveRule>();
    for (const { scope, document } of documents) {
      for (const rule of listDocumentRules(document)) {
        effectiveRules.set(formatRuleKey(rule.key), { ...rule, source: scope });
      }
    }
    return [...effectiveRules.values()].sort((left, right) =>
      formatRuleKey(left.key).localeCompare(formatRuleKey(right.key)),
    );
  }

  async listEffectiveRulesReadOnly(
    context: RuleResolutionContext = {},
  ): Promise<EffectiveRule[]> {
    const documents = await this.loadAvailableDocuments(context, false);
    const effectiveRules = new Map<string, EffectiveRule>();
    for (const { scope, document } of documents) {
      for (const rule of listDocumentRules(document)) {
        effectiveRules.set(formatRuleKey(rule.key), { ...rule, source: scope });
      }
    }
    return [...effectiveRules.values()].sort((left, right) =>
      formatRuleKey(left.key).localeCompare(formatRuleKey(right.key)),
    );
  }

  private async loadAvailableDocuments(
    context: RuleResolutionContext,
    initialize = true,
  ): Promise<ScopedDocument[]> {
    if (initialize) {
      await ensureGlobalRuleState(this.stateStore);
    }
    const documents: ScopedDocument[] = [
      {
        scope: "global",
        document: await readRuleDocument(this.stateStore, GLOBAL_RULES_PATH),
      },
    ];

    if (context.projectId !== undefined) {
      documents.push({
        scope: "project",
        document: await readRuleDocument(
          this.stateStore,
          await this.rulePath("project", context),
        ),
      });
    }
    if (context.taskId !== undefined) {
      documents.push({
        scope: "task",
        document: await readRuleDocument(
          this.stateStore,
          await this.rulePath("task", context),
        ),
      });
    }
    return documents;
  }

  private async rulePath(
    scope: RuleScope,
    context: RuleResolutionContext,
  ): Promise<string> {
    if (scope === "global") {
      return GLOBAL_RULES_PATH;
    }
    if (context.projectId === undefined) {
      throw new InvalidRuleError(`${scope} scope requires a project context`);
    }
    if (scope === "project") {
      const project = await this.projectManager.get(context.projectId);
      return `${projectStateDirectory(project)}/rules.jsonc`;
    }
    if (context.taskId === undefined) {
      throw new InvalidRuleError("task scope requires a task context");
    }
    return `${await this.taskManager.getStateDirectory(context.projectId, context.taskId)}/rules.jsonc`;
  }
}

function validateScope(scope: string): asserts scope is RuleScope {
  if (scope !== "global" && scope !== "project" && scope !== "task") {
    throw new InvalidRuleError(`unknown rule scope: ${scope}`);
  }
}
