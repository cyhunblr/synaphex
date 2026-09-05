import type { AgentInvocationService } from "../core/agent-invocation-service.js";
import type { AgentName } from "../domain/agent.js";
import type {
  AnyAgentInvocationResult,
  HelperExecutionResult,
} from "../domain/agent-invocation.js";
import { UnsupportedAgentInvocationError } from "../domain/errors.js";
import type { McpHostContext } from "../domain/provider-routing.js";
import type { SessionId } from "../domain/session.js";
import { isMcpContinuationHelperAgent } from "./direct-agent-invocation.js";
import {
  ContinuationStateError,
  InvocationContinuationStore,
  isActionableNetworkApproval,
  isContinuableAllowedNetwork,
  type ContinuationId,
  type ContinuationRecord,
} from "./invocation-continuation-store.js";

/**
 * Narrow application boundary owning continuation business logic.
 *
 * MCP handlers never see the continuation Map: they validate the wire shape,
 * make one call here, and map the result. This layer owns trusted record
 * lookup, state-transition validation, calls into the existing
 * AgentInvocationService continuation APIs, record consumption and new
 * continuation issuance.
 *
 * Trust model: these are explicit user-approval surfaces ONLY under the
 * accepted Phase-3A local-stdio assumption that a top-level tool call is a
 * direct local user action. Before any remote MCP transport, caller
 * authentication and approval provenance must be redesigned and reviewed.
 */
export interface ContinuationOutcome {
  /** The invocation produced by this continuation step. */
  readonly invocation: AnyAgentInvocationResult;
  /** Set when a helper ran and the caller may now be explicitly resumed. */
  readonly callerResumeReady: boolean;
  /** Handle for the next explicit step, or null when nothing is actionable. */
  readonly continuationId: ContinuationId | null;
}

export interface InvocationContinuationPort {
  /**
   * Issues a handle for a completed invocation, or `null` when no request is
   * actionable through a continuation tool.
   */
  issueFor(
    sessionId: SessionId,
    invocation: AnyAgentInvocationResult,
  ): ContinuationId | null;
  executeAllowedHelper(
    continuationId: string,
    requestIndex: number,
  ): Promise<ContinuationOutcome>;
  approveAndExecuteHelper(
    continuationId: string,
    requestIndex: number,
  ): Promise<ContinuationOutcome>;
  resumeCaller(continuationId: string): Promise<ContinuationOutcome>;
  approveNetworkAction(
    continuationId: string,
    requestIndex: number,
  ): Promise<ContinuationOutcome>;
  continueAllowedNetwork(
    continuationId: string,
    requestIndex: number,
  ): Promise<ContinuationOutcome>;
}

export interface InvocationContinuationDependencies {
  /** Immutable, process-bound host identity. Never supplied per request. */
  readonly host: McpHostContext;
  readonly invocations: Pick<
    AgentInvocationService,
    | "executeHelper"
    | "resumeCaller"
    | "resumeCallerWithActionApproval"
    | "resumeCallerWithAllowedAction"
  >;
  readonly store: InvocationContinuationStore;
  readonly roleContracts: {
    canModifySourceCode(agent: AgentName): boolean;
  };
}

