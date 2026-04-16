import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// === Constants ===

export const SYNAPHEX_HOME: string = path.join(os.homedir(), ".synaphex");

// === Path helpers (pure) ===

export function projectDir(project: string): string {
  return path.join(SYNAPHEX_HOME, project);
}

export function memoryDir(project: string): string {
  return path.join(projectDir(project), "memory");
}

export function internalMemoryDir(project: string): string {
  return path.join(memoryDir(project), "internal");
}

export function externalMemoryDir(project: string): string {
  return path.join(memoryDir(project), "external");
}

export function settingsPath(project: string): string {
  return path.join(projectDir(project), "settings.json");
}

export function metaPath(project: string): string {
  return path.join(projectDir(project), "meta.json");
}

export function tasksDir(project: string): string {
  return path.join(internalMemoryDir(project), "tasks");
}

export function taskSlugDir(project: string, slug: string): string {
  return path.join(tasksDir(project), slug);
}

// === Filesystem (async) ===

export async function ensureSynaphexHome(): Promise<void> {
  await fs.mkdir(SYNAPHEX_HOME, { recursive: true });
}

export async function projectExists(project: string): Promise<boolean> {
  try {
    const stat = await fs.stat(projectDir(project));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function listProjects(): Promise<string[]> {
  try {
    const entries = await fs.readdir(SYNAPHEX_HOME, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

export async function writeJsonFile(
  filePath: string,
  data: unknown,
): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// === Validation ===

const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function validateProjectName(name: string): {
  valid: boolean;
  error?: string;
} {
  if (typeof name !== "string" || name.length === 0) {
    return { valid: false, error: "Project name is required." };
  }
  if (name.length > 64) {
    return {
      valid: false,
      error: "Project name must be at most 64 characters.",
    };
  }
  if (!NAME_RE.test(name)) {
    return {
      valid: false,
      error:
        "Project name must start with a lowercase letter or digit and contain only " +
        "lowercase letters, digits, hyphens, or underscores.",
    };
  }
  if (name === "." || name === "..") {
    return { valid: false, error: "Project name cannot be '.' or '..'." };
  }
  return { valid: true };
}

// === Types ===

export interface ProjectMeta {
  name: string;
  createdAt: string;
  lastMemorizeAt?: string;
  lastMemorizeSourcePath?: string;
  memorizeContentHash?: string;
}
