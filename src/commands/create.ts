import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  ensureSynaphexHome,
  externalMemoryDir,
  internalMemoryDir,
  metaPath,
  projectDir,
  projectExists,
  settingsPath,
  validateProjectName,
  writeJsonFile,
  type ProjectMeta,
} from "../lib/project-store.js";
import { TOPIC_FILES } from "../lib/memory-scaffold.js";
import { createDefaultSettings } from "../lib/settings-schema.js";

export async function handleCreate(project: string): Promise<string> {
  const validation = validateProjectName(project);
  if (!validation.valid) {
    throw new Error(validation.error ?? "Invalid project name.");
  }

  await ensureSynaphexHome();

  if (await projectExists(project)) {
    throw new Error(
      `Project '${project}' already exists. Delete ~/.synaphex/${project}/ ` +
        `manually if you want to start fresh, then run /synaphex:create again.`,
    );
  }

  const root = projectDir(project);
  const internal = internalMemoryDir(project);
  const external = externalMemoryDir(project);
  const packagesDir = path.join(internal, "packages");

  // Create directory tree
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(internal, { recursive: true });
  await fs.mkdir(external, { recursive: true });
  await fs.mkdir(packagesDir, { recursive: true });

  // Write settings.json
  const now = new Date();
  const settings = createDefaultSettings(now);
  await writeJsonFile(settingsPath(project), settings);

  // Write meta.json
  const meta: ProjectMeta = {
    name: project,
    createdAt: now.toISOString(),
  };
  await writeJsonFile(metaPath(project), meta);

  // Write topic-based memory scaffold
  for (const file of TOPIC_FILES) {
    await fs.writeFile(
      path.join(internal, file.relPath),
      file.contents,
      "utf-8",
    );
  }

  const topicList = TOPIC_FILES.map(
    (f) => `  - memory/internal/${f.relPath}`,
  ).join("\n");
  return [
    `Created synaphex project '${project}' at ${root}`,
    "",
    "Files written:",
    "  - settings.json (default agent config)",
    "  - meta.json",
    topicList,
    "  - memory/internal/packages/  (empty — populated by /synaphex:memorize)",
    "  - memory/external/           (empty — populated by /synaphex:remember)",
    "",
    `Next: run \`/synaphex:memorize ${project} <source-path>\` to populate memory ` +
      `from a codebase, or edit ~/.synaphex/${project}/settings.json to tune ` +
      `agent defaults (Phase 2).`,
  ].join("\n");
}