export class InvocationContinuationCommands
  implements InvocationContinuationPort
{
  constructor(
    private readonly dependencies: InvocationContinuationDependencies,
  ) {}

  issueFor(
    sessionId: SessionId,
    invocation: AnyAgentInvocationResult,
  ): ContinuationId | null {
    const record = this.dependencies.store.issue({
      host: this.dependencies.host,
      sessionId,
      invocation,
    });
    return record?.id ?? null;
  }

  /**
   * Executes a helper whose SERVER-SIDE classification is `allowed`.
   *
   * Calling this tool is explicit orchestration, not approval: it cannot
   * progress an `approval_required` edge, and the trusted classification wins
   * over anything the client believes.
   */
  async executeAllowedHelper(
    continuationId: string,
    requestIndex: number,
  ): Promise<ContinuationOutcome> {
    return this.runHelper(continuationId, requestIndex, false);
  }

  /**
   * Approves and executes ONE helper whose server-side classification is
   * `approval_required`, using the existing ephemeral approval semantics.
   *
   * The tool call itself is the one-time, invocation-scoped approval event. No
   * rule is mutated from `ask` to `allow`, and there is deliberately no
   * `rememberApproval` / `alwaysAllow` / `changeRule` option.
   */
  async approveAndExecuteHelper(
    continuationId: string,
    requestIndex: number,
  ): Promise<ContinuationOutcome> {
    return this.runHelper(continuationId, requestIndex, true);
  }

  private async runHelper(
    continuationId: string,
    requestIndex: number,
    approvalGranted: boolean,
  ): Promise<ContinuationOutcome> {
    const record = this.dependencies.store.require(
      continuationId,
      this.dependencies.host,
    );
    if (record.state !== "origin_pending") {
      throw new ContinuationStateError(
        "a helper has already been executed for this continuation",
      );
    }
    const classification = requireIndexed(
      record.helperRequests,
      requestIndex,
      "helper request",
    );
    if (record.executedHelperIndexes.includes(requestIndex)) {
      throw new ContinuationStateError("this helper request already executed");
    }

    // Server-side classification is authoritative. Denied, forbidden and
    // unavailable requests can never be progressed, whatever index is sent.
    const expected = approvalGranted ? "approval_required" : "allowed";
    if (classification.status !== expected) {
      throw new ContinuationStateError(
        `helper request is classified ${classification.status}, not ${expected}`,
      );
    }

    const target = classification.request.target;
    // Defence in depth beyond the normal helper permission classification: a
    // continuation handle must never become a route to a workspace-write
    // helper. If an agent requests CODER (or any source-mutating role) and the
    // edge somehow classifies allowed, MCP still refuses -- no CODER source
    // mutation through a helper loophole.
    // The HELPER set, not the direct set: a user may explicitly invoke staged
    // CODER, but an agent must not smuggle CODER through a continuation.
    if (
      !isMcpContinuationHelperAgent(target) ||
      this.dependencies.roleContracts.canModifySourceCode(target)
    ) {
      throw new UnsupportedAgentInvocationError(
        target,
        "helper_source_modification_not_permitted",
      );
    }

    const helperExecution = await this.dependencies.invocations.executeHelper({
      sessionId: record.sessionId,
      parentInvocation: record.invocation,
      helperClassification: classification,
      host: this.dependencies.host,
      ...(approvalGranted ? { approvalGranted: true } : {}),
    });

    // The helper ran: mark it consumed so it cannot execute twice, and keep the
    // record so the caller can be resumed EXPLICITLY. The caller is never
    // auto-resumed, and nested helper requests are never auto-executed.
    const updated = this.dependencies.store.markHelperCompleted(
      record.id,
      requestIndex,
      helperExecution,
    );
    return {
      invocation: helperExecution.helperInvocation,
      callerResumeReady: true,
      continuationId: updated.id,
    };
  }

  /**
   * Explicitly resumes the original caller after a helper completed.
   *
   * A fresh execution with a continuation handoff -- no provider thread or
   * session reuse, and no resurrection of old authority. Task-bound resumes
   * therefore re-run binding preflight and capture/revalidate a fresh
   * ownership fence inside AgentInvocationService.
   */
  async resumeCaller(continuationId: string): Promise<ContinuationOutcome> {
    const record = this.dependencies.store.require(
      continuationId,
      this.dependencies.host,
    );
    const helperExecution = requireHelperCompleted(record);

    // `resumeCaller` returns the generic union; narrow it the same way Core
    // does for helper invocations.
    const invocation = (await this.dependencies.invocations.resumeCaller({
      sessionId: record.sessionId,
      helperExecution,
      host: this.dependencies.host,
    })) as AnyAgentInvocationResult;

    // Consume the old record only after a successful transition, then issue a
    // NEW handle if the resumed result is itself actionable. The consumed id
    // is never reused as authority for a new generation.
    this.dependencies.store.consume(record.id);
    return this.issueNext(record, invocation);
  }

  /**
   * Explicitly approves ONE `approval_required` provider-capability `network`
   * action and resumes the caller with a one-time, invocation-scoped grant.
   *
   * No rule mutation, no persistent provider-setting mutation, no automatic
   * approval. Host actions (`git_push`, `ci`) are not progressable here.
   */
  async approveNetworkAction(
    continuationId: string,
    requestIndex: number,
  ): Promise<ContinuationOutcome> {
    const record = this.dependencies.store.require(
      continuationId,
      this.dependencies.host,
    );
    if (record.state !== "origin_pending") {
      throw new ContinuationStateError(
        "this continuation has already progressed past its origin invocation",
      );
    }
    const classification = requireIndexed(
      record.actionRequests,
      requestIndex,
      "action request",
    );
    // Only network, only provider_capability, only approval_required. A client
    // cannot turn git_push into an approvable network action by index.
    if (!isActionableNetworkApproval(classification)) {
      throw new ContinuationStateError(
        "only an approval_required provider-capability network action can be approved",
      );
    }

    const invocation =
      (await this.dependencies.invocations.resumeCallerWithActionApproval({
        sessionId: record.sessionId,
        previousInvocation: record.invocation,
        actionClassification: classification,
        approvalGranted: true,
        host: this.dependencies.host,
      })) as AnyAgentInvocationResult;

    this.dependencies.store.consume(record.id);
    return this.issueNext(record, invocation);
  }

  /**
   * Continues a caller whose requested `network` capability was ALREADY
   * classified `allowed` by rule.
   *
   * No approval is granted or implied -- the capability was already permitted.
   * The continuation is nonetheless explicit: an allowed capability never
   * auto-resumes the caller.
   */
  async continueAllowedNetwork(
    continuationId: string,
    requestIndex: number,
  ): Promise<ContinuationOutcome> {
    const record = this.dependencies.store.require(
      continuationId,
      this.dependencies.host,
    );
    if (record.state !== "origin_pending") {
      throw new ContinuationStateError(
        "this continuation has already progressed past its origin invocation",
      );
    }
    const classification = requireIndexed(
      record.actionRequests,
      requestIndex,
      "action request",
    );
    // Only network, only provider_capability, only `allowed`. An
    // approval_required action must use the approval tool, and host actions
    // (git_push, ci) are never continuable here.
    if (!isContinuableAllowedNetwork(classification)) {
      throw new ContinuationStateError(
        "only an allowed provider-capability network action can be continued through this path",
      );
    }

    const invocation =
      (await this.dependencies.invocations.resumeCallerWithAllowedAction({
        sessionId: record.sessionId,
        previousInvocation: record.invocation,
        actionClassification: classification,
        host: this.dependencies.host,
      })) as AnyAgentInvocationResult;

    this.dependencies.store.consume(record.id);
    return this.issueNext(record, invocation);
  }

  /** Issues a fresh handle for a new invocation generation, if actionable. */
  private issueNext(
    previous: ContinuationRecord,
    invocation: AnyAgentInvocationResult,
  ): ContinuationOutcome {
    const next = this.dependencies.store.issue({
      host: this.dependencies.host,
      sessionId: previous.sessionId,
      invocation,
    });
    return {
      invocation,
      callerResumeReady: false,
      continuationId: next?.id ?? null,
    };
  }
}

function requireIndexed<T>(
  items: readonly T[],
  index: number,
  label: string,
): T {
  if (!Number.isSafeInteger(index) || index < 0 || index >= items.length) {
    throw new ContinuationStateError(`no such ${label}`);
  }
  return items[index]!;
}

function requireHelperCompleted(
  record: ContinuationRecord,
): HelperExecutionResult {
  if (record.state !== "helper_completed" || record.helperExecution === null) {
    throw new ContinuationStateError(
      "caller resume requires a completed helper execution",
    );
  }
  return record.helperExecution;
}
