import { createHash } from "node:crypto";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { glob } from "glob";
import { projectExists, projectDir } from "../lib/project-store.js";
import {
  initializeMemoryStructure,
  type MemoryTopic,
} from "../memory/structure.js";
import { buildTopicInstructions } from "./memorize-prompts.js";

interface MemorizeOptions {
  force?: boolean;
  languages?: string[];
  frameworks?: string[];
}

export interface StructuralFacts {
  treeSummary: string;
  detectedLanguages: string[];
  manifestFiles: Record<string, string>;
  readmeExcerpt: string;
}

interface TopicInstruction {
  topic: MemoryTopic;
  instruction: string;
}

export interface MemorizePayload {
  topics: TopicInstruction[];
  structuralFacts: StructuralFacts;
  contentHash: string;
  skip?: boolean;
  reason?: string;
}

export async function handleMemorize(
  project: string,
  cwd: string,
  options: MemorizeOptions = {},
): Promise<MemorizePayload> {
  if (!(await projectExists(project))) {
    throw new Error(`Project '${project}' does not exist.`);
  }

  if (!(await pathExists(cwd))) {
    throw new Error(`Source path does not exist: ${cwd}`);
  }

  const pDir = projectDir(project);
  const metaPath = path.join(pDir, "memory", ".meta.json");

  // Scaffold memory directory structure
  await initializeMemoryStructure(pDir, {
    languages: options.languages,
    frameworks: options.frameworks,
  });

  // Collect structural facts from the source tree
  const facts = await collectStructuralFacts(cwd);
  const contentHash = computeFactsHash(facts);

  // Check idempotency: if content hash unchanged and not forced, skip
  if (!options.force && (await metaExists(metaPath))) {
    const existing = await readMeta(metaPath);
    if (existing.contentHash === contentHash) {
      return {
        topics: [],
        structuralFacts: facts,
        contentHash,
        skip: true,
        reason: "Content unchanged since last memorize",
      };
    }
  }

  // Build topic instructions for the agent
  const topics = buildTopicInstructions(facts);

  // Persist the new hash (will be updated again after agent writes all topics)
  await writeMeta(metaPath, {
    contentHash,
    timestamp: new Date().toISOString(),
  });

  return {
    topics,
    structuralFacts: facts,
    contentHash,
  };
}

async function collectStructuralFacts(
  sourcePath: string,
): Promise<StructuralFacts> {
  // Collect directory tree (2 levels deep, max 200 entries per level)
  const treeSummary = await buildTreeSummary(sourcePath);

  // Detect primary language(s) from file extensions
  const detectedLanguages = await detectLanguages(sourcePath);

  // Find and read manifest files
  const manifestFiles = await collectManifestFiles(sourcePath);

  // Extract README excerpt (first 40 lines)
  const readmeExcerpt = await extractReadmeExcerpt(sourcePath);

  return {
    treeSummary,
    detectedLanguages,
    manifestFiles,
    readmeExcerpt,
  };
}

async function buildTreeSummary(
  sourcePath: string,
  depth = 0,
  maxDepth = 2,
): Promise<string> {
  if (depth > maxDepth) return "";

  const indent = "  ".repeat(depth);
  let summary = "";

  try {
    const entries = await fs.readdir(sourcePath, { withFileTypes: true });
    const sorted = entries
      .filter((e) => !e.name.startsWith("."))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) {
          return b.isDirectory() ? 1 : -1;
        }
        return a.name.localeCompare(b.name);
      })
      .slice(0, 200);

    for (const entry of sorted) {
      if (entry.isDirectory()) {
        summary += `${indent}📁 ${entry.name}/\n`;
        if (depth < maxDepth) {
          summary += await buildTreeSummary(
            path.join(sourcePath, entry.name),
            depth + 1,
            maxDepth,
          );
        }
      } else {
        summary += `${indent}📄 ${entry.name}\n`;
      }
    }
  } catch {
    // Directory not readable
  }

  return summary;
}

async function detectLanguages(sourcePath: string): Promise<string[]> {
  const languageMap: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TypeScript",
    js: "JavaScript",
    jsx: "JavaScript",
    py: "Python",
    cpp: "C++",
    hpp: "C++",
    h: "C++",
    c: "C",
    java: "Java",
    go: "Go",
    rs: "Rust",
    rb: "Ruby",
    php: "PHP",
  };

  const counts: Record<string, number> = {};

  try {
    const files = await glob(
      "**/*.{ts,tsx,js,jsx,py,cpp,hpp,h,c,java,go,rs,rb,php}",
      {
        cwd: sourcePath,
        nodir: true,
      },
    );

    for (const file of files) {
      const ext = path.extname(file).slice(1);
      const lang = languageMap[ext];
      if (lang) {
        counts[lang] = (counts[lang] || 0) + 1;
      }
    }
  } catch {
    // Glob failed
  }

  // Return languages sorted by count (most frequent first)
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([lang]) => lang);
}

async function collectManifestFiles(
  sourcePath: string,
): Promise<Record<string, string>> {
  const manifestFileNames = [
    "package.json",
    "pyproject.toml",
    "CMakeLists.txt",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "setup.py",
    "requirements.txt",
    "Makefile",
  ];

  const result: Record<string, string> = {};

  for (const fileName of manifestFileNames) {
    const filePath = path.join(sourcePath, fileName);
    try {
      let content = await fs.readFile(filePath, "utf-8");
      // Cap at 200 lines for readability
      const lines = content.split("\n");
      if (lines.length > 200) {
        content = lines.slice(0, 200).join("\n") + "\n... (truncated)";
      }
      result[fileName] = content;
    } catch {
      // File not found, skip
    }
  }

  return result;
}

async function extractReadmeExcerpt(sourcePath: string): Promise<string> {
  try {
    const readmePath = path.join(sourcePath, "README.md");
    const content = await fs.readFile(readmePath, "utf-8");
    const lines = content.split("\n");
    const excerpt = lines.slice(0, 40).join("\n");
    return excerpt.length < content.length
      ? excerpt + "\n... (truncated)"
      : excerpt;
  } catch {
    return "(No README.md found)";
  }
}

function computeFactsHash(facts: StructuralFacts): string {
  const content =
    facts.treeSummary +
    facts.detectedLanguages.join(",") +
    JSON.stringify(facts.manifestFiles) +
    facts.readmeExcerpt;
  return createHash("sha256").update(content).digest("hex");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function metaExists(metaPath: string): Promise<boolean> {
  try {
    await fs.access(metaPath);
    return true;
  } catch {
    return false;
  }
}

async function readMeta(metaPath: string): Promise<{ contentHash: string }> {
  const content = await fs.readFile(metaPath, "utf-8");
  return JSON.parse(content);
}

async function writeMeta(
  metaPath: string,
  data: { contentHash: string; timestamp: string },
): Promise<void> {
  await fs.writeFile(metaPath, JSON.stringify(data, null, 2), "utf-8");
}
