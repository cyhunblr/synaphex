import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { parseAgentHandoff } from "../src/core/agent-handoff-validator.js";
import { validateAgentResult } from "../src/core/agent-result-validator.js";
import {
  InvalidAgentHandoffError,
  InvalidAgentResultError,
} from "../src/domain/errors.js";

test("validates QUESTIONER pending-question result", () => {
  const result = {
    agent: "questioner" as const,
    outcome: "needs_user" as const,
    summary: "One requirement remains unclear.",
    state: "pending_question" as const,
    question: "Should archived data be retained?",
    workingContext: { answered: 2 },
  };

  const validated = validateAgentResult("questioner", result);
  assert.equal(validated.state, "pending_question");
  if (validated.state === "pending_question") {
    assert.equal(validated.question, "Should archived data be retained?");
  }
});

test("validates QUESTIONER context-complete result", () => {
  const result = validateAgentResult("questioner", {
    agent: "questioner",
    outcome: "success",
    summary: "Requirements are complete.",
    state: "context_complete",
    workingContext: { complete: true },
  });

  assert.equal(result.state, "context_complete");
});

test("validates RESEARCHER result and a structured requested call", () => {
  const result = validateAgentResult("researcher", {
    agent: "researcher",
    outcome: "success",
    summary: "Research collected.",
    researchArtifact: { findings: ["fact"] },
    requestedCalls: [
      {
        target: "examiner",
        purpose: "memory_update",
        handoff: {
          caller: "researcher",
          target: "examiner",
          purpose: "memory_update",
          summary: "Distill the verified findings.",
        },
      },
    ],
  });

  assert.equal(result.requestedCalls?.[0]?.target, "examiner");
});

test("validates EXAMINER memory replacement intent without applying it", () => {
  const result = validateAgentResult("examiner", {
    agent: "examiner",
    outcome: "success",
    summary: "Task memory should be replaced.",
    memoryIntent: {
      kind: "replace_task",
      projectId: "prj_example",
      taskId: "task_example",
      content: "# Distilled memory",
    },
  });

  assert.equal(result.memoryIntent.kind, "replace_task");
});

test("validates PLANNER draft result but rejects plan acceptance fields", () => {
  const result = validateAgentResult("planner", {
    agent: "planner",
    outcome: "success",
    summary: "Draft is ready.",
    draftPlanMarkdown: "# Plan",
  });
  assert.equal(result.draftPlanMarkdown, "# Plan");

  assert.throws(
    () =>
      validateAgentResult("planner", {
        agent: "planner",
        outcome: "success",
        summary: "Improper acceptance claim.",
        draftPlanMarkdown: "# Plan",
        accepted: true,
      }),
    InvalidAgentResultError,
  );
});

test("validates consistent PLANNER consultation results", () => {
  const clarification = validateAgentResult("planner", {
    agent: "planner",
    outcome: "success",
    summary: "The accepted plan remains valid.",
    consultation: {
      disposition: "plan_still_valid",
      message: "Continue with the accepted plan.",
    },
  });
  assert.equal(clarification.consultation?.disposition, "plan_still_valid");

  const revision = validateAgentResult("planner", {
    agent: "planner",
    outcome: "success",
    summary: "A revision is required.",
    consultation: {
      disposition: "revision_required",
      message: "Review the proposed revision.",
    },
    draftPlanMarkdown: "# Revised plan\n",
  });
  assert.equal(revision.consultation?.disposition, "revision_required");

  assert.throws(
    () =>
      validateAgentResult("planner", {
        agent: "planner",
        outcome: "success",
        summary: "Missing revision draft.",
        consultation: {
          disposition: "revision_required",
          message: "A revision is needed.",
        },
      }),
    InvalidAgentResultError,
  );
  assert.throws(
    () =>
      validateAgentResult("planner", {
        agent: "planner",
        outcome: "success",
        summary: "Contradictory clarification.",
        consultation: {
          disposition: "plan_still_valid",
          message: "No revision is needed.",
        },
        draftPlanMarkdown: "# Contradictory draft\n",
      }),
    InvalidAgentResultError,
  );
});

test("validates CODER opaque work-record result", () => {
  const result = validateAgentResult("coder", {
    agent: "coder",
    outcome: "success",
    summary: "Implementation completed.",
    workRecord: { files_changed: ["src/index.ts"], tests_run: ["npm test"] },
  });

  assert.deepEqual(result.workRecord, {
    files_changed: ["src/index.ts"],
    tests_run: ["npm test"],
  });
});

