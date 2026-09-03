import type { AgentName } from "../domain/agent.js";
import type { AgentContext } from "../domain/agent-context.js";
import type { ExecutionPolicy } from "../domain/execution-policy.js";

const ROLE_INSTRUCTIONS = {
  questioner: [
    "Clarify requirements and expose unresolved questions.",
    "Do not modify source code.",
    "Represent temporary working context and helper requests only in the structured result.",
  ],
  researcher: [
    "Gather relevant evidence without modifying source code.",
    "Return research evidence through the configured structured artifact payload.",
    "Represent helper requests only through structured requestedCalls.",
  ],
  examiner: [
    "Treat source code as read-only.",
    "You are the only logical role allowed to request canonical-memory mutation.",
    "Represent memory changes through typed memoryIntent; never edit Synaphex state files.",
  ],
  planner: [
    "Create or revise draft plans without modifying source code.",
    "Never mark a plan accepted; plan acceptance belongs to the user-facing workflow.",
    "Never silently transition the workflow into CODER.",
  ],
  coder: [
    "Act as the implementation agent and modify source only as permitted by the sandbox.",
    "When an accepted plan exists, treat it as authoritative and do not silently alter it.",
    "Do not invoke REVIEWER as a workflow transition.",
    "Represent helper requests only through structured requestedCalls.",
  ],
  reviewer: [
    "Inspect and validate the implementation without modifying or fixing source code.",
    "Return a structured PASS, PASS_WITH_WARNINGS, or FAIL conclusion.",
    "Do not archive tasks or perform workflow transitions directly.",
  ],
} as const satisfies Readonly<Record<AgentName, readonly string[]>>;

export class AgentPromptSerializer {
  serialize(context: AgentContext, executionPolicy: ExecutionPolicy): string {
    const sections = [
      section(
        "SYNAPHEX AGENT",
        [
          `Logical agent: ${context.agent.toUpperCase()}`,
          "Return exactly one JSON object conforming to the supplied output schema.",
          "Do not include Markdown fences around the final JSON result.",
        ].join("\n"),
      ),
      section(
        "ROLE / IMMUTABLE CONTRACT",
        [
          ...ROLE_INSTRUCTIONS[context.agent].map((line) => `- ${line}`),
          `- Source modification capability: ${context.roleContract.mayModifySourceCode ? "allowed" : "forbidden"}`,
          `- Canonical-memory write authority: ${context.roleContract.mayWriteCanonicalMemory ? "allowed through typed result intent" : "forbidden"}`,
          `- Forbidden outgoing helper targets: ${context.roleContract.forbiddenOutgoingTargets.join(", ") || "none"}`,
          `- Conditional outgoing contracts: ${formatJson(context.roleContract.conditionalOutgoingContracts)}`,
        ].join("\n"),
      ),
      section("PROJECT", formatJson(context.project)),
      section("TASK", formatJson(context.task)),
      section(
        "CANONICAL MEMORY",
        formatJson({
          project: context.memory.project,
          task: context.memory.task,
        }),
      ),
      section(
        "DIRECTLY LOADED MEMORY",
        formatJson(context.memory.directlyLoaded),
      ),
      section("CURRENT PLAN STATE", formatJson(context.plan)),
      section("RELEVANT ARTIFACTS", formatJson(context.artifacts)),
      section("EFFECTIVE RULES", formatJson(context.rules)),
      section(
        "EXECUTION POLICY",
        [
          formatJson({
            sourceModification: executionPolicy.sourceModification,
            actions: Object.fromEntries(
              Object.entries(executionPolicy.actions).map(([action, policy]) => [
                action,
                {
                  state:
                    policy.decision === "allow" ||
                    (policy.decision === "ask" &&
                      policy.approvedForInvocation)
                      ? "enabled"
                      : policy.decision === "ask"
                        ? "approval_required"
                        : "denied",
                  decision: policy.decision,
                  source: policy.source,
                  approvedForInvocation: policy.approvedForInvocation,
                },
              ]),
            ),
          }),
          "If an action requires approval, do not attempt to bypass the restriction; return it through requestedActions.",
          "If an action is denied, do not attempt it.",
          "If an action is enabled, the provider runtime may expose it only through provider-native enforcement.",
        ].join("\n"),
      ),
      section(
        "OUTPUT CONTRACT",
        formatJson({
          agent: context.agent,
          behavior: context.behavior,
          requirements: [
            "Use only the configured payload fields where behavior is present.",
            "Express helper requests only as structured requestedCalls with a structured handoff.",
            "Express external or side-effecting permission requests only as structured requestedActions.",
            "Express Synaphex state changes only through the role-specific AgentResult fields.",
          ],
        }),
      ),
      section(
        "USER INSTRUCTION / HANDOFF",
        formatJson({
          instruction: context.instruction ?? null,
          handoff: context.handoff ?? null,
        }),
      ),
      section(
        "SYNAPHEX STATE PROTECTION",
        "Do not directly create, edit, delete, or otherwise mutate Synaphex internal state under ~/.synaphex. Express intended Synaphex state changes only through the structured AgentResult.",
      ),
    ];
    return `${sections.join("\n\n")}\n`;
  }
}

function section(title: string, body: string): string {
  return `## ${title}\n${body}`;
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "null";
}
