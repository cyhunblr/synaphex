import type { Project } from "../domain/project.js";

export function projectStateDirectory(project: Project): string {
  return `projects/${project.id}_${safeProjectName(project.name)}`;
}

function safeProjectName(name: string): string {
  const safeName = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64);

  return safeName || "project";
}
