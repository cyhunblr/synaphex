/**
 * Topic-based memory file templates for new synaphex projects.
 * Each entry is the relative path under memory/internal/ and its initial
 * contents — an H1 header only. `load` treats a file as "(empty)" if its
 * length matches the scaffold; `memorize` distinguishes initial vs update
 * runs the same way.
 */

export interface ScaffoldFile {
  /** path relative to memory/internal/ */
  relPath: string;
  /** intent of this file — used in memorize instructions */
  purpose: string;
  /** initial contents written on create */
  contents: string;
}

export const TOPIC_FILES: ScaffoldFile[] = [
  {
    relPath: "overview.md",
    purpose:
      "Project purpose, main components, entry points, top-level dependencies. " +
      "Look at README, top-level source files, package manifests (package.xml, " +
      "CMakeLists.txt, setup.py, pyproject.toml).",
    contents: "# Overview\n",
  },
  {
    relPath: "architecture.md",
    purpose:
      "High-level architecture: module structure, data flow, key design patterns, " +
      "ROS node graph (publishers, subscribers, services, actions). " +
      "Look at directory structure, main classes/modules, launch file topology.",
    contents: "# Architecture\n",
  },
  {
    relPath: "interfaces.md",
    purpose:
      "ROS interface contracts: messages (.msg), services (.srv), actions (.action). " +
      "Document fields, semantics, who publishes/subscribes, who serves/calls. " +
      "Look at msg/, srv/, action/ directories and node source.",
    contents: "# Interfaces\n",
  },
  {
    relPath: "build.md",
    purpose:
      "Build system: catkin layout, CMakeLists.txt structure, package.xml deps, " +
      "Python setup.py / pyproject.toml, build flags, system deps via rosdep. " +
      "Note any non-standard build steps.",
    contents: "# Build System\n",
  },
  {
    relPath: "conventions.md",
    purpose:
      "Coding conventions: C++ style (clang-format, naming, header guards), " +
      "Python style (PEP8 deviations, type hints), file organization, commit style. " +
      "Look at .clang-format, .clang-tidy, pyproject.toml, .editorconfig, existing patterns.",
    contents: "# Conventions\n",
  },
  {
    relPath: "security.md",
    purpose:
      "Security model: threat surface, authentication & authorization (note ROS 1 has no " +
      "topic auth by default), encryption choices, exposed network endpoints, " +
      "trust boundaries, known weak points. Look at launch params (network), crypto " +
      "usage, exposed topics/services, sudo/setuid invocations.",
    contents: "# Security\n",
  },
  {
    relPath: "glossary.md",
    purpose:
      "Domain-specific terms, acronyms, hardware names, project-internal jargon. " +
      "Look at comments, docs, variable/class names, README.",
    contents: "# Glossary\n",
  },
];

/**
 * Whether a memory file's content is still "scaffold-only" (just the H1 header).
 * Used by `memorize` to decide initial vs update run, and by `load` to mark
 * files as "(empty)".
 */
export function isScaffoldOnly(
  content: string,
  scaffoldContents: string,
): boolean {
  return content.trim() === scaffoldContents.trim();
}
