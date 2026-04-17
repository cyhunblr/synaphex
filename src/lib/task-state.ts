/**
 * Task state machine validation and utilities.
 */

export interface StepDependency {
  required: boolean;
  requiresPrior: string[];
}

export const STEP_DEPENDENCIES: Record<string, StepDependency> = {
  create: { required: true, requiresPrior: [] },
  remember: { required: false, requiresPrior: ["create"] },
  examine: { required: true, requiresPrior: ["create"] },
  researcher: { required: false, requiresPrior: ["examine"] },
  planner: { required: true, requiresPrior: ["examine"] },
  coder: { required: true, requiresPrior: ["planner"] },
  answerer: { required: true, requiresPrior: ["coder"] },
  reviewer: { required: true, requiresPrior: ["answerer"] },
};

export const REQUIRED_STEPS = Object.entries(STEP_DEPENDENCIES)
  .filter(([, dep]) => dep.required)
  .map(([step]) => step);

export const OPTIONAL_STEPS = Object.entries(STEP_DEPENDENCIES)
  .filter(([, dep]) => !dep.required)
  .map(([step]) => step);

export function getStepDependencies(step: string): string[] {
  return STEP_DEPENDENCIES[step]?.requiresPrior || [];
}

export function isRequiredStep(step: string): boolean {
  return REQUIRED_STEPS.includes(step);
}

export function isValidStep(step: string): boolean {
  return Object.keys(STEP_DEPENDENCIES).includes(step);
}

export function getWorkflowOrder(): string[] {
  return [
    "create",
    "remember",
    "examine",
    "researcher",
    "planner",
    "coder",
    "answerer",
    "reviewer",
  ];
}
