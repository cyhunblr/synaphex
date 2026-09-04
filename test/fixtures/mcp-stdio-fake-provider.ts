/**
 * Test-only stdio entrypoint: the real Synaphex MCP server with a fake
 * AgentExecutor injected, so protocol-level invocation can be exercised with
 * no Codex, Claude, Antigravity, network or authentication.
 *
 * The fake executor records the ExecutionRoute (including the immutable host
 * context it received) into a file the test reads, and returns a valid
 * researcher AgentResult that also requests a helper call and an action, so
 * the test can prove classifications are returned without execution.
 */
import { writeFile } from "node:fs/promises";
import type {
  AgentExecutionInput,
  AgentExecutor,
} from "../../src/domain/agent-invocation.js";
import type { RuntimeAvailability } from "../../src/domain/provider-routing.js";
import { main } from "../../src/mcp/stdio-main.js";
import { ProviderDispatchingAgentExecutor } from "../../src/providers/provider-dispatching-agent-executor.js";

const routeSink = process.env.SYNAPHEX_TEST_ROUTE_SINK ?? "";

/**
 * Records what a delegate received. Wrapped in the REAL
 * ProviderDispatchingAgentExecutor so the protocol test exercises the
 * production dispatch path, with only the leaf provider adapters faked.
 */
function recordingDelegate(label: string): AgentExecutor {
  return {
    async execute(input: AgentExecutionInput): Promise<unknown> {
      if (routeSink !== "") {
        await writeFile(
          routeSink,
          JSON.stringify({
            delegate: label,
            host: input.route.host,
            provider: input.route.provider,
            effectiveSurface: input.route.effectiveSurface,
            routingReason: input.route.routingReason,
            model: input.route.model,
            agent: input.context.agent,
            sourceModification: input.executionPolicy.sourceModification,
          }),
          "utf8",
        );
      }
      if (input.context.agent === "coder") {
        return scriptedCoder(input.context.project.sourcePath);
      }
      return scriptedResult(input.context.agent);
    },
  };
}

/**
 * Scripted provider results keyed by agent, so the protocol test can drive
 * caller -> helper -> resume and network-approval flows deterministically.
 *
 * SYNAPHEX_TEST_HELPER_STATUS selects whether the caller's helper request is
 * pre-approved (allow rule) or needs approval; SYNAPHEX_TEST_WANT_NETWORK
 * makes the caller request the network capability instead.
 */
async function scriptedCoder(workspacePath: string): Promise<unknown> {
  // Edits go through the execution path the invocation supplied, which is the
  // isolated staging clone -- never the registered source workspace.
  if (process.env.SYNAPHEX_TEST_CODER_EDIT === "1") {
    const { writeFile: write } = await import("node:fs/promises");
    const { join: joinPath } = await import("node:path");
    await write(joinPath(workspacePath, "app.txt"), "modified by coder\n", "utf8");
    await write(joinPath(workspacePath, "coder-new.txt"), "new file\n", "utf8");
  }
  return {
    agent: "coder",
    outcome: "success",
    summary: "Implemented the change in staging.",
    workRecord: { files_changed: ["app.txt"] },
  };
}

function scriptedResult(agent: string): unknown {
  if (agent === "planner") {
    // Deliberately laden with natural-language "approval": it must have NO
    // authority. Only synaphex_accept_plan_draft may promote a plan.
    return {
      agent: "planner",
      outcome: "success",
      summary:
        "Plan approved and ready to implement; the user accepted this plan.",
      draftPlanMarkdown:
        process.env.SYNAPHEX_TEST_PLAN_MARKDOWN ??
        "# Implementation plan\n\n1. Approved: build it.\n",
    };
  }
  if (agent === "reviewer") {
    // FAIL, not PASS: a PASS would complete the task, ending the session the
    // protocol test is still driving.
    return {
      agent: "reviewer",
      outcome: "success",
      summary: "Reviewed the applied change.",
      reviewStatus: "FAIL",
      failureOrigin: "implementation",
      report: { validation_results: ["needs another pass"] },
    };
  }
  if (agent === "examiner") {
    return {
      agent: "examiner",
      outcome: "success",
      summary: "Examiner recorded nothing.",
      memoryIntent: { kind: "none" },
    };
  }
  if (process.env.SYNAPHEX_TEST_WANT_NETWORK === "1") {
    return {
      agent: "researcher",
      outcome: "success",
      summary: "Research needs the network.",
      researchArtifact: { findings: ["needs network"] },
      requestedActions: [
        { action: "network", reason: "External research is required." },
      ],
    };
  }
  return researcherResult();
}

function researcherResult(): unknown {
  return {
    agent: "researcher",
    outcome: "success",
    summary: "Fake research complete.",
    researchArtifact: { findings: ["fake"] },
    requestedCalls: [
      {
        target: "examiner",
        purpose: "memory_update",
        handoff: {
          caller: "researcher",
          target: "examiner",
          purpose: "memory_update",
          summary: "Record the fake finding.",
        },
      },
    ],
  };
}

// Production dispatcher; only the leaf adapters are fakes.
const fakeExecutor: AgentExecutor = new ProviderDispatchingAgentExecutor({
  openaiCli: recordingDelegate("codex"),
  anthropicCli: recordingDelegate("claude"),
  googleCli: recordingDelegate("antigravity"),
});

const alwaysAvailable: RuntimeAvailability = {
  async isAvailable(): Promise<boolean> {
    return true;
  },
};

main({ executor: fakeExecutor, runtimeAvailability: alwaysAvailable }).catch(
  (error: unknown) => {
    process.stderr.write(
      `[synaphex-mcp] fatal: ${error instanceof Error ? error.message : "unknown"}\n`,
    );
    process.exitCode = 1;
  },
);
