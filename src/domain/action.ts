export const ACTION_EXECUTION_KINDS = [
  "provider_capability",
  "host_action",
] as const;

export type ActionExecutionKind = (typeof ACTION_EXECUTION_KINDS)[number];

const ACTION_CONTRACTS = Object.freeze({
  network: Object.freeze({ executionKind: "provider_capability" as const }),
  git_push: Object.freeze({ executionKind: "host_action" as const }),
  ci: Object.freeze({ executionKind: "host_action" as const }),
});

export type ActionName = keyof typeof ACTION_CONTRACTS;

export type ProviderCapabilityName = {
  [TAction in ActionName]: (typeof ACTION_CONTRACTS)[TAction]["executionKind"] extends "provider_capability"
    ? TAction
    : never;
}[ActionName];

export type HostActionName = {
  [TAction in ActionName]: (typeof ACTION_CONTRACTS)[TAction]["executionKind"] extends "host_action"
    ? TAction
    : never;
}[ActionName];

export interface ActionContract<TAction extends ActionName = ActionName> {
  readonly action: TAction;
  readonly executionKind: (typeof ACTION_CONTRACTS)[TAction]["executionKind"];
}

export class ActionRegistry {
  isKnownAction(value: unknown): value is ActionName {
    return typeof value === "string" && Object.hasOwn(ACTION_CONTRACTS, value);
  }

  get<TAction extends ActionName>(action: TAction): ActionContract<TAction> {
    return Object.freeze({
      action,
      executionKind: ACTION_CONTRACTS[action].executionKind,
    }) as ActionContract<TAction>;
  }

  isProviderCapability(action: ActionName): action is ProviderCapabilityName {
    return ACTION_CONTRACTS[action].executionKind === "provider_capability";
  }

  isHostAction(action: ActionName): action is HostActionName {
    return ACTION_CONTRACTS[action].executionKind === "host_action";
  }

  list(): readonly ActionContract[] {
    return ACTION_NAMES.map((action) => this.get(action));
  }
}

const registry = new ActionRegistry();

export const ACTION_NAMES = Object.freeze(
  Object.keys(ACTION_CONTRACTS) as ActionName[],
);

export const PROVIDER_CAPABILITY_NAMES = Object.freeze(
  ACTION_NAMES.filter((action): action is ProviderCapabilityName =>
    registry.isProviderCapability(action),
  ),
);

export const HOST_ACTION_NAMES = Object.freeze(
  ACTION_NAMES.filter((action): action is HostActionName =>
    registry.isHostAction(action),
  ),
);

export function isActionName(value: unknown): value is ActionName {
  return registry.isKnownAction(value);
}
