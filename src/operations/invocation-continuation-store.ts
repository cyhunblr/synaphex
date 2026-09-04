import { randomBytes } from "node:crypto";
import type {
  ActionClassification,
  AnyAgentInvocationResult,
  HelperCallClassification,
  HelperExecutionResult,
} from "../domain/agent-invocation.js";
import type { HostRuntime } from "../domain/provider-routing.js";
import type { SessionId } from "../domain/session.js";

/**
 * Opaque, process-local continuation handle.
 *
 * NOT a SessionId and never passed through `parseSessionId`: a continuation is
 * an ephemeral in-memory reference, not persisted domain identity. It is
 * cryptographically random and derived from nothing -- not SessionId, lineage,
 * provider, agent, PID, MCP connection or conversation id.
 */
export type ContinuationId = `cont_${string}`;

export const CONTINUATION_ID_PREFIX = "cont_";

/**
 * Explicit continuation state machine.
 *
 * ```text
 * ORIGIN_PENDING
 *   |- execute allowed helper        -> HELPER_COMPLETED
 *   |- approve + execute asked helper -> HELPER_COMPLETED
 *   |- approve network action         -> CONSUMED (new record issued)
 *
 * HELPER_COMPLETED
 *   |- resume caller                  -> CONSUMED (new record issued)
 * ```
 *
 * Illegal transitions are rejected deterministically rather than documented:
 * resume before helper execution, executing the same helper twice, approving
 * the same action twice, and resuming twice all fail.
 */
export type ContinuationState = "origin_pending" | "helper_completed";

export class ContinuationNotFoundError extends Error {
  readonly code = "CONTINUATION_NOT_FOUND";
  constructor() {
    // Deliberately generic: a wrong, expired, consumed or restart-invalidated
    // handle are indistinguishable to the client.
    super("Continuation was not found");
    this.name = "ContinuationNotFoundError";
  }
}

export class ContinuationStateError extends Error {
  readonly code = "INVALID_CONTINUATION_STATE";
  constructor(reason: string) {
    super(`Invalid continuation state: ${reason}`);
    this.name = "ContinuationStateError";
  }
}

export class ContinuationCapacityError extends Error {
  readonly code = "CONTINUATION_CAPACITY_EXHAUSTED";
  constructor() {
    super("Too many pending continuations");
    this.name = "ContinuationCapacityError";
  }
}

/**
 * Trusted server-side continuation record.
 *
 * The MCP client receives only the opaque id and bounded request indexes; it
 * never resends request contents, classifications, lineage, route,
 * ExecutionPolicy or host identity as authority. Everything authoritative
 * lives here, having come from a previous trusted invocation result.
 *
 * Deliberately absent: ownership fencing tokens (task ownership is revalidated
 * by each fresh AgentInvocationService execution), provider credentials and
 * provider stderr.
 */
export interface ContinuationRecord {
  readonly id: ContinuationId;
  /** Immutable host identity this continuation was created under. */
  readonly host: HostRuntime;
  readonly sessionId: SessionId;
  readonly invocation: AnyAgentInvocationResult;
  /** Server-stored classified helper requests, addressed by index. */
  readonly helperRequests: readonly HelperCallClassification[];
  /** Server-stored classified action requests, addressed by index. */
  readonly actionRequests: readonly ActionClassification[];
  readonly state: ContinuationState;
  /** Indexes already executed; a second attempt is refused. */
  readonly executedHelperIndexes: readonly number[];
  /** Present once a helper has run, enabling explicit caller resume. */
  readonly helperExecution: HelperExecutionResult | null;
  readonly createdAt: string;
}

export interface InvocationContinuationStoreOptions {
  /**
   * Maximum simultaneously pending records. Bounded deliberately: an
   * unbounded Map would grow without limit on a long-lived local process.
   */
  readonly capacity?: number;
}

/**
 * Ephemeral, in-memory, process-local continuation store.
 *
 * ```text
 * Synaphex Session survives MCP restart.
 * Invocation continuation does not.
 * ```
 *
 * These lifetimes differ on purpose. Existing helper-approval and
 * provider-capability-approval semantics are already ephemeral, so nothing is
 * persisted to Synaphex state here, and there is no lease, heartbeat, TTL
 * expiry, background sweeper or durable invocation registry. If the MCP
 * process restarts, pending handles are lost and the user may repeat the
 * original invocation.
 *
 * This is NOT provider-process tracking, a cancellation registry, an async job
 * manager or an MCP tasks implementation.
 */
