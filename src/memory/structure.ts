import * as path from "node:path";
import { promises as fs } from "node:fs";

export interface MemoryTemplate {
  filename: string;
  content: string;
}

export interface MemoryStructureConfig {
  languages?: string[];
  frameworks?: string[];
}

const DEFAULT_TEMPLATES: MemoryTemplate[] = [
  {
    filename: "overview.md",
    content: `# Project Overview

## Purpose
<!-- What is this project's primary goal? -->

## Key Constraints
<!-- What are the main technical or business constraints? -->

## Domain
<!-- What domain or industry does this project operate in? -->
`,
  },
  {
    filename: "architecture.md",
    content: `# Architecture

## System Design
<!-- High-level system architecture and major components -->

## Components
<!-- Key components and their responsibilities -->

## Data Flow
<!-- How data moves through the system -->

## Dependencies
<!-- Major external dependencies and their roles -->
`,
  },
  {
    filename: "conventions.md",
    content: `# Conventions

## Naming Conventions
<!-- Naming patterns for functions, classes, variables, etc. -->

## Code Style
<!-- Code formatting, indentation, line length, etc. -->

## Architecture Patterns
<!-- Common design patterns and architectural patterns used -->

## Error Handling
<!-- How errors are handled and reported -->
`,
  },
  {
    filename: "security.md",
    content: `# Security

## Threat Model
<!-- What threats does this project defend against? -->

## Authentication
<!-- How authentication is handled -->

## Authorization
<!-- How authorization/permissions work -->

## Data Protection
<!-- How sensitive data is protected -->

## Compliance
<!-- Any regulatory or compliance requirements -->
`,
  },
  {
    filename: "dependencies.md",
    content: `# Dependencies

## Runtime Dependencies
<!-- Production dependencies and versions -->

## Development Dependencies
<!-- Development and testing dependencies -->

## External Services
<!-- External APIs and services used -->

## Compatibility
<!-- Language versions, platform support -->
`,
  },
];

export async function initializeMemoryStructure(
  projectDir: string,
  config: MemoryStructureConfig = {},
): Promise<void> {
  const internalDir = path.join(projectDir, "memory", "internal");
  const externalDir = path.join(projectDir, "memory", "external");
  const tasksDir = path.join(internalDir, "tasks");
  const researchDir = path.join(internalDir, "research");

  // Create base directories
  await fs.mkdir(internalDir, { recursive: true });
  await fs.mkdir(externalDir, { recursive: true });
  await fs.mkdir(tasksDir, { recursive: true });
  await fs.mkdir(researchDir, { recursive: true });

  // Write default templates
  for (const template of DEFAULT_TEMPLATES) {
    const filePath = path.join(internalDir, template.filename);
    await fs.writeFile(filePath, template.content, "utf-8");
  }

  // Create language-specific templates if configured
  if (config.languages && config.languages.length > 0) {
    for (const language of config.languages) {
      const filename = `${language}-guidelines.md`;
      const filePath = path.join(internalDir, filename);
      const content = generateLanguageTemplate(language);
      await fs.writeFile(filePath, content, "utf-8");
    }
  }

  // Create framework-specific directories if configured
  if (config.frameworks && config.frameworks.length > 0) {
    for (const framework of config.frameworks) {
      const frameworkDir = path.join(internalDir, framework);
      await fs.mkdir(frameworkDir, { recursive: true });

      // Create framework templates
      const templates = generateFrameworkTemplates(framework);
      for (const template of templates) {
        const filePath = path.join(frameworkDir, template.filename);
        await fs.writeFile(filePath, template.content, "utf-8");
      }
    }
  }
}

