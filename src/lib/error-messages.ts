/**
 * Standardized, helpful error messages for task validation and workflow.
 */

import { REQUIRED_STEPS, OPTIONAL_STEPS, getWorkflowOrder } from "./task-state.js";

export function formatValidationError(
  attemptedStep: string,
  completedSteps: string[],
): string {
  const workflowOrder = getWorkflowOrder();
  const stepStatuses = workflowOrder
    .map((step, idx) => {
      const isCompleted = completedSteps.includes(step);
      const isOptional = OPTIONAL_STEPS.includes(step);
      const indicator = isCompleted ? "✓" : isOptional ? "(optional)" : "✗";
      return `   ${idx + 1}. ${step} ${indicator}`;
    })
    .join("\n");

  return `❌ Cannot run task-${attemptedStep}: required prior step not completed.

Required workflow order:
${stepStatuses}

Run: /synaphex:task-${REQUIRED_STEPS[0]} <project> <task_name>`;
}

export function formatStepAlreadyDoneError(step: string): string {
  return `❌ task-${step} already completed for this task.

To re-run this step, create a new task with /synaphex:task-create.`;
}

export function formatUnknownStepError(step: string): string {
  return `❌ Unknown step: '${step}'. Valid steps are: ${getWorkflowOrder().join(", ")}.`;
}

export function formatMissingPriorStepsError(
  attemptedStep: string,
  missingSteps: string[],
): string {
  return `❌ Cannot run task-${attemptedStep}: ${missingSteps.map((s) => `task-${s}`).join(", ")} not completed yet.`;
}
