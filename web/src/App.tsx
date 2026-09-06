import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  api,
  type AgentModel,
  type AgentName,
  type DiagnosticsModel,
  type EdgeModel,
  type ModelCapabilityCatalog,
  type ProjectModel,
  type RuleDecision,
  type ScopeSelection,
  type StatusModel,
} from "./api";
import { AgentConfigView } from "./AgentConfigView";
import { DiagnosticsView } from "./DiagnosticsView";
import { AGENT_ORDER, HexGraph } from "./HexGraph";

type View = "overview" | "rules" | "projects" | "diagnostics" | "files";

interface Toast {
  tone: "ok" | "bad" | "warn";
  message: string;
}

export function App() {
  const [view, setView] = useState<View>("overview");
  const [status, setStatus] = useState<StatusModel | null>(null);
  const [agents, setAgents] = useState<AgentModel[]>([]);
  const [edges, setEdges] = useState<EdgeModel[]>([]);
  const [projects, setProjects] = useState<ProjectModel[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsModel | null>(null);
  const [modelCapabilities, setModelCapabilities] =
    useState<ModelCapabilityCatalog | null>(null);
  const [selected, setSelected] = useState<AgentName | "user" | null>(null);
  const [scope, setScope] = useState<ScopeSelection>({ scope: "global" });
  const [toast, setToast] = useState<Toast | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * A refresh always re-reads canonical state. Nothing is cached across a
   * reload, so a browser refresh cannot resurrect a stale draft.
   */
  const refresh = useCallback(async () => {
    const [s, a, r, p, d, capabilities] = await Promise.all([
      api.status(),
      api.agents(),
      api.rules(scope),
      api.projects(),
      api.diagnostics(),
      api.modelCapabilities(),
    ]);
    setStatus(s);
    setAgents(a.agents);
    setEdges(r.edges);
    setProjects(p.projects);
    setDiagnostics(d);
    setModelCapabilities(capabilities);
    setLoading(false);
  }, [scope]);

  useEffect(() => {
    refresh().catch((error: unknown) => {
      setToast({ tone: "bad", message: describe(error) });
      setLoading(false);
    });
  }, [refresh]);

  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectedAgent = useMemo(
    () =>
      selected !== null && selected !== "user"
        ? (agents.find((agent) => agent.agent === selected) ?? null)
        : null,
    [agents, selected],
  );
  const providers = diagnostics?.providers ?? [];

  const act = async (work: () => Promise<unknown>, success: string) => {
    try {
      await work();
      await refresh();
      setToast({ tone: "ok", message: success });
    } catch (error) {
      setToast({
        tone: error instanceof ApiError && error.status === 409 ? "warn" : "bad",
        message: describe(error),
      });
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          Synaphex Configure<span>local configuration</span>
        </div>
        <nav className="nav" aria-label="Sections">
          {(
            [
              ["overview", "Overview"],
              ["rules", "Rules"],
              ["projects", "Projects"],
              ["diagnostics", "Diagnostics"],
              ["files", "Config Files"],
            ] as [View, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              aria-current={view === id ? "page" : undefined}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="main">
        <div className="content">
          {loading ? (
            <p className="muted">Reading configuration…</p>
          ) : view === "overview" ? (
            <>
              <Summary status={status} />
              <HexGraph
                agents={agents}
                edges={edges}
                selected={selected}
                onSelect={setSelected}
              />
            </>
          ) : view === "rules" ? (
            <RulesView
              edges={edges}
              projects={projects}
              scope={scope}
              onScope={setScope}
            />
          ) : view === "projects" ? (
            <ProjectsView projects={projects} />
          ) : view === "diagnostics" ? (
            diagnostics === null ? null : (
              <DiagnosticsView diagnostics={diagnostics} status={status} />
            )
          ) : (
            <FilesView />
          )}
        </div>

        {selected === "user" ? (
          <UserPanel status={status} onClose={() => setSelected(null)} onGo={setView} />
        ) : selectedAgent !== null && status !== null && modelCapabilities !== null ? (
          <AgentConfigView
            agent={selectedAgent}
            providers={providers}
            catalog={modelCapabilities}
            edges={edges.filter((edge) => edge.caller === selectedAgent.agent)}
            onClose={() => setSelected(null)}
            onSave={(body) =>
              act(
                () => api.saveAgent(selectedAgent.agent, body, status.configVersion),
                `${selectedAgent.agent} saved`,
              )
            }
            onClear={() =>
              act(
                () => api.clearAgent(selectedAgent.agent, status.configVersion),
                `${selectedAgent.agent} reset to unconfigured`,
              )
            }
            onRule={(target, decision) =>
              act(
                () =>
                  api.saveRule(
                    { caller: selectedAgent.agent, target, decision, ...scope },
                    status.configVersion,
                  ),
                `Rule updated`,
              )
            }
          />
        ) : null}
      </div>

      {toast !== null ? (
        <div className="toast" data-tone={toast.tone} role="status" aria-live="polite">
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

function Summary({ status }: { status: StatusModel | null }) {
  if (status === null) return null;
  return (
    <div className="summary">
      <Stat value={status.agents} label="Agents" />
      <Stat value={status.configured} label="Configured" />
      <Stat value={status.unconfigured} label="Unconfigured" />
      <Stat value={status.executableTargets} label="Executable targets" />
      <Stat value={`${status.registeredProviders}/${status.providers}`} label="Providers registered" />
    </div>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="stat">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

function UserPanel({
  status,
  onClose,
  onGo,
}: {
  status: StatusModel | null;
  onClose(): void;
  onGo(view: View): void;
}) {
  return (
    <aside className="drawer" aria-label="Global configuration">
      <h2>USER</h2>
      <p className="muted">
        You are the orchestrator. Synaphex never advances a workflow on its own:
        every agent runs because you asked for it.
      </p>
      <div className="notice">
        Rule precedence
        <br />
        <strong>task &rarr; project &rarr; global &rarr; default_deny</strong>
        <br />
        The first scope with a matching rule decides. Nothing matching anywhere
        is denied.
      </div>
      <div className="row">
        <button className="btn" onClick={() => onGo("rules")}>Global rules</button>
        <button className="btn" onClick={() => onGo("projects")}>Projects</button>
        <button className="btn" onClick={() => onGo("diagnostics")}>Diagnostics</button>
        <button className="btn" onClick={() => onGo("files")}>Config files</button>
      </div>
      {status !== null ? (
        <p className="muted" style={{ marginTop: 14 }}>
          Config version <code>{status.configVersion.slice(0, 12)}</code>
        </p>
      ) : null}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </aside>
  );
}

function RulesView({
  edges,
  projects,
  scope,
  onScope,
}: {
  edges: EdgeModel[];
  projects: ProjectModel[];
  scope: ScopeSelection;
  onScope(scope: ScopeSelection): void;
}) {
  const project = projects.find((entry) => entry.id === scope.projectId);
  return (
    <>
      <div className="notice">
        Effective decision resolves <strong>task &rarr; project &rarr; global &rarr; default_deny</strong>.
        The first scope with a rule wins; anything unmatched is denied.
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <div className="field" style={{ minWidth: 160 }}>
          <label htmlFor="scope">Scope</label>
          <select
            id="scope"
            value={scope.scope}
            onChange={(e) =>
              onScope({ scope: e.target.value as ScopeSelection["scope"] })
            }
          >
            <option value="global">global</option>
            <option value="project">project</option>
            <option value="task">task</option>
          </select>
        </div>
        {scope.scope !== "global" ? (
          <div className="field" style={{ minWidth: 220 }}>
            <label htmlFor="project">Project</label>
            <select
              id="project"
              value={scope.projectId ?? ""}
              onChange={(e) => onScope({ ...scope, projectId: e.target.value })}
            >
              <option value="">select…</option>
              {projects.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.name}</option>
              ))}
            </select>
          </div>
        ) : null}
        {scope.scope === "task" && project !== undefined ? (
          <div className="field" style={{ minWidth: 260 }}>
            <label htmlFor="task">Task</label>
            <select
              id="task"
              value={scope.taskId ?? ""}
              onChange={(e) => onScope({ ...scope, taskId: e.target.value })}
            >
              <option value="">select…</option>
              {project.tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.description.slice(0, 48)} ({task.status})
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <table>
        <thead>
          <tr><th>Caller</th><th>Target</th><th>Effective</th><th>Decided by</th></tr>
        </thead>
        <tbody>
          {edges.map((edge) => (
            <tr key={`${edge.caller}-${edge.target}`}>
              <td>{edge.caller}</td>
              <td>{edge.target}</td>
              <td>
                {edge.immutable ? (
                  <span className="badge" data-tone="bad">forbidden by role contract</span>
                ) : (
                  edge.decision
                )}
              </td>
              <td className="muted">{edge.immutable ? "role contract" : edge.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ProjectsView({ projects }: { projects: ProjectModel[] }) {
  if (projects.length === 0) {
    return <p className="muted">No projects registered yet.</p>;
  }
  return (
    <>
      {projects.map((project) => (
        <section key={project.id} style={{ marginBottom: 22 }}>
          <h2 style={{ fontSize: 15, marginBottom: 2 }}>{project.name}</h2>
          <p className="muted" style={{ fontSize: 12 }}>
            <code>{project.id}</code> · {project.sourcePath}
          </p>
          <table>
            <thead>
              <tr><th>Task</th><th>Status</th></tr>
            </thead>
            <tbody>
              {project.tasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.description.slice(0, 70)}</td>
                  <td>
                    <span className="badge" data-tone={task.status === "active" ? "ok" : undefined}>
                      {task.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}

function FilesView() {
  const [documents, setDocuments] = useState<
    { file: string; path: string; content: string | null }[]
  >([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .configPreview()
      .then((preview) => setDocuments(preview.documents))
      .catch((cause: unknown) => setError(describe(cause)));
  }, []);

  if (error !== null) {
    return <div className="notice" data-tone="bad">{error}</div>;
  }
  return (
    <>
      <div className="notice">
        Read-only preview. These files stay the single configuration authority
        and remain editable by hand outside this app.
      </div>
      {documents.map((document) => (
        <section key={document.file} style={{ marginBottom: 18 }}>
          <h2 style={{ fontSize: 14, marginBottom: 4 }}>{document.file}</h2>
          <p className="muted" style={{ fontSize: 12 }}><code>{document.path}</code></p>
          <pre>{document.content ?? "(not created yet)"}</pre>
        </section>
      ))}
    </>
  );
}

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return "The configure server could not be reached.";
}

export { AGENT_ORDER };
