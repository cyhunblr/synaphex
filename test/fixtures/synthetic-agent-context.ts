import { RoleContractRegistry } from "../../src/core/role-contract-registry.js";
import type { AgentName } from "../../src/domain/agent.js";
import type { AgentContext } from "../../src/domain/agent-context.js";
import type { AgentBehavior } from "../../src/domain/agent-behavior.js";

export function syntheticAgentContext(
  agent: AgentName,
  sourcePath: string,
  behavior: AgentBehavior | null =
    agent === "researcher" || agent === "coder" || agent === "reviewer"
      ? { outputFields: ["custom_field"] }
      : null,
): AgentContext {
  const projectId = "prj_prompt" as const;
  const taskId = "task_prompt" as const;
  return {
    agent,
    project: {
      id: projectId,
      name: "Prompt Project",
      sourcePath,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    task: {
      id: taskId,
      projectId,
      slug: "prompt-task",
      description: "Exercise the provider adapter",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      archivedAt: null,
    },
    roleContract: new RoleContractRegistry().getSnapshot(agent),
    rules: {
      outgoingAgentCalls: [
        {
          key: { kind: "agent_call", caller: agent, target: "researcher" },
          decision: "ask",
          source: "task",
        },
      ],
      actions: [
        {
          key: { kind: "action", action: "network" },
          decision: "deny",
          source: "global",
        },
      ],
    },
    memory: {
      project: {
        scope: { kind: "project", projectId },
        hasContent: true,
        content: "PROJECT_CANONICAL_MEMORY",
      },
      task: {
        scope: { kind: "task", projectId, taskId },
        hasContent: true,
        content: "TASK_CANONICAL_MEMORY",
      },
      directlyLoaded: [
        {
          reference: {
            target: { kind: "task", projectId, taskId },
            source: {
              kind: "project",
              projectId: "prj_direct",
              projectName: "Direct Memory Source",
            },
            loadedAt: "2026-01-02T00:00:00.000Z",
          },
          memory: {
            scope: { kind: "project", projectId: "prj_direct" },
            hasContent: true,
            content: "DIRECT_MEMORY_ONLY",
          },
        },
      ],
    },
    plan:
      agent === "planner" || agent === "coder" || agent === "reviewer"
        ? {
            current: {
              taskId,
              status: "accepted",
              content: "ACCEPTED_PLAN_CONTENT",
            },
            draft: null,
            hasPendingDraft: false,
          }
        : null,
    artifacts: {
      questionerContext: null,
      research: [],
      coderWorkRecords: [],
      latestReviewerReport: null,
      explicitlyReferenced: [
        {
          id: "artifact_selected",
          category: "researcher",
          scope: { kind: "task", projectId, taskId },
          createdAt: "2026-01-03T00:00:00.000Z",
          payload: { finding: "SELECTED_ARTIFACT" },
        },
      ],
    },
    behavior,
    instruction: "Follow the explicit user instruction.",
    handoff: {
      caller: "planner",
      target: agent,
      purpose: "research",
      summary: "CONTINUATION_HANDOFF",
      artifactRefs: ["artifact_selected"],
    },
  };
}
