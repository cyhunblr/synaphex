import assert from "node:assert/strict";
import test from "node:test";
import type {
  ActionClassification,
  AnyAgentInvocationResult,
  HelperCallClassification,
  HelperExecutionResult,
} from "../src/domain/agent-invocation.js";
import { UnsupportedAgentInvocationError } from "../src/domain/errors.js";
import type { HostRuntime } from "../src/domain/provider-routing.js";
import { RoleContractRegistry } from "../src/core/role-contract-registry.js";
import { InvocationContinuationCommands } from "../src/operations/invocation-continuation-commands.js";
import {
  ContinuationCapacityError,
  ContinuationNotFoundError,
  ContinuationStateError,
  InvocationContinuationStore,
} from "../src/operations/invocation-continuation-store.js";

const HOST: HostRuntime = { provider: "anthropic", surface: "vscode" };
const OTHER_HOST: HostRuntime = { provider: "openai", surface: "cli" };
const SESSION = "ses_00000000000000000000000000000001";

function helperClassification(
  status: HelperCallClassification["status"],
  target = "examiner",
): HelperCallClassification {
  const request = {
    target,
    purpose: "memory_update",
    handoff: {
      caller: "researcher",
      target,
      purpose: "memory_update",
      summary: "Record it.",
    },
  };
  if (status === "forbidden" || status === "unavailable") {
    return {
      status,
      request,
      immutableReason: "forbidden_edge",
      effectiveRule: null,
      ...(status === "unavailable" ? { errorCode: "INVALID_RULE" } : {}),
    } as unknown as HelperCallClassification;
  }
  return {
    status,
    request,
    immutableReason: "no_immutable_restriction",
    effectiveRule: {
      key: { kind: "agent_call", caller: "researcher", target },
      decision: status === "allowed" ? "allow" : "ask",
      source: "global",
    },
  } as unknown as HelperCallClassification;
}

function actionClassification(
  status: ActionClassification["status"],
  action = "network",
  executionKind = "provider_capability",
): ActionClassification {
  return {
    status,
    request: { action, reason: "Needed." },
    executionKind,
    effectiveRule:
      status === "unavailable"
        ? null
        : {
            key: { kind: "action", action },
            decision: status === "approval_required" ? "ask" : "allow",
            source: "project",
          },
    ...(status === "unavailable" ? { errorCode: "INVALID_RULE" } : {}),
  } as unknown as ActionClassification;
}

function invocationResult(
  helperCalls: readonly HelperCallClassification[] = [],
  actionClassifications: readonly ActionClassification[] = [],
): AnyAgentInvocationResult {
  return {
    agent: "researcher",
    lineage: {
      rootInvocationId: "invocation_root",
      currentInvocationId: "invocation_root",
      parentInvocationId: null,
    },
    scope: { sessionId: SESSION, projectId: "prj_x", taskId: "task_x" },
    route: {
      agent: "researcher",
      host: HOST,
      provider: "openai",
      configuredSurface: "cli",
      effectiveSurface: "cli",
      cliForcedByCrossProvider: true,
      routingReason: "cross_provider_cli",
      model: "m",
    },
    executionPolicy: {
      sourceModification: "read_only",
      providerCapabilities: {
        network: {
          decision: "ask",
          source: "project",
          approvedForInvocation: false,
        },
      },
    },
    processedResult: {
      agent: "researcher",
      outcome: "success",
      summary: "done",
      warnings: [],
      persistedArtifacts: [],
      requestedCalls: [],
      requestedActions: [],
      stateEffects: [],
    },
    helperCalls,
    actionClassifications,
  } as unknown as AnyAgentInvocationResult;
}

interface Recorded {
  readonly api: string;
  readonly approvalGranted?: boolean;
  readonly host: HostRuntime;
}

class FakeInvocations {
  readonly calls: Recorded[] = [];
  helperFails = false;
  resumeFails = false;
  allowedFails = false;
  allowedResult: AnyAgentInvocationResult | null = null;

