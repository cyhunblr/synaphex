import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  externalMemoryDir,
  internalMemoryDir,
  projectExists,
  settingsPath,
  readJsonFile,
} from "../lib/project-store.js";
import { TOPIC_FILES, isScaffoldOnly } from "../lib/memory-scaffold.js";
import {
  summarizeAgents,
  type SynaphexSettings,
} from "../lib/settings-schema.js";

const PER_FILE_CAP = 8_000; // characters per memory file
const TOTAL_CAP = 100_000; // total digest cap

interface DigestState {
  lines: string[];
  charCount: number;
  perFileCap: number;
}

function addLine(state: DigestState, line: string): void {
  state.lines.push(line);
  state.charCount += line.length + 1; // +1 for newline
}

function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars - 20) + "\n\n[... truncated ...]";
}

async function walkMemoryDir(
  dirPath: string,
  state: DigestState,
): Promise<void> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const filePath = path.join(dirPath, entry.name);
        const relPath = path.relative(dirPath, filePath);
        try {
          const content = await fs.readFile(filePath, "utf-8");
          const truncated = truncateContent(content, state.perFileCap);
          addLine(state, `### ${relPath}`);
          if (truncated.trim() === "") {
            addLine(state, "(empty)");
          } else {
            addLine(state, truncated);
          }
          addLine(state, "");
        } catch {
          addLine(state, `### ${relPath}`);
          addLine(state, "(error reading file)");
          addLine(state, "");
        }
      }
    }
  } catch {
    // dir doesn't exist or can't be read
  }
}

export async function handleLoad(project: string): Promise<string> {
  if (!(await projectExists(project))) {
    throw new Error(
      `Project '${project}' does not exist. ` +
        `Use the 'create' tool ${project} to create it first.`,
    );
  }

  const settings = await readJsonFile<SynaphexSettings>(settingsPath(project));
  const internal = internalMemoryDir(project);
  const external = externalMemoryDir(project);

  const state: DigestState = {
    lines: [],
    charCount: 0,
    perFileCap: PER_FILE_CAP,
  };

  // Header
  addLine(state, `synaphex load ${project}`);
  addLine(state, "");

  // Settings summary
  addLine(state, "## Settings");
  addLine(state, `- Version: ${settings.version}`);
  addLine(state, `- Created: ${settings.createdAt}`);
  addLine(state, `- Agents: ${summarizeAgents(settings)}`);
  addLine(state, "");

  // Check if we're over cap and need to degrade
  if (state.charCount > TOTAL_CAP * 0.8) {
    state.perFileCap = 4_000;
  }

  // Internal memory
  addLine(state, "## Internal Memory");
  addLine(state, "");
  for (const file of TOPIC_FILES) {
    const filePath = path.join(internal, file.relPath);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const status = isScaffoldOnly(content, file.contents)
        ? "(empty)"
        : `(${content.split("\n").length} lines)`;

      addLine(state, `### ${file.relPath}`);
      if (status === "(empty)") {
        addLine(state, status);
      } else {
        const truncated = truncateContent(content, state.perFileCap);
        addLine(state, truncated);
      }
      addLine(state, "");
    } catch {
      addLine(state, `### ${file.relPath}`);
      addLine(state, "(error reading file)");
      addLine(state, "");
    }

    if (state.charCount > TOTAL_CAP) break;
  }

  // Packages subdirectory
  addLine(state, "### packages/");
  try {
    const packagesDir = path.join(internal, "packages");
    const entries = await fs.readdir(packagesDir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        try {
          const filePath = path.join(packagesDir, entry.name);
          const content = await fs.readFile(filePath, "utf-8");
          const firstLine = content.split("\n")[1] || "(empty)";
          addLine(state, `- \`${entry.name}\` — ${firstLine.slice(0, 60)}`);
        } catch {
          addLine(state, `- \`${entry.name}\` — (error reading)`);
        }
      }
    }
  } catch {
    addLine(state, "(packages directory not found)");
  }
  addLine(state, "");

  // External memory (follow symlinks)
  addLine(state, "## External Memory");
  addLine(state, "");
  try {
    const extEntries = await fs.readdir(external, { withFileTypes: true });
    for (const entry of extEntries.sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const linkPath = path.join(external, entry.name);
      let target: string | null = null;

      try {
        if (entry.isSymbolicLink()) {
          target = await fs.readlink(linkPath);
        } else if (entry.isDirectory()) {
          // Fallback from an earlier copy
          target = linkPath;
        }
      } catch {
        // broken symlink or read error
      }

      if (target) {
        addLine(state, `### ${entry.name} (→ ${target})`);
        // Walk the target directory and show files
        try {
          await walkMemoryDir(target, state);
        } catch {
          addLine(state, "(unable to read linked memory)");
          addLine(state, "");
        }
      } else {
        addLine(state, `### ${entry.name}`);
        addLine(state, "(broken link or invalid)");
        addLine(state, "");
      }

      if (state.charCount > TOTAL_CAP) break;
    }
  } catch {
    addLine(state, "(no external memory linked)");
    addLine(state, "");
  }

  // Warn if truncated
  if (state.charCount > TOTAL_CAP) {
    addLine(state, "");
    addLine(
      state,
      "⚠️ **Memory digest truncated.** Use Read tool to view full files at:",
    );
    addLine(state, `- Internal: ~/.synaphex/${project}/memory/internal/`);
    addLine(state, `- External: ~/.synaphex/${project}/memory/external/`);
  }

  return state.lines.join("\n");
}
