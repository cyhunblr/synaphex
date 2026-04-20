---
name: memorize
description: Analyze a codebase and update project memory files.
argument-hint: <project> <source-path>
allowed-tools:
  [
    "mcp__synaphex__memorize",
    "mcp__synaphex__write_memory",
    "memorize",
    "write_memory",
  ]
user-invocable: true
---

Analyze the codebase at `<source-path>` and populate all seven memory topics for project `$ARGUMENTS` in a delegated workflow.

## Workflow

1. **Call memorize tool** with the project name and source path
2. **Check the response**:
   - If `skip: true` is returned, memorize was already run on this codebase; no further action needed
   - Otherwise, you have `topics` array and `structuralFacts` for analysis
3. **Synthesize and write each topic** — for each of the seven topics (overview, architecture, interfaces, build, conventions, security, glossary):
   - Read the source path at `<source-path>`
   - Use the topic's instruction from the memorize response and the structural facts to synthesize content
   - Call `write_memory` with (project, topic, content) to apply it
4. **All seven topics MUST be written** — do not skip any topic

## Structural Facts Provided

The memorize tool returns `structuralFacts` containing:

- `treeSummary`: Directory tree (2 levels, max 200 entries per level)
- `detectedLanguages`: Languages found by file extension count
- `manifestFiles`: Build/package files (package.json, CMakeLists.txt, Cargo.toml, etc.) with content
- `readmeExcerpt`: First 40 lines of README.md if present

Use these facts to synthesize memory content that's grounded in the actual codebase structure.

## Idempotency

If you run memorize twice on the same codebase without changes, the second run returns `{ skip: true, reason: "Content unchanged since last memorize" }`. This is normal and efficient — no further action needed in that case.
