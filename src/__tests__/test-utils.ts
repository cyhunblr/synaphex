import { mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";

export async function createTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "synaphex-test-"));
}

export function cleanupTmpDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors on Windows/macOS where files may be locked
  }
}

export interface TestProject {
  projectDir: string;
  memoryDir: string;
  internalDir: string;
  externalDir: string;
}

export async function createTestProject(
  projectDir: string,
  options?: {
    languages?: string[];
    frameworks?: string[];
  },
): Promise<TestProject> {
  const memoryDir = join(projectDir, "memory");
  const internalDir = join(memoryDir, "internal");
  const externalDir = join(memoryDir, "external");
  const researchDir = join(internalDir, "research");

  mkdirSync(projectDir, { recursive: true });
  mkdirSync(internalDir, { recursive: true });
  mkdirSync(externalDir, { recursive: true });
  mkdirSync(researchDir, { recursive: true });

  // Create base memory files
  const baseFiles = {
    "overview.md": "# Project Overview\n",
    "architecture.md": "# Architecture\n",
    "conventions.md": "# Conventions\n",
    "security.md": "# Security\n",
    "dependencies.md": "# Dependencies\n",
  };

  for (const [filename, content] of Object.entries(baseFiles)) {
    writeFileSync(join(internalDir, filename), content);
  }

  // Create language-specific guidelines
  if (options?.languages) {
    for (const lang of options.languages) {
      writeFileSync(
        join(internalDir, `${lang}-guidelines.md`),
        `# ${lang.charAt(0).toUpperCase() + lang.slice(1)} Guidelines\n`,
      );
    }
  }

  // Create framework directories
  if (options?.frameworks) {
    for (const framework of options.frameworks) {
      const frameworkDir = join(internalDir, framework);
      mkdirSync(frameworkDir, { recursive: true });

      const frameworkFiles = {
        "setup.md": `# ${framework} Setup\n`,
        "patterns.md": `# ${framework} Patterns\n`,
        "troubleshooting.md": `# ${framework} Troubleshooting\n`,
      };

      for (const [filename, content] of Object.entries(frameworkFiles)) {
        writeFileSync(join(frameworkDir, filename), content);
      }
    }
  }

  return {
    projectDir,
    memoryDir,
    internalDir,
    externalDir,
  };
}

export function readTestFile(filePath: string): string {
  return readFileSync(filePath, "utf-8");
}

export function writeTestFile(filePath: string, content: string): void {
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content);
}

export function mockResearcher() {
  return {
    execute: jest.fn().mockResolvedValue({
      findings: "Test research findings",
      sources: ["https://example.com"],
    }),
  };
}

export function mockWebSearch() {
  return jest.fn().mockResolvedValue({
    results: [
      {
        title: "Test Result",
        url: "https://example.com",
        snippet: "Test snippet",
      },
    ],
  });
}

interface GlobalWithTestDir {
  testDir?: string;
}

export function setupTestEnvironment() {
  beforeEach(async () => {
    // Setup per-test tmpdir
    const testDir = await createTmpDir();
    (global as GlobalWithTestDir).testDir = testDir;
  });

  afterEach(() => {
    const testDir = (global as GlobalWithTestDir).testDir;
    if (testDir) {
      cleanupTmpDir(testDir);
    }
  });
}
