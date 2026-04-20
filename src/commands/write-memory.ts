import * as path from "node:path";
import { promises as fs } from "node:fs";
import { projectDir, projectExists } from "../lib/project-store.js";
import { MEMORY_TOPICS, type MemoryTopic } from "../memory/structure.js";

const MAX_CONTENT_SIZE = 100 * 1024; // 100 KB limit per topic

export interface WriteMemoryResult {
  success: boolean;
  message: string;
  filePath?: string;
}

export async function handleWriteMemory(
  project: string,
  topic: string,
  content: string,
): Promise<WriteMemoryResult> {
  // Validate project exists
  if (!(await projectExists(project))) {
    return {
      success: false,
      message: `Project '${project}' does not exist`,
    };
  }

  // Validate topic is in allowlist
  if (!MEMORY_TOPICS.includes(topic as MemoryTopic)) {
    const allowed = MEMORY_TOPICS.join(", ");
    return {
      success: false,
      message: `Unknown topic '${topic}'. Allowed topics: ${allowed}`,
    };
  }

  // Validate content size
  if (content.length > MAX_CONTENT_SIZE) {
    const sizeKB = Math.round(content.length / 1024);
    const limitKB = Math.round(MAX_CONTENT_SIZE / 1024);
    return {
      success: false,
      message: `Content too large: ${sizeKB} KB (limit: ${limitKB} KB)`,
    };
  }

  try {
    const pDir = projectDir(project);
    const internalDir = path.join(pDir, "memory", "internal");
    const filePath = path.join(internalDir, `${topic}.md`);

    // Atomic write: write to temp file, then rename
    const tempFilePath = `${filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tempFilePath, content, "utf-8");
    await fs.rename(tempFilePath, filePath);

    return {
      success: true,
      message: `Memory topic '${topic}' written successfully`,
      filePath,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to write memory: ${errorMessage}`,
    };
  }
}