  async resumeCallerWithAllowedAction(request: {
    host: HostRuntime;
  }): Promise<AnyAgentInvocationResult> {
    this.calls.push({
      api: "resumeCallerWithAllowedAction",
      host: request.host,
    });
    if (this.allowedFails) {
      throw new Error("allowed continuation failed");
    }
    return this.allowedResult ?? invocationResult();
  }

  async executeHelper(request: {
    host: HostRuntime;
    approvalGranted?: boolean;
  }): Promise<HelperExecutionResult> {
    this.calls.push({
      api: "executeHelper",
      host: request.host,
      ...(request.approvalGranted === undefined
        ? {}
        : { approvalGranted: request.approvalGranted }),
    });
    if (this.helperFails) {
      throw new Error("provider spawn failed");
    }
    return {
      previousClassification: helperClassification("allowed"),
      effectiveClassification: helperClassification("allowed"),
      helperInvocation: invocationResult(),
      continuation: { originalCaller: "researcher" },
    } as unknown as HelperExecutionResult;
  }

  async resumeCaller(request: {
    host: HostRuntime;
  }): Promise<AnyAgentInvocationResult> {
    this.calls.push({ api: "resumeCaller", host: request.host });
    if (this.resumeFails) {
      throw new Error("resume failed");
    }
    return invocationResult();
  }

  async resumeCallerWithActionApproval(request: {
    host: HostRuntime;
    approvalGranted: boolean;
  }): Promise<AnyAgentInvocationResult> {
    this.calls.push({
      api: "resumeCallerWithActionApproval",
      host: request.host,
      approvalGranted: request.approvalGranted,
    });
    return invocationResult();
  }
}

interface Harness {
  readonly store: InvocationContinuationStore;
  readonly invocations: FakeInvocations;
  readonly commands: InvocationContinuationCommands;
}

function harness(capacity?: number): Harness {
  const store = new InvocationContinuationStore(
    capacity === undefined ? {} : { capacity },
  );
  const invocations = new FakeInvocations();
  return {
    store,
    invocations,
    commands: new InvocationContinuationCommands({
      host: HOST,
      invocations: invocations as never,
      store,
      roleContracts: new RoleContractRegistry(),
    }),
  };
}

// ---------------------------------------------------------------------------
// Store: issuance, capacity, host binding
// ---------------------------------------------------------------------------

test("a continuation id is opaque, prefixed, and derived from nothing identifying", () => {
  const h = harness();
  const ids = new Set<string>();
  for (let round = 0; round < 50; round += 1) {
    const record = h.store.issue({
      host: HOST,
      sessionId: SESSION,
      invocation: invocationResult([helperClassification("allowed")]),
    });
    assert.notEqual(record, null);
    assert.match(record!.id, /^cont_[0-9a-f]{32}$/);
    assert.equal(ids.has(record!.id), false);
    ids.add(record!.id);
    for (const forbidden of [
      SESSION,
      SESSION.replace("ses_", ""),
      "invocation_root",
      "researcher",
      "openai",
      "anthropic",
      String(process.pid),
    ]) {
      assert.equal(record!.id.includes(forbidden), false);
    }
    h.store.consume(record!.id);
  }
});

test("no record is allocated when nothing is actionable", () => {
  const h = harness();
  // Denied/forbidden/unavailable helpers and host actions are reported but
  // never actionable, so they allocate nothing.
  for (const invocation of [
    invocationResult(),
    invocationResult([helperClassification("denied")]),
    invocationResult([helperClassification("forbidden")]),
    invocationResult([helperClassification("unavailable")]),
    invocationResult([], [actionClassification("unavailable")]),
    // An `allowed` HOST action stays inert -- no executor exists.
    invocationResult([], [actionClassification("allowed", "git_push", "host_action")]),
    invocationResult([], [actionClassification("denied")]),
    // git_push is a host action, not a provider capability.
    invocationResult(
      [],
      [actionClassification("approval_required", "git_push", "host_action")],
    ),
  ]) {
    assert.equal(
      h.store.issue({ host: HOST, sessionId: SESSION, invocation }),
      null,
    );
  }
  assert.equal(h.store.size, 0);
});

