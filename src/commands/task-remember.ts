/**
 * Task Remember command: Link parent project memory into child project before task examine.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  externalMemoryDir,
  internalMemoryDir,
  projectExists,
  validateProjectName,
  taskSlugDir,
  readJsonFile,
  writeJsonFile,
} from "../lib/project-store.js";
import type { TaskMeta } from "../lib/pipeline-types.js";
import { validateTaskSequence } from "../lib/project-store.js";

export async function handleTaskRemember(
  parentProject: string,
  childProject: string,
  slug: string,
): Promise<string> {
  const parentValidation = validateProjectName(parentProject);
  if (!parentValidation.valid) {
    throw new Error(`Invalid parent project name: ${parentValidation.error}`);
  }

  const childValidation = validateProjectName(childProject);
  if (!childValidation.valid) {
    throw new Error(`Invalid child project name: ${childValidation.error}`);
  }

  // Self-reference check
  if (parentProject === childProject) {
    throw new Error("Cannot remember a project into itself.");
  }

  // Check parent exists
  if (!(await projectExists(parentProject))) {
    throw new Error(`Parent project '${parentProject}' does not exist.`);
  }

  // Check child exists
  if (!(await projectExists(childProject))) {
    throw new Error(`Child project '${childProject}' does not exist.`);
  }

  // Check task exists
  const taskDir = taskSlugDir(childProject, slug);
  const metaPath = path.join(taskDir, "task-meta.json");
  let meta: TaskMeta;
  try {
    meta = await readJsonFile<TaskMeta>(metaPath);
  } catch {
    throw new Error(
      `Task '${slug}' does not exist in project '${childProject}'.`,
    );
  }

  // Validate state: can run remember only after create
  const validation = validateTaskSequence("remember", meta.completed_steps);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const sourceDir = internalMemoryDir(parentProject);
  const linkName = `${parentProject}_memory`;
  const destDir = externalMemoryDir(childProject);
  const destPath = path.join(destDir, linkName);

  // Ensure external memory directory exists
  await fs.mkdir(destDir, { recursive: true });

  // Remove existing link/dir/file if present
  try {
    const stat = await fs.lstat(destPath); // lstat doesn't follow symlinks
    if (stat.isSymbolicLink() || stat.isDirectory()) {
      if (stat.isSymbolicLink()) {
        await fs.unlink(destPath);
      } else {
        // Recursive remove for directory fallback from previous copy
        await fs.rm(destPath, { recursive: true });
      }
    } else {
      // Regular file
      await fs.unlink(destPath);
    }
  } catch (err: unknown) {
    // Doesn't exist yet — that's fine
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  // Try to create symlink
  let usedCopy = false;
  try {
    await fs.symlink(sourceDir, destPath, "dir");
  } catch {
    // Fallback to recursive copy
    usedCopy = true;
    await copyDir(sourceDir, destPath);
  }

  // Update task state: append "remember" to completed_steps
  if (!meta.completed_steps.includes("remember")) {
    meta.completed_steps.push("remember");
  }
  await writeJsonFile(metaPath, meta);

  const linkType = usedCopy ? "copy" : "symlink";
  return [
    `Linked ${parentProject}'s memory into ${childProject}'s task '${slug}'.`,
    "",
    `- Source: ${sourceDir}`,
    `- Destination: ${destPath}`,
    `- Link type: ${linkType}`,
    "",
    `Task can now access ${parentProject}'s memory via external memory links.`,
  ].join("\n");
}

/**
 * Recursively copy a directory (fallback when symlink creation fails).
 */
async function copyDir(src: string, dest: string): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
