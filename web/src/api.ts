/**
 * The only channel the UI has to Synaphex.
 *
 * The session token is read from the document we were served, so a page the
 * user did not open from this process cannot call the API even on loopback.
 * The frontend is presentation and draft state only: every value here comes
 * from, and every mutation goes back to, the canonical domain services.
 */

const TOKEN =
  document
    .querySelector<HTMLMetaElement>('meta[name="synaphex-configure-token"]')
    ?.content ?? "";

export type RuleDecision = "allow" | "ask" | "deny";
export type AgentName =
  | "questioner"
  | "researcher"
  | "examiner"
  | "planner"
  | "coder"
  | "reviewer";

export interface AgentModel {
  agent: AgentName;
  status: "configured" | "unconfigured" | "removed";
  provider?: string;
  surface?: string;
  model?: string;
  previousProvider?: string;
  executable: boolean;
  contract: {
    mayModifySourceCode: boolean;
    mayWriteCanonicalMemory: boolean;
    forbiddenOutgoingTargets: string[];
    taskBinding: string;
    allowedTaskStatuses: string[];
  };
}

export interface EdgeModel {
  caller: AgentName;
  target: AgentName;
  immutable: boolean;
  contractReason: string;
  decision: RuleDecision;
  source: string;
}

export interface OverrideModel {
  key:
    | { kind: "agent_call"; caller: string; target: string }
    | { kind: "action"; action: string };
  decision: RuleDecision;
}

export interface ProjectModel {
  id: string;
  name: string;
  sourcePath: string;
  tasks: { id: string; description: string; status: string }[];
}

export interface ProviderDiagnostic {
  provider: string;
  runtime: string;
  available: boolean;
  version?: string;
  registrationMinimum: string;
  registered: boolean;
  supportedAsHost: boolean;
  supportedAsTarget: boolean;
  targetUnavailableReason?: string;
}

export interface DiagnosticsModel {
  platform: string;
  nodeVersion: string;
  providers: ProviderDiagnostic[];
}

export interface StatusModel {
  agents: number;
  configured: number;
  unconfigured: number;
  executableTargets: number;
  providers: number;
  registeredProviders: number;
  configVersion: string;
  decisions: RuleDecision[];
}

export interface ScopeSelection {
  scope: "global" | "project" | "task";
  projectId?: string;
  taskId?: string;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "x-synaphex-configure-token": TOKEN,
      ...(init.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const body = payload as { error?: string; message?: string };
    throw new ApiError(
      body.error ?? "unknown_error",
      body.message ?? "The configure server refused that request.",
      response.status,
    );
  }
  return payload as T;
}

function scopeQuery(scope: ScopeSelection): string {
  const params = new URLSearchParams({ scope: scope.scope });
  if (scope.projectId) params.set("projectId", scope.projectId);
  if (scope.taskId) params.set("taskId", scope.taskId);
  return params.toString();
}

export const api = {
  status: () => request<StatusModel>("/api/status"),
  agents: () => request<{ agents: AgentModel[] }>("/api/agents"),
  rules: (scope: ScopeSelection) =>
    request<{ edges: EdgeModel[]; overrides: OverrideModel[] }>(
      `/api/rules?${scopeQuery(scope)}`,
    ),
  projects: () => request<{ projects: ProjectModel[] }>("/api/projects"),
  diagnostics: () =>
    request<DiagnosticsModel>("/api/diagnostics"),
  configPreview: () =>
    request<{
      documents: { file: string; path: string; content: string | null }[];
      configVersion: string;
    }>("/api/config-preview"),

  saveAgent: (
    agent: AgentName,
    body: { provider: string; surface: string; model: string },
    configVersion: string,
  ) =>
    request<{ ok: true; configVersion: string }>(`/api/agents/${agent}`, {
      method: "PUT",
      body: JSON.stringify({ ...body, configVersion }),
    }),

  clearAgent: (agent: AgentName, configVersion: string) =>
    request<{ ok: true; configVersion: string }>(`/api/agents/${agent}`, {
      method: "DELETE",
      body: JSON.stringify({ configVersion }),
    }),

  saveRule: (
    body: {
      caller: AgentName;
      target: AgentName;
      decision: RuleDecision | "inherit";
    } & ScopeSelection,
    configVersion: string,
  ) =>
    request<{ ok: true; configVersion: string }>("/api/rules", {
      method: "PUT",
      body: JSON.stringify({ ...body, configVersion }),
    }),
};
