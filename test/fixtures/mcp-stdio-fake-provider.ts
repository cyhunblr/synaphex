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

const routeSink = process.env.SYNAPHEX_TEST_ROUTE_SINK ?? "";

const fakeExecutor: AgentExecutor = {
  async execute(input: AgentExecutionInput): Promise<unknown> {
    if (routeSink !== "") {
      await writeFile(
        routeSink,
        JSON.stringify({
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
  },
};

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
