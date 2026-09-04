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
      return researcherResult();
    },
  };
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
    requestedActions: [
      { action: "network", reason: "External research is required." },
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
