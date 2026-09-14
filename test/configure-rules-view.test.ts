import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  changeRuleProject,
  changeRuleScope,
  changeRuleTask,
  completeScopeForRequest,
  ruleScopeForRequest,
  RulesView,
} from "../web/src/RulesView.js";
import type { ProjectModel, ScopeSelection } from "../web/src/api.js";

const projects: ProjectModel[] = [
  {
    id: "project-a",
    name: "Project A",
    sourcePath: "/workspace/a",
    tasks: [
      { id: "task-active", description: "Active task", status: "active" },
      { id: "task-archived", description: "Archived task", status: "archived" },
    ],
  },
  {
    id: "project-b",
    name: "Project B",
    sourcePath: "/workspace/b",
    tasks: [{ id: "task-b", description: "Other task", status: "completed" }],
  },
];

test("empty projects disable impossible scopes and explain the empty state", () => {
  const html = renderToStaticMarkup(
    createElement(RulesView, {
      edges: [],
      projects: [],
      scope: { scope: "global" },
      onScope: () => undefined,
    }),
  );
  assert.match(html, /No projects available/);
  assert.match(html, /Project and Task rule scopes become available/);
  assert.match(html, /<option value="project" disabled="">Project<\/option>/);
  assert.match(html, /<option value="task" disabled="">Task<\/option>/);
});

test("scope transitions are project-first and changing project clears task", () => {
  let scope: ScopeSelection = { scope: "global" };
  scope = changeRuleScope(scope, "project", projects);
  assert.deepEqual(scope, { scope: "project" });
  assert.equal(completeScopeForRequest(scope), null);

  scope = changeRuleProject("project-a", projects);
  assert.deepEqual(scope, { scope: "project", projectId: "project-a" });
  assert.deepEqual(completeScopeForRequest(scope), {
    scope: "project",
    projectId: "project-a",
  });

  scope = changeRuleTask(scope, "task-active", projects);
  assert.deepEqual(scope, {
    scope: "project",
    projectId: "project-a",
    taskId: "task-active",
  });
  scope = changeRuleScope(scope, "task", projects);
  assert.deepEqual(scope, {
    scope: "task",
    projectId: "project-a",
    taskId: "task-active",
  });

  scope = changeRuleProject("project-b", projects);
  assert.deepEqual(scope, { scope: "project", projectId: "project-b" });
  assert.equal(scope.taskId, undefined);
  assert.deepEqual(changeRuleScope(scope, "global", projects), { scope: "global" });
});

test("incomplete task state cannot emit a task-scoped request", () => {
  const incomplete: ScopeSelection = { scope: "task", projectId: "project-a" };
  let requests = 0;
  if (completeScopeForRequest(incomplete) !== null) requests += 1;
  assert.equal(requests, 0);
  assert.equal(ruleScopeForRequest(incomplete, projects), null);
  assert.equal(
    ruleScopeForRequest(
      { scope: "task", projectId: "project-a", taskId: "not-a-task" },
      projects,
    ),
    null,
  );
});

test("archived tasks remain visible and labeled without lifecycle controls", () => {
  const html = renderToStaticMarkup(
    createElement(RulesView, {
      edges: [],
      projects,
      scope: { scope: "project", projectId: "project-a" },
      onScope: () => undefined,
    }),
  );
  assert.match(html, /Archived task \(archived\)/);
  assert.doesNotMatch(html, /Archive task|Resume task|Delete task/);
  assert.match(html, /<option value="task" disabled="">Task<\/option>/);
});