test("one record is issued per invocation, not per request", () => {
  const h = harness();
  const record = h.store.issue({
    host: HOST,
    sessionId: SESSION,
    invocation: invocationResult(
      [helperClassification("allowed"), helperClassification("approval_required")],
      [actionClassification("approval_required")],
    ),
  });
  assert.notEqual(record, null);
  assert.equal(h.store.size, 1);
  assert.equal(record!.helperRequests.length, 2);
  assert.equal(record!.actionRequests.length, 1);
});

test("capacity is bounded and exhaustion fails rather than evicting", () => {
  const h = harness(3);
  const ids: string[] = [];
  for (let round = 0; round < 3; round += 1) {
    const record = h.store.issue({
      host: HOST,
      sessionId: SESSION,
      invocation: invocationResult([helperClassification("allowed")]),
    });
    ids.push(record!.id);
  }
  assert.throws(
    () =>
      h.store.issue({
        host: HOST,
        sessionId: SESSION,
        invocation: invocationResult([helperClassification("allowed")]),
      }),
    (error: unknown) => error instanceof ContinuationCapacityError,
  );
  // No still-pending user continuation was silently evicted.
  for (const id of ids) {
    assert.doesNotThrow(() => h.store.require(id, HOST));
  }
});

test("a continuation is bound to the host it was created under", () => {
  const h = harness();
  const record = h.store.issue({
    host: HOST,
    sessionId: SESSION,
    invocation: invocationResult([helperClassification("allowed")]),
  })!;
  assert.doesNotThrow(() => h.store.require(record.id, HOST));
  assert.throws(
    () => h.store.require(record.id, OTHER_HOST),
    (error: unknown) => error instanceof ContinuationNotFoundError,
  );
});

test("an unknown or consumed continuation is not found", () => {
  const h = harness();
  assert.throws(
    () => h.store.require("cont_deadbeef", HOST),
    (error: unknown) =>
      error instanceof ContinuationNotFoundError &&
      error.code === "CONTINUATION_NOT_FOUND",
  );
  const record = h.store.issue({
    host: HOST,
    sessionId: SESSION,
    invocation: invocationResult([helperClassification("allowed")]),
  })!;
  h.store.consume(record.id);
  assert.throws(
    () => h.store.require(record.id, HOST),
    (error: unknown) => error instanceof ContinuationNotFoundError,
  );
});

// ---------------------------------------------------------------------------
// Allowed helper flow
// ---------------------------------------------------------------------------

test("an allowed helper executes once, without approval and without auto-resume", async () => {
  const h = harness();
  const record = h.store.issue({
    host: HOST,
    sessionId: SESSION,
    invocation: invocationResult([helperClassification("allowed")]),
  })!;

  const outcome = await h.commands.executeAllowedHelper(record.id, 0);
  assert.equal(outcome.callerResumeReady, true);
  assert.equal(outcome.continuationId, record.id);
  // No approval was granted for an allowed edge.
  assert.deepEqual(h.invocations.calls, [
    { api: "executeHelper", host: HOST },
  ]);

  // The caller was NOT auto-resumed.
  assert.equal(
    h.invocations.calls.some((call) => call.api === "resumeCaller"),
    false,
  );
  // A second execution of the same request is refused.
  await assert.rejects(
    h.commands.executeAllowedHelper(record.id, 0),
    (error: unknown) => error instanceof ContinuationStateError,
  );
});

