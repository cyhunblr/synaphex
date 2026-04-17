import { createHash } from "node:crypto";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { glob } from "glob";
import { projectExists, projectDir } from "../lib/project-store.js";
import { initializeMemoryStructure } from "../memory/structure.js";

interface MemorizeOptions {
  force?: boolean;
  languages?: string[];
  frameworks?: string[];
}

interface ContentAnalysis {
  overview: string;
  architecture: string;
  conventions: string;
  security: string;
}

export async function handleMemorize(
  project: string,
  cwd: string,
  options: MemorizeOptions = {},
): Promise<string> {
  if (!(await projectExists(project))) {
    throw new Error(`Project '${project}' does not exist.`);
  }

  const pDir = projectDir(project);
  const metaPath = path.join(pDir, "memory", ".meta.json");

  await initializeMemoryStructure(pDir, {
    languages: options.languages,
    frameworks: options.frameworks,
  });

  const analysis = await analyzeCodbase(cwd);
  const contentHash = computeContentHash(analysis);

  if (!options.force && (await metaExists(metaPath))) {
    const existing = await readMeta(metaPath);
    if (existing.contentHash === contentHash) {
      return "Skipped memorize (content unchanged)";
    }
  }

  await updateMemoryFiles(pDir, analysis);
  await writeMeta(metaPath, {
    contentHash,
    timestamp: new Date().toISOString(),
  });

  return `Memory updated for project '${project}'`;
}

async function analyzeCodbase(cwd: string): Promise<ContentAnalysis> {
  const overview = await extractOverview(cwd);
  const architecture = await extractArchitecture(cwd);
  const conventions = await extractConventions(cwd);
  const security = await extractSecurity();

  return { overview, architecture, conventions, security };
}

async function extractOverview(cwd: string): Promise<string> {
  let overview = "# Project Overview\n\n";

  try {
    const readmePath = path.join(cwd, "README.md");
    const readmeContent = await fs.readFile(readmePath, "utf-8");
    const firstSection = readmeContent.split("\n").slice(0, 20).join("\n");
    overview += `## From README\n${firstSection}\n\n`;
  } catch {
    // No README
  }

  try {
    const pkgPath = path.join(cwd, "package.json");
    const pkgContent = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgContent);
    overview += `## Package Info\n- Name: ${pkg.name}\n`;
    if (pkg.description) overview += `- Description: ${pkg.description}\n`;
    overview += "\n";
  } catch {
    // No package.json
  }

  overview += "## Key Constraints\n<!-- Analyzed from codebase structure -->\n";
  return overview;
}

async function extractArchitecture(cwd: string): Promise<string> {
  let arch = "# Architecture\n\n";
  const mainDir = path.join(cwd, "src");

  arch += "## System Design\n<!-- Extracted from codebase structure -->\n\n";
  arch += "## Key Components\n";

  try {
    const entries = await fs.readdir(mainDir, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .slice(0, 10);

    for (const dir of dirs) {
      arch += `- \`${dir.name}/\` - <!-- describe purpose -->\n`;
    }
  } catch {
    // Directory doesn't exist
  }

  arch += "\n## Data Flow\n<!-- How data moves through the system -->\n";
  arch +=
    "\n## Dependencies\n<!-- Major external dependencies and their roles -->\n";

  return arch;
}

async function extractConventions(cwd: string): Promise<string> {
  let conventions = "# Conventions\n\n";
  conventions +=
    "## Naming Conventions\n<!-- Extracted from codebase analysis -->\n";

  const files = await glob("**/*.{ts,tsx,js,jsx,py,cpp,h,hpp,c}", {
    cwd,
    nodir: true,
  });

  const lang = detectPrimaryLanguage(files);
  if (lang) {
    conventions += `Detected language: ${lang}\n\n`;
  }

  conventions += "## Code Style\n<!-- Extracted from source files -->\n";
  conventions += "## Architecture Patterns\n<!-- Common patterns found -->\n";
  conventions += "## Error Handling\n<!-- Error handling approach -->\n";

  return conventions;
}

async function extractSecurity(): Promise<string> {
  let security = "# Security\n\n";
  security += "## Threat Model\n<!-- Analyzed from codebase -->\n";
  security += "## Authentication\n<!-- Authentication mechanisms found -->\n";
  security += "## Authorization\n<!-- Authorization/permission model -->\n";
  security += "## Data Protection\n<!-- Data protection strategies -->\n";
  security += "## Compliance\n<!-- Regulatory/compliance requirements -->\n";

  return security;
}

function detectPrimaryLanguage(files: string[]): string | null {
  const typescriptCount = files.filter(
    (f) => f.endsWith(".ts") || f.endsWith(".tsx"),
  ).length;
  const pythonCount = files.filter((f) => f.endsWith(".py")).length;
  const cppCount = files.filter(
    (f) => f.endsWith(".cpp") || f.endsWith(".hpp"),
  ).length;

  if (typescriptCount > pythonCount && typescriptCount > cppCount) {
    return "TypeScript";
  } else if (pythonCount > cppCount) {
    return "Python";
  } else if (cppCount > 0) {
    return "C++";
  }

  return null;
}

function computeContentHash(analysis: ContentAnalysis): string {
  const content =
    analysis.overview +
    analysis.architecture +
    analysis.conventions +
    analysis.security;
  return createHash("sha256").update(content).digest("hex");
}

async function updateMemoryFiles(
  pDir: string,
  analysis: ContentAnalysis,
): Promise<void> {
  const internalDir = path.join(pDir, "memory", "internal");

  await fs.writeFile(
    path.join(internalDir, "overview.md"),
    analysis.overview,
    "utf-8",
  );
  await fs.writeFile(
    path.join(internalDir, "architecture.md"),
    analysis.architecture,
    "utf-8",
  );
  await fs.writeFile(
    path.join(internalDir, "conventions.md"),
    analysis.conventions,
    "utf-8",
  );
  await fs.writeFile(
    path.join(internalDir, "security.md"),
    analysis.security,
    "utf-8",
  );
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
