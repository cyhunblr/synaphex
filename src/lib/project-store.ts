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

export function validateTaskSequence(
  step: string,
  completedSteps: string[],
): {
  valid: boolean;
  error?: string;
} {
  const requiredSteps = [
    "create",
    "examine",
    "planner",
    "coder",
    "answerer",
    "reviewer",
  ];
  const optionalSteps = ["remember", "researcher"];
  const allSteps = [...requiredSteps, ...optionalSteps];

  if (!allSteps.includes(step)) {
    return { valid: false, error: `Unknown step: ${step}` };
  }

  if (completedSteps.includes(step)) {
    return {
      valid: false,
      error: `Step '${step}' has already been completed.`,
    };
  }

  const stepIndex = requiredSteps.indexOf(step);
  if (stepIndex !== -1) {
    const requiredPrior = requiredSteps.slice(0, stepIndex);
    const missingPrior = requiredPrior.filter(
      (s) => !completedSteps.includes(s),
    );
    if (missingPrior.length > 0) {
      return {
        valid: false,
        error: `Cannot run '${step}': ${missingPrior.map((s) => `'${s}'`).join(", ")} not completed yet.`,
      };
    }
  }

  // Optional steps: check if required prior step is done
  const optionalIndex = optionalSteps.indexOf(step);
  if (optionalIndex !== -1) {
    const optionalDeps: Record<string, string[]> = {
      remember: ["create"],
      researcher: ["examine"],
    };
    const deps = optionalDeps[step] || [];
    const missingDeps = deps.filter((s) => !completedSteps.includes(s));
    if (missingDeps.length > 0) {
      return {
        valid: false,
        error: `Cannot run '${step}': ${missingDeps.map((s) => `'${s}'`).join(", ")} not completed yet.`,
      };
    }
  }

  return { valid: true };
}

// === Edge Case Handling ===

export async function validateCompletedSteps(steps: unknown): Promise<{
  valid: boolean;
  repaired?: string[];
  error?: string;
}> {
  if (!Array.isArray(steps)) {
    return {
      valid: false,
      error: "completed_steps must be an array",
    };
  }

  const validSteps = [
    "create",
    "examine",
    "remember",
    "researcher",
    "planner",
    "coder",
    "answerer",
    "reviewer",
  ];
  const invalidSteps = steps.filter((s) => !validSteps.includes(s as string));

  if (invalidSteps.length > 0) {
    const repaired = steps.filter((s) => validSteps.includes(s as string));
    return {
      valid: false,
      repaired: repaired as string[],
      error: `Invalid steps found: ${invalidSteps.join(", ")}. Consider removing them.`,
    };
  }

  return { valid: true };
}

export async function gracefulReadJsonFile<T>(
  filePath: string,
  defaults: T,
): Promise<T> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    return parsed as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return defaults;
    }
    return defaults;
  }
}

export async function detectBrokenSymlinks(
  memoryDir: string,
): Promise<{ broken: string[] }> {
  const broken: string[] = [];

  try {
    const externalDir = path.join(memoryDir, "external");
    const entries = await fs.readdir(externalDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        const linkPath = path.join(externalDir, entry.name);
        try {
          await fs.access(linkPath);
        } catch {
          broken.push(entry.name);
        }
      }
    }
  } catch {
    // Ignore errors when reading external memory dir (may not exist)
  }

  return { broken };
}

// === Types ===

export interface ProjectMeta {
  name: string;
  createdAt: string;
  lastMemorizeAt?: string;
  lastMemorizeSourcePath?: string;
  memorizeContentHash?: string;
}