test("execute_helper refuses any status other than allowed", async () => {
  for (const status of [
    "approval_required",
    "denied",
    "forbidden",
    "unavailable",
  ] as const) {
    const h = harness();
    const record = h.store.issue({
      host: HOST,
      sessionId: SESSION,
      invocation: invocationResult([
        helperClassification("allowed"),
        helperClassification(status),
      ]),
    })!;
    await assert.rejects(
      h.commands.executeAllowedHelper(record.id, 1),
      (error: unknown) => error instanceof ContinuationStateError,
      `${status} must not execute`,
    );
    assert.equal(h.invocations.calls.length, 0, "no provider execution");
  }
});

// ---------------------------------------------------------------------------
// Asked helper approval flow
// ---------------------------------------------------------------------------

test("approve_and_execute_helper grants a one-time approval for an asked edge", async () => {
  const h = harness();
  const record = h.store.issue({
    host: HOST,
    sessionId: SESSION,
    invocation: invocationResult([helperClassification("approval_required")]),
  })!;
  const outcome = await h.commands.approveAndExecuteHelper(record.id, 0);
  assert.equal(outcome.callerResumeReady, true);
  assert.deepEqual(h.invocations.calls, [
    { api: "executeHelper", host: HOST, approvalGranted: true },
  ]);
  // Executing again is refused.
  await assert.rejects(
    h.commands.approveAndExecuteHelper(record.id, 0),
    (error: unknown) => error instanceof ContinuationStateError,
  );
});

