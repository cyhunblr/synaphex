import * as path from "node:path";
import { promises as fs } from "node:fs";
import { platform } from "node:os";
import { projectExists, projectDir } from "../lib/project-store.js";

interface RememberOptions {
  force?: boolean;
}

export async function handleRemember(
  parentProject: string,
  childProject: string,
  options: RememberOptions = {},
): Promise<string> {
  if (!(await projectExists(parentProject))) {
    throw new Error(`Parent project '${parentProject}' does not exist.`);
  }

  if (!(await projectExists(childProject))) {
    throw new Error(`Child project '${childProject}' does not exist.`);
  }

  const parentDirPath = projectDir(parentProject);
  const childDirPath = projectDir(childProject);

  const parentMemoryDir = path.join(parentDirPath, "memory", "internal");
  const childExternalDir = path.join(childDirPath, "memory", "external");
  const symlinkName = `${parentProject}_memory`;
  const symlinkPath = path.join(childExternalDir, symlinkName);

  await fs.mkdir(childExternalDir, { recursive: true });

  const symlinkExists = await checkSymlink(symlinkPath);

  if (symlinkExists && !options.force) {
    const currentTarget = await fs.readlink(symlinkPath);
    if (path.resolve(currentTarget) === path.resolve(parentMemoryDir)) {
      return "Child project already linked to parent memory (no changes made)";
    }
    await fs.unlink(symlinkPath);
  } else if (symlinkExists) {
    await fs.unlink(symlinkPath);
  }

  try {
    if (platform() === "win32") {
      try {
        await fs.symlink(parentMemoryDir, symlinkPath, "dir");
      } catch {
        await copyDirectory(parentMemoryDir, symlinkPath);
        return "Linked parent memory to child (copied on Windows)";
      }
    } else {
      await fs.symlink(parentMemoryDir, symlinkPath, "dir");
    }
  } catch (err) {
    throw new Error(
      `Failed to link parent memory: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  return `Child project '${childProject}' linked to parent '${parentProject}' memory`;
}

async function checkSymlink(symlinkPath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(symlinkPath);
    return stat.isSymbolicLink() || stat.isDirectory();
  } catch {
    return false;
  }
}

async function copyDirectory(
  source: string,
  destination: string,
): Promise<void> {
  await fs.mkdir(destination, { recursive: true });

  const entries = await fs.readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destPath);
    } else {
      await fs.copyFile(sourcePath, destPath);
    }
  }
}