export async function createTaskMemory(
  projectDir: string,
  taskSlug: string,
): Promise<string> {
  const taskDir = path.join(
    projectDir,
    "memory",
    "internal",
    "tasks",
    taskSlug,
  );
  await fs.mkdir(taskDir, { recursive: true });

  // Create empty task files
  const planPath = path.join(taskDir, "plan.md");
  const implPath = path.join(taskDir, "implementation.md");
  const metaPath = path.join(taskDir, "task-meta.json");

  if (!(await fileExists(planPath))) {
    await fs.writeFile(planPath, "# Task Plan\n", "utf-8");
  }

  if (!(await fileExists(implPath))) {
    await fs.writeFile(implPath, "# Implementation Log\n", "utf-8");
  }

  if (!(await fileExists(metaPath))) {
    await fs.writeFile(
      metaPath,
      JSON.stringify(
        {
          slug: taskSlug,
          created_at: new Date().toISOString(),
          status: "pending",
        },
        null,
        2,
      ),
      "utf-8",
    );
  }

  return taskDir;
}

function generateLanguageTemplate(language: string): string {
  const templates: Record<string, string> = {
    cpp: `# C++ Guidelines

## Naming Conventions
<!-- C++ specific naming (PascalCase for classes, camelCase for functions, UPPER_SNAKE_CASE for constants) -->

## Modern C++ Standards
<!-- Which C++ standard(s) are used? (C++11, C++17, C++20, etc.) -->

## Build System
<!-- CMake, Bazel, or other build tool conventions -->

## Testing Framework
<!-- Unit test framework and patterns -->

## Memory Management
<!-- RAII, smart pointers (unique_ptr, shared_ptr), manual management patterns -->

## Exception Handling
<!-- Exception handling strategy and error codes -->
`,
    python: `# Python Guidelines

## Naming Conventions
<!-- PEP 8 adherence, naming patterns for functions, classes, constants -->

## Python Version
<!-- Minimum Python version, type hints usage -->

## Testing Framework
<!-- pytest, unittest, or other testing framework -->

## Type Hints
<!-- How type hints are used (strict, optional, etc.) -->

## Package Management
<!-- pip, poetry, or other dependency management -->

## Documentation Style
<!-- Docstring format (Google, NumPy, etc.) -->
`,
    ros: `# ROS Guidelines

## ROS Distribution
<!-- Which ROS distribution(s) are supported (Noetic, Humble, etc.) -->

## Node Architecture
<!-- How ROS nodes are organized and communicate -->

## Topic and Service Conventions
<!-- Naming and organization of topics and services -->

## Message Definitions
<!-- Custom message format and organization -->

## Launch Files
<!-- Launch file structure and composition -->

## Package Configuration
<!-- package.xml best practices -->
`,
  };

  return (
    templates[language] ||
    `# ${language.charAt(0).toUpperCase() + language.slice(1)} Guidelines

## Language-Specific Patterns
<!-- Document language-specific patterns, conventions, and best practices -->

## Build System
<!-- How the project is built in ${language} -->

## Testing
<!-- Testing frameworks and patterns -->

## Dependencies
<!-- Dependency management specific to ${language} -->
`
  );
}

function generateFrameworkTemplates(framework: string): MemoryTemplate[] {
  return [
    {
      filename: "setup.md",
      content: `# ${framework} Setup

## Installation
<!-- How to set up ${framework} in this project -->

## Configuration
<!-- Configuration files and environment variables -->

## Directory Structure
<!-- How ${framework} code is organized -->

## Build Steps
<!-- Steps to build ${framework} components -->
`,
    },
    {
      filename: "patterns.md",
      content: `# ${framework} Patterns

## Common Patterns
<!-- Recurring patterns used with ${framework} -->

## Component Structure
<!-- How components/modules are structured -->

## Data Flow
<!-- How data flows through ${framework} components -->

## Integration Points
<!-- How ${framework} integrates with the rest of the system -->
`,
    },
    {
      filename: "troubleshooting.md",
      content: `# ${framework} Troubleshooting

## Common Issues
<!-- Common problems and their solutions -->

## Debug Techniques
<!-- How to debug ${framework} issues -->

## Performance Tips
<!-- Performance optimization and tuning -->

## Frequently Asked Questions
<!-- Answers to common questions about ${framework} usage -->
`,
    },
  ];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
