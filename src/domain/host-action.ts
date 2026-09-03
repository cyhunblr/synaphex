import type { HostActionName } from "./action.js";
import type {
  ActionClassification,
  AnyAgentInvocationResult,
  InvocationLineage,
} from "./agent-invocation.js";
import type { ProjectId } from "./project.js";
import type { EffectiveRule } from "./rule.js";
import type { SessionId } from "./session.js";
import type { TaskId } from "./task.js";

export type HostActionAuthorizationId = `host_action_auth_${string}`;

export interface HostActionAuthorization {
  readonly id: HostActionAuthorizationId;
  readonly executionKind: "host_action";
  readonly action: HostActionName;
  readonly sessionId: SessionId;
  readonly projectId: ProjectId;
  readonly taskId: TaskId | null;
  readonly invocationLineage: InvocationLineage;
  readonly effectiveRule: EffectiveRule;
  readonly approvedForAuthorization: boolean;
}

export interface HostActionExecutionContext {
  readonly projectId: ProjectId;
  readonly sourcePath: string;
  readonly taskId: TaskId | null;
  readonly action: HostActionName;
  readonly invocationLineage: InvocationLineage;
}

export interface HostActionAuthorizationResult {
  readonly authorization: HostActionAuthorization;
  readonly context: HostActionExecutionContext;
}

export interface HostActionAuthorizationRequest {
  readonly sessionId: SessionId;
  readonly previousInvocation: AnyAgentInvocationResult;
  readonly actionClassification: ActionClassification;
  readonly approvalGranted: boolean;
}

export interface HostActionExecutionInput<
  TAction extends HostActionName = HostActionName,
> {
  readonly authorization: HostActionAuthorization & {
    readonly action: TAction;
  };
  readonly context: HostActionExecutionContext & {
    readonly action: TAction;
  };
}

export interface HostActionResult<
  TAction extends HostActionName = HostActionName,
> {
  readonly action: TAction;
  readonly outcome: "success" | "failure";
  readonly summary: string;
}

export interface HostActionExecutor<
  TAction extends HostActionName = HostActionName,
> {
  execute(input: HostActionExecutionInput<TAction>): Promise<HostActionResult<TAction>>;
}