test("approve_and_execute_helper refuses an already-allowed or denied edge", async () => {
  for (const status of ["allowed", "denied", "forbidden"] as const) {
    const h = harness();
    const record = h.store.issue({
      host: HOST,
      sessionId: SESSION,
      invocation: invocationResult([
        helperClassification("approval_required"),
        helperClassification(status),
      ]),
    })!;
    await assert.rejects(
      h.commands.approveAndExecuteHelper(record.id, 1),
      (error: unknown) => error instanceof ContinuationStateError,
    );
    assert.equal(h.invocations.calls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// Caller resume flow
// ---------------------------------------------------------------------------

test("resume_caller requires a completed helper execution", async () => {
  const h = harness();
  const record = h.store.issue({
    host: HOST,
    sessionId: SESSION,
    invocation: invocationResult([helperClassification("allowed")]),
  })!;
  await assert.rejects(
    h.commands.resumeCaller(record.id),
    (error: unknown) => error instanceof ContinuationStateError,
  );
  assert.equal(h.invocations.calls.length, 0);
});

test("resume_caller consumes the record and cannot run twice", async () => {
  const h = harness();
  const record = h.store.issue({
    host: HOST,
    sessionId: SESSION,
    invocation: invocationResult([helperClassification("allowed")]),
  })!;
  await h.commands.executeAllowedHelper(record.id, 0);
  const outcome = await h.commands.resumeCaller(record.id);
  assert.equal(
    h.invocations.calls.some((call) => call.api === "resumeCaller"),
    true,
  );
  // Nothing actionable in the resumed result -> no new handle.
  assert.equal(outcome.continuationId, null);
  assert.equal(outcome.callerResumeReady, false);
  // The consumed id is dead.
  await assert.rejects(
    h.commands.resumeCaller(record.id),
    (error: unknown) => error instanceof ContinuationNotFoundError,
  );
});

test("a resumed invocation with new actionable requests gets a NEW handle", async () => {
  const h = harness();
  const record = h.store.issue({
    host: HOST,
    sessionId: SESSION,
    invocation: invocationResult([helperClassification("allowed")]),
  })!;
  await h.commands.executeAllowedHelper(record.id, 0);
  h.invocations.resumeCaller = async (request: { host: HostRuntime }) => {
    h.invocations.calls.push({ api: "resumeCaller", host: request.host });
    return invocationResult([helperClassification("allowed")]);
  };
  const outcome = await h.commands.resumeCaller(record.id);
  assert.notEqual(outcome.continuationId, null);
  // A new generation, never the consumed id.
  assert.notEqual(outcome.continuationId, record.id);
});

// ---------------------------------------------------------------------------
// Network approval flow
// ---------------------------------------------------------------------------

test("approve_network_action grants a one-time approval and consumes the record", async () => {
  const h = harness();
  const record = h.store.issue({
    host: HOST,
    sessionId: SESSION,
    invocation: invocationResult([], [actionClassification("approval_required")]),
  })!;
  const outcome = await h.commands.approveNetworkAction(record.id, 0);
  assert.deepEqual(h.invocations.calls, [
    {
      api: "resumeCallerWithActionApproval",
      host: HOST,
      approvalGranted: true,
    },
  ]);
  assert.equal(outcome.continuationId, null);
  // Approving twice is impossible.
  await assert.rejects(
    h.commands.approveNetworkAction(record.id, 0),
    (error: unknown) => error instanceof ContinuationNotFoundError,
  );
});

test("only an approval_required provider-capability network action is approvable", async () => {
  const cases: readonly [ActionClassification, string][] = [
    [actionClassification("allowed"), "already allowed"],
    [actionClassification("denied"), "denied"],
    [actionClassification("unavailable"), "unavailable"],
    [
      actionClassification("approval_required", "git_push", "host_action"),
      "host action git_push",
    ],
    [
      actionClassification("approval_required", "ci", "host_action"),
      "host action ci",
    ],
  ];
  for (const [classification, label] of cases) {
    const h = harness();
    // Pair with a genuinely approvable action so a record exists.
    const record = h.store.issue({
      host: HOST,
      sessionId: SESSION,
      invocation: invocationResult(
        [],
        [actionClassification("approval_required"), classification],
      ),
    })!;
    await assert.rejects(
      h.commands.approveNetworkAction(record.id, 1),
      (error: unknown) => error instanceof ContinuationStateError,
      label,
    );
    assert.equal(h.invocations.calls.length, 0, label);
  }
});

// ---------------------------------------------------------------------------
// Tampering resistance
// ---------------------------------------------------------------------------

test("an out-of-range or invalid request index is refused", async () => {
  const h = harness();
  const record = h.store.issue({
    host: HOST,
    sessionId: SESSION,
    invocation: invocationResult([helperClassification("allowed")]),
  })!;
  for (const index of [1, 5, 99, -1, 1.5, Number.NaN]) {
    await assert.rejects(
      h.commands.executeAllowedHelper(record.id, index),
      (error: unknown) => error instanceof ContinuationStateError,
      `index ${index}`,
    );
  }
  assert.equal(h.invocations.calls.length, 0);
});

test("the stored classification wins over anything a client believes", async () => {
  const h = harness();
  // The server stored a DENIED helper. There is no wire field through which a
  // client could claim otherwise, and by index it still cannot execute.
  const record = h.store.issue({
    host: HOST,
    sessionId: SESSION,
    invocation: invocationResult([
      helperClassification("approval_required"),
      helperClassification("denied"),
    ]),
  })!;
  await assert.rejects(
    h.commands.executeAllowedHelper(record.id, 1),
    (error: unknown) => error instanceof ContinuationStateError,
  );
  await assert.rejects(
    h.commands.approveAndExecuteHelper(record.id, 1),
    (error: unknown) => error instanceof ContinuationStateError,
  );
  assert.equal(h.invocations.calls.length, 0);
});

// ---------------------------------------------------------------------------
// CODER / source-read-only helper boundary
// ---------------------------------------------------------------------------

test("a CODER helper is refused even when the edge classifies allowed", async () => {
  for (const method of ["executeAllowedHelper", "approveAndExecuteHelper"] as const) {
    const status = method === "executeAllowedHelper" ? "allowed" : "approval_required";
    const h = harness();
    const record = h.store.issue({
      host: HOST,
      sessionId: SESSION,
      invocation: invocationResult([helperClassification(status, "coder")]),
    })!;
    await assert.rejects(
      h.commands[method](record.id, 0),
      (error: unknown) =>
        error instanceof UnsupportedAgentInvocationError &&
        error.details?.reason === "helper_source_modification_not_permitted",
      method,
    );
    // No provider execution: the loophole is closed before dispatch.
    assert.equal(h.invocations.calls.length, 0, method);
  }
});

// ---------------------------------------------------------------------------
// Failure / consumption ordering
// ---------------------------------------------------------------------------

test("a helper spawn failure leaves the record pending and retryable", async () => {
  const h = harness();
  const record = h.store.issue({
    host: HOST,
    sessionId: SESSION,
    invocation: invocationResult([helperClassification("allowed")]),
  })!;
  h.invocations.helperFails = true;
  await assert.rejects(h.commands.executeAllowedHelper(record.id, 0));
  // No trusted transition occurred, so the request is not consumed.
  const stillPending = h.store.require(record.id, HOST);
  assert.equal(stillPending.state, "origin_pending");
  assert.deepEqual(stillPending.executedHelperIndexes, []);

  h.invocations.helperFails = false;
  const outcome = await h.commands.executeAllowedHelper(record.id, 0);
  assert.equal(outcome.callerResumeReady, true);
});

test("a resume failure leaves the helper-completed record intact", async () => {
  const h = harness();
  const record = h.store.issue({
    host: HOST,
    sessionId: SESSION,
    invocation: invocationResult([helperClassification("allowed")]),
  })!;
  await h.commands.executeAllowedHelper(record.id, 0);
  h.invocations.resumeFails = true;
  await assert.rejects(h.commands.resumeCaller(record.id));
  // Not consumed: the record is still resumable.
  const kept = h.store.require(record.id, HOST);
  assert.equal(kept.state, "helper_completed");
});

// ---------------------------------------------------------------------------
// Phase 3D: allowed-network continuation
// ---------------------------------------------------------------------------

test("an allowed network action is actionable and issues a handle", () => {
  const h = harness();
  const record = h.store.issue({
    host: HOST,
    sessionId: SESSION,
    invocation: invocationResult([], [actionClassification("allowed")]),
  });
  assert.notEqual(record, null);
  assert.equal(record!.actionRequests.length, 1);
});

test("continue_allowed_network carries NO approval and consumes the record", async () => {
  const h = harness();
  const record = h.store.issue({
    host: HOST,
    sessionId: SESSION,
    invocation: invocationResult([], [actionClassification("allowed")]),
  })!;
  const outcome = await h.commands.continueAllowedNetwork(record.id, 0);
  // A distinct API from the approval path, and no approval flag.
  assert.deepEqual(h.invocations.calls, [
    { api: "resumeCallerWithAllowedAction", host: HOST },
  ]);
  assert.equal(outcome.continuationId, null);
  // Old handle is consumed; a second attempt fails.
  await assert.rejects(
    h.commands.continueAllowedNetwork(record.id, 0),
    (error: unknown) => error instanceof ContinuationNotFoundError,
  );
});

test("the allowed and approval network paths cannot handle each other's status", async () => {
  // allowed tool vs approval_required item
  const asked = harness();
  const askedRecord = asked.store.issue({
    host: HOST,
    sessionId: SESSION,
    invocation: invocationResult(
      [],
      [actionClassification("approval_required")],
    ),
  })!;
  await assert.rejects(
    asked.commands.continueAllowedNetwork(askedRecord.id, 0),
    (error: unknown) => error instanceof ContinuationStateError,
  );
  assert.equal(asked.invocations.calls.length, 0);

  // approval tool vs allowed item
  const allowed = harness();
  const allowedRecord = allowed.store.issue({
    host: HOST,
    sessionId: SESSION,
    invocation: invocationResult([], [actionClassification("allowed")]),
  })!;
  await assert.rejects(
    allowed.commands.approveNetworkAction(allowedRecord.id, 0),
    (error: unknown) => error instanceof ContinuationStateError,
  );
  assert.equal(allowed.invocations.calls.length, 0);
});

test("neither network tool can progress a host action or a refused status", async () => {
  const cases: readonly [ActionClassification, string][] = [
    [actionClassification("allowed", "git_push", "host_action"), "git_push allowed"],
    [actionClassification("allowed", "ci", "host_action"), "ci allowed"],
    [
      actionClassification("approval_required", "git_push", "host_action"),
      "git_push asked",
    ],
    [actionClassification("denied"), "network denied"],
    [actionClassification("unavailable"), "network unavailable"],
  ];
  for (const [classification, label] of cases) {
    for (const method of [
      "continueAllowedNetwork",
      "approveNetworkAction",
    ] as const) {
      const h = harness();
      const record = h.store.issue({
        host: HOST,
        sessionId: SESSION,
        invocation: invocationResult(
          [],
          [actionClassification("allowed"), classification],
        ),
      })!;
      await assert.rejects(
        h.commands[method](record.id, 1),
        (error: unknown) => error instanceof ContinuationStateError,
        `${method} / ${label}`,
      );
      assert.equal(h.invocations.calls.length, 0, `${method} / ${label}`);
    }
  }
});

test("an allowed-network continuation failure leaves the record retryable", async () => {
  const h = harness();
  const record = h.store.issue({
    host: HOST,
    sessionId: SESSION,
    invocation: invocationResult([], [actionClassification("allowed")]),
  })!;
  h.invocations.allowedFails = true;
  await assert.rejects(h.commands.continueAllowedNetwork(record.id, 0));
  // Not consumed: no trusted transition occurred.
  const pending = h.store.require(record.id, HOST);
  assert.equal(pending.state, "origin_pending");

  h.invocations.allowedFails = false;
  const outcome = await h.commands.continueAllowedNetwork(record.id, 0);
  assert.equal(outcome.continuationId, null);
});

test("an allowed-network continuation whose result is actionable gets a NEW handle", async () => {
  const h = harness();
  const record = h.store.issue({
    host: HOST,
    sessionId: SESSION,
    invocation: invocationResult([], [actionClassification("allowed")]),
  })!;
  h.invocations.allowedResult = invocationResult([
    helperClassification("allowed"),
  ]);
  const outcome = await h.commands.continueAllowedNetwork(record.id, 0);
  assert.notEqual(outcome.continuationId, null);
  assert.notEqual(outcome.continuationId, record.id);
});

test("an allowed-network continuation cannot run after a helper already progressed", async () => {
  const h = harness();
  const record = h.store.issue({
    host: HOST,
    sessionId: SESSION,
    invocation: invocationResult(
      [helperClassification("allowed")],
      [actionClassification("allowed")],
    ),
  })!;
  await h.commands.executeAllowedHelper(record.id, 0);
  await assert.rejects(
    h.commands.continueAllowedNetwork(record.id, 0),
    (error: unknown) => error instanceof ContinuationStateError,
  );
});

test("CODER remains blocked as a helper even though direct CODER is enabled", async () => {
  // Phase 5B separates the surfaces: a user may explicitly invoke staged
  // CODER, but an agent must not smuggle CODER through a continuation.
  for (const method of ["executeAllowedHelper", "approveAndExecuteHelper"] as const) {
    const status = method === "executeAllowedHelper" ? "allowed" : "approval_required";
    const h = harness();
    const record = h.store.issue({
      host: HOST,
      sessionId: SESSION,
      invocation: invocationResult([helperClassification(status, "coder")]),
    })!;
    await assert.rejects(
      h.commands[method](record.id, 0),
      (error: unknown) =>
        error instanceof UnsupportedAgentInvocationError &&
        error.details?.reason === "helper_source_modification_not_permitted",
      method,
    );
    assert.equal(h.invocations.calls.length, 0, method);
  }
});
