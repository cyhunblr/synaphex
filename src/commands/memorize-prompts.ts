import type { MemoryTopic } from "../memory/structure.js";
import type { StructuralFacts } from "./memorize.js";

export function buildTopicInstructions(
  facts: StructuralFacts,
): Array<{ topic: MemoryTopic; instruction: string }> {
  return [
    {
      topic: "overview",
      instruction: `Synthesize a project overview based on:
- README excerpt: ${facts.readmeExcerpt}
- Detected languages: ${facts.detectedLanguages.join(", ") || "unknown"}
- Directory structure: ${facts.treeSummary}
- Manifest files: ${Object.keys(facts.manifestFiles).join(", ") || "none found"}

Write the overview.md with Purpose, Key Constraints, and Domain sections filled in with concrete details from the codebase.`,
    },
    {
      topic: "architecture",
      instruction: `Analyze the system architecture from:
- Directory structure: ${facts.treeSummary}
- Manifest files: ${JSON.stringify(facts.manifestFiles, null, 2)}
- Detected technologies: ${facts.detectedLanguages.join(", ")}

Write the architecture.md describing System Design (high-level), Components (major modules), Data Flow, and Dependencies. Be specific about what you see in the structure.`,
    },
    {
      topic: "interfaces",
      instruction: `Document external and internal interfaces from:
- Detected languages: ${facts.detectedLanguages.join(", ")}
- Directory structure: ${facts.treeSummary}
- Manifest files: ${JSON.stringify(facts.manifestFiles, null, 2)}

Write the interfaces.md covering External APIs, Internal Interfaces (module boundaries), Data Contracts, and Protocol Specifications inferred from the codebase.`,
    },
    {
      topic: "build",
      instruction: `Document the build system from:
- Manifest files found: ${Object.keys(facts.manifestFiles).join(", ")}
- Detected languages: ${facts.detectedLanguages.join(", ")}

Write the build.md with Build System (what tool is used?), Build Steps, Dependencies, Configuration, and Artifacts inferred from build files and structure.`,
    },
    {
      topic: "conventions",
      instruction: `Analyze code conventions from:
- Detected languages: ${facts.detectedLanguages.join(", ")}
- Directory structure: ${facts.treeSummary}
- Available manifest files: ${Object.keys(facts.manifestFiles).join(", ")}

Write the conventions.md describing Naming Conventions, Code Style (indentation, case patterns), Architecture Patterns, and Error Handling observed in the codebase.`,
    },
    {
      topic: "security",
      instruction: `Assess security considerations from:
- Detected technologies: ${facts.detectedLanguages.join(", ")}
- Directory structure: ${facts.treeSummary}
- Manifest files: ${Object.keys(facts.manifestFiles).join(", ")}

Write the security.md describing likely Threat Model, Authentication mechanisms (if any), Authorization, Data Protection, and Compliance requirements based on the project type and structure.`,
    },
    {
      topic: "glossary",
      instruction: `Build a glossary from:
- Directory structure: ${facts.treeSummary}
- Manifest files: ${Object.keys(facts.manifestFiles).join(", ")}
- Detected languages: ${facts.detectedLanguages.join(", ")}

Write the glossary.md listing Domain Terms, Acronyms, and Key Concepts unique to this project. Extract these from directory names, manifest metadata, and technology names.`,
    },
  ];
}
