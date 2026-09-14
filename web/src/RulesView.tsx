import type { EdgeModel, ProjectModel, ScopeSelection } from "./api.js";

export function ruleScopeForRequest(
  scope: ScopeSelection,
  projects: ProjectModel[],
): ScopeSelection | null {
  const complete = completeScopeForRequest(scope);
  if (complete === null) return null;
  if (complete.scope === "global") return complete;
  const project = projects.find((entry) => entry.id === scope.projectId);
  if (project === undefined) return null;
  if (scope.scope === "project") {
    return { scope: "project", projectId: project.id };
  }
  const task = project.tasks.find((entry) => entry.id === scope.taskId);
  return task === undefined
    ? null
    : { scope: "task", projectId: project.id, taskId: task.id };
}

export function completeScopeForRequest(
  scope: ScopeSelection,
): ScopeSelection | null {
  if (scope.scope === "global") return { scope: "global" };
  if (scope.projectId === undefined || scope.projectId.length === 0) return null;
  if (scope.scope === "project") {
    return { scope: "project", projectId: scope.projectId };
  }
  if (scope.taskId === undefined || scope.taskId.length === 0) return null;
  return { scope: "task", projectId: scope.projectId, taskId: scope.taskId };
}

export function changeRuleScope(
  current: ScopeSelection,
  nextScope: ScopeSelection["scope"],
  projects: ProjectModel[],
): ScopeSelection {
  if (nextScope === "global") return { scope: "global" };
  if (nextScope === "project") {
    const project = projects.find((entry) => entry.id === current.projectId);
    if (project === undefined) return { scope: "project" };
    const task = project.tasks.find((entry) => entry.id === current.taskId);
    return {
      scope: "project",
      projectId: project.id,
      ...(task === undefined ? {} : { taskId: task.id }),
    };
  }
  const candidate = ruleScopeForRequest({ ...current, scope: "task" }, projects);
  return candidate ?? current;
}

export function changeRuleProject(
  projectId: string,
  projects: ProjectModel[],
): ScopeSelection {
  return projects.some((entry) => entry.id === projectId)
    ? { scope: "project", projectId }
    : { scope: "project" };
}

export function changeRuleTask(
  current: ScopeSelection,
  taskId: string,
  projects: ProjectModel[],
): ScopeSelection {
  const project = projects.find((entry) => entry.id === current.projectId);
  if (project === undefined) return { scope: "project" };
  const task = project.tasks.find((entry) => entry.id === taskId);
  if (task === undefined) return { scope: "project", projectId: project.id };
  return { ...current, projectId: project.id, taskId: task.id };
}

export function RulesView({
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
  const taskSelected = project?.tasks.some((entry) => entry.id === scope.taskId) === true;
  const requestable = ruleScopeForRequest(scope, projects) !== null;

  return (
    <>
      <div className="notice">
        Effective decision resolves <strong>task &rarr; project &rarr; global &rarr; default_deny</strong>.
        The first scope with a rule wins; anything unmatched is denied.
      </div>

      {projects.length === 0 ? (
        <div className="notice" data-tone="warn">
          <strong>No projects available.</strong><br />
          Project and Task rule scopes become available after a project exists.
        </div>
      ) : null}

      <div className="scope-controls">
        <div className="field">
          <label htmlFor="scope">Rule scope</label>
          <select
            id="scope"
            value={scope.scope}
            onChange={(event) =>
              onScope(
                changeRuleScope(
                  scope,
                  event.target.value as ScopeSelection["scope"],
                  projects,
                ),
              )
            }
          >
            <option value="global">Global</option>
            <option value="project" disabled={projects.length === 0}>Project</option>
            <option value="task" disabled={project === undefined || !taskSelected}>Task</option>
          </select>
        </div>

        {scope.scope !== "global" ? (
          <div className="field">
            <label htmlFor="project">Project</label>
            <select
              id="project"
              value={scope.projectId ?? ""}
              onChange={(event) => onScope(changeRuleProject(event.target.value, projects))}
            >
              <option value="">Select a project</option>
              {projects.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.name}</option>
              ))}
            </select>
          </div>
        ) : null}

        {scope.scope !== "global" && project !== undefined ? (
          <div className="field">
            <label htmlFor="task">Task</label>
            <select
              id="task"
              value={scope.taskId ?? ""}
              onChange={(event) => onScope(changeRuleTask(scope, event.target.value, projects))}
            >
              <option value="">Select a task</option>
              {project.tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.description.slice(0, 48)} ({task.status})
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {!requestable ? (
        <div className="notice" data-tone="warn" role="status">
          {scope.scope === "project"
            ? "Select a project to inspect project-scoped rules."
            : "Select a valid project and task before choosing Task scope."}
        </div>
      ) : (
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
                  ) : edge.decision}
                </td>
                <td className="muted">{edge.immutable ? "role contract" : edge.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