test("validates REVIEWER PASS", () => {
  const result = validateAgentResult("reviewer", {
    agent: "reviewer",
    outcome: "success",
    summary: "Implementation passes.",
    reviewStatus: "PASS",
    report: { requirement_compliance: true },
  });

  assert.equal(result.reviewStatus, "PASS");
});

test("validates REVIEWER PASS_WITH_WARNINGS with lifecycle warnings outside report", () => {
  const result = validateAgentResult("reviewer", {
    agent: "reviewer",
    outcome: "success",
    summary: "Implementation passes with a warning.",
    warnings: ["Production lock recovery remains deferred."],
    reviewStatus: "PASS_WITH_WARNINGS",
    report: { requirement_compliance: true },
  });

  assert.deepEqual(result.warnings, [
    "Production lock recovery remains deferred.",
  ]);
  assert.equal("warnings" in result.report, false);
});

test("validates REVIEWER FAIL with implementation origin", () => {
  const result = validateAgentResult("reviewer", {
    agent: "reviewer",
    outcome: "success",
    summary: "Implementation does not satisfy the requirement.",
    reviewStatus: "FAIL",
    failureOrigin: "implementation",
    report: { validation_results: ["failed"] },
  });

  assert.equal(result.failureOrigin, "implementation");
});

test("rejects Reviewer status and failure-origin inconsistencies", () => {
  assert.throws(
    () =>
      validateAgentResult("reviewer", {
        agent: "reviewer",
        outcome: "success",
        summary: "Invalid failure.",
        reviewStatus: "FAIL",
        report: {},
      }),
    InvalidAgentResultError,
  );
  assert.throws(
    () =>
      validateAgentResult("reviewer", {
        agent: "reviewer",
        outcome: "success",
        summary: "Invalid pass.",
        reviewStatus: "PASS",
        failureOrigin: "plan",
        report: {},
      }),
    InvalidAgentResultError,
  );
  assert.throws(
    () =>
      validateAgentResult("reviewer", {
        agent: "reviewer",
        outcome: "success",
        summary: "Missing warnings.",
        reviewStatus: "PASS_WITH_WARNINGS",
        report: {},
      }),
    InvalidAgentResultError,
  );
});

test("rejects wrong agent discriminator", () => {
  assert.throws(
    () =>
      validateAgentResult("coder", {
        agent: "reviewer",
        outcome: "success",
        summary: "Wrong discriminator.",
        workRecord: {},
      }),
    (error: unknown) =>
      error instanceof InvalidAgentResultError &&
      error.code === "INVALID_AGENT_RESULT",
  );
});

test("rejects malformed requested calls and handoffs", () => {
  assert.throws(
    () =>
      validateAgentResult("coder", {
        agent: "coder",
        outcome: "success",
        summary: "Malformed request.",
        workRecord: {},
        requestedCalls: [
          {
            target: "planner",
            purpose: "plan_revision",
            handoff: {
              caller: "reviewer",
              target: "planner",
              purpose: "plan_revision",
              summary: "Caller does not match.",
            },
          },
        ],
      }),
    InvalidAgentResultError,
  );
  assert.throws(
    () =>
      parseAgentHandoff({
        caller: "coder",
        target: "planner",
        purpose: "unknown",
        summary: "Unknown purpose.",
      }),
    (error: unknown) =>
      error instanceof InvalidAgentHandoffError &&
      error.code === "INVALID_AGENT_HANDOFF",
  );
  assert.throws(
    () =>
      parseAgentHandoff(
        {
          caller: "coder",
          target: "researcher",
          purpose: "research",
          summary: "   ",
        },
        "planner",
      ),
    InvalidAgentHandoffError,
  );
});

test("rejects invalid opaque JSON payloads", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;

  for (const workRecord of [cyclic, { invalid: 1n }, { date: new Date() }]) {
    assert.throws(
      () =>
        validateAgentResult("coder", {
          agent: "coder",
          outcome: "success",
          summary: "Invalid payload.",
          workRecord,
        }),
      InvalidAgentResultError,
    );
  }
});

test("result validation performs no state mutation", async (t: TestContext) => {
  const root = await mkdtemp(join(tmpdir(), "synaphex-result-readonly-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sentinelPath = join(root, "sentinel.json");
  await writeFile(sentinelPath, '{"unchanged":true}\n', "utf8");
  const before = await readFile(sentinelPath, "utf8");

  validateAgentResult("researcher", {
    agent: "researcher",
    outcome: "success",
    summary: "Pure validation.",
    researchArtifact: { findings: [] },
  });

  assert.equal(await readFile(sentinelPath, "utf8"), before);
});