export class InvocationContinuationStore {
  private readonly records = new Map<ContinuationId, ContinuationRecord>();
  private readonly capacity: number;

  constructor(options: InvocationContinuationStoreOptions = {}) {
    this.capacity = options.capacity ?? 64;
    if (!Number.isSafeInteger(this.capacity) || this.capacity <= 0) {
      throw new RangeError("capacity must be a positive safe integer");
    }
  }

  get size(): number {
    return this.records.size;
  }

  /**
   * Stores one trusted record per originating invocation -- not one per
   * request -- and only when at least one request is actionable through a tool
   * implemented in this slice. Returns `null` when nothing is actionable, so
   * no record is allocated.
   */
  issue(input: {
    readonly host: HostRuntime;
    readonly sessionId: SessionId;
    readonly invocation: AnyAgentInvocationResult;
  }): ContinuationRecord | null {
    const helperRequests = [...input.invocation.helperCalls];
    const actionRequests = [...input.invocation.actionClassifications];
    if (!hasActionableRequest(helperRequests, actionRequests)) {
      return null;
    }
    if (this.records.size >= this.capacity) {
      // Never silently evict a still-pending user continuation.
      throw new ContinuationCapacityError();
    }
    const record: ContinuationRecord = {
      id: generateContinuationId(),
      host: { ...input.host },
      sessionId: input.sessionId,
      invocation: input.invocation,
      helperRequests,
      actionRequests,
      state: "origin_pending",
      executedHelperIndexes: [],
      helperExecution: null,
      createdAt: new Date().toISOString(),
    };
    this.records.set(record.id, record);
    return record;
  }

  /** Looks up a record, enforcing the host binding. */
  require(id: string, host: HostRuntime): ContinuationRecord {
    const record = this.records.get(id as ContinuationId);
    if (record === undefined) {
      throw new ContinuationNotFoundError();
    }
    if (
      record.host.provider !== host.provider ||
      record.host.surface !== host.surface
    ) {
      // A continuation created under one host must not be usable from another.
      throw new ContinuationNotFoundError();
    }
    return record;
  }

  /** Records a completed helper execution, enabling explicit caller resume. */
  markHelperCompleted(
    id: ContinuationId,
    helperIndex: number,
    helperExecution: HelperExecutionResult,
  ): ContinuationRecord {
    const existing = this.records.get(id);
    if (existing === undefined) {
      throw new ContinuationNotFoundError();
    }
    const updated: ContinuationRecord = {
      ...existing,
      state: "helper_completed",
      executedHelperIndexes: [...existing.executedHelperIndexes, helperIndex],
      helperExecution,
    };
    this.records.set(id, updated);
    return updated;
  }

  /** Removes a record once its continuation has been consumed. */
  consume(id: ContinuationId): void {
    this.records.delete(id);
  }
}

/**
 * Only `allowed` helpers, `approval_required` helpers, and
 * `approval_required` provider-capability `network` actions can be progressed
 * by the tools in this slice. Denied, forbidden and unavailable requests, and
 * host actions (`git_push`, `ci`), are reported but never actionable.
 */
export function hasActionableRequest(
  helperRequests: readonly HelperCallClassification[],
  actionRequests: readonly ActionClassification[],
): boolean {
  const helperActionable = helperRequests.some(
    (request) =>
      request.status === "allowed" || request.status === "approval_required",
  );
  const actionActionable = actionRequests.some(isActionableNetworkApproval);
  return helperActionable || actionActionable;
}

export function isActionableNetworkApproval(
  classification: ActionClassification,
): boolean {
  return (
    classification.status === "approval_required" &&
    classification.executionKind === "provider_capability" &&
    classification.request.action === "network"
  );
}

function generateContinuationId(): ContinuationId {
  return `${CONTINUATION_ID_PREFIX}${randomBytes(16).toString("hex")}`;
}
