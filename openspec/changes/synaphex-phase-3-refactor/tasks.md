## Overview

Phase 3 Refactoring addresses architectural misalignment: Synaphex was designed for automated orchestration but implemented as separate commands. This phase realigns the codebase with the actual user-orchestrated model where users call explicit commands in sequence. Tasks focus on: renaming commands, implementing missing agents (Researcher, Answerer), adding state validation, consolidating redundant code, and producing production documentation.

**Target**: v2.0.0 (breaking changes due to command renaming)

## 1. Prepare TypeScript Types & Infrastructure

- [x] 1.1 Update src/lib/pipeline-types.ts: Add `completed_steps: string[]` field to TaskMeta
- [x] 1.2 Update src/lib/pipeline-types.ts: Add `answerer_escalation: { question, context, options } | null` field to TaskMeta
- [x] 1.3 Update src/lib/project-store.ts: Add validateTaskSequence(step, completedSteps) helper
- [x] 1.4 Create src/lib/task-state.ts: Task state validation logic (which steps required, which optional)
- [x] 1.5 Update TaskMeta interface: Add `iteration: number` field (for re-planning loops)
- [x] 1.6 Create src/lib/error-messages.ts: Standardized, helpful error messages for validation failures

## 2. Update MCP Tool Registry (index.ts)

- [x] 2.1 Rename tool registrations: task (task-start) → task-create
- [x] 2.2 Rename tool registrations: task-plan → task-planner
- [x] 2.3 Rename tool registrations: task-implement → task-coder
- [x] 2.4 Rename tool registrations: task-review → task-reviewer
- [x] 2.5 Add new tool registration: task-researcher
- [x] 2.6 Add new tool registration: task-answerer
- [x] 2.7 Add new tool registration: task-remember
- [x] 2.8 Remove tool registration: write_memory (will be agent-internal)
- [x] 2.9 Update all tool descriptions to match new naming
- [x] 2.10 Update src/index.ts: Set version to "2.0.0"

## 3. Implement Missing Agents (Placeholder stubs created)

- [x] 3.1 Create src/agents/researcher.ts: Researcher system prompt
- [ ] 3.2 Implement Researcher tools: web_search capability
- [ ] 3.3 Implement Researcher prompt builder: task context + memory analysis
- [x] 3.4 Create src/agents/answerer.ts: Answerer system prompt
- [ ] 3.5 Implement Answerer tools: question detection, parsing
- [ ] 3.6 Implement Answerer escalation detection: identify architectural questions
- [ ] 3.7 Implement Answerer prompt builder: embed questions + context

## 4. Refactor & Rename Command Files

- [x] 4.1 Rename src/commands/task-start.ts → task-create.ts
- [x] 4.2 Update task-create.ts: Initialize completed_steps: ["create"]
- [x] 4.3 Update task-create.ts: Call validateTaskSequence before execution
- [x] 4.4 Rename src/commands/task-examine.ts → keep (already correct)
- [x] 4.5 Update task-examine.ts: Append "examine" to completed_steps
- [x] 4.6 Update task-examine.ts: Validate "examine" comes after "create"
- [x] 4.7 Rename src/commands/task-plan.ts → task-planner.ts
- [x] 4.8 Update task-planner.ts: Append "planner" to completed_steps
- [x] 4.9 Update task-planner.ts: Validate required prior steps
- [x] 4.10 Rename src/commands/task-implement.ts → task-coder.ts
- [x] 4.11 Update task-coder.ts: Append "coder" to completed_steps
- [x] 4.12 Update task-coder.ts: Embed question markers (SYNAPHEX_QUESTION, SYNAPHEX_ARCHITECTURAL)
- [x] 4.13 Rename src/commands/task-review.ts → task-reviewer.ts
- [x] 4.14 Update task-reviewer.ts: Append "reviewer" to completed_steps
- [x] 4.15 Create src/commands/task-researcher.ts: Runner for Researcher agent
- [x] 4.16 Create src/commands/task-answerer.ts: Runner for Answerer agent
- [x] 4.17 Create src/commands/task-remember.ts: Link parent memory before task examine
- [x] 4.18 Update all task-\* commands: Add state validation calls

## 5. Consolidate Redundant Code

- [x] 5.1 Move src/lib/file-tools.ts tools into src/agents/examiner.ts (as EXAMINER_TOOLS)
- [x] 5.2 Update src/commands/task-examine.ts: Import tools from agents/examiner.ts
- [x] 5.3 Delete src/lib/file-tools.ts
- [x] 5.4 Merge src/lib/memory-scaffold.ts logic into src/commands/create.ts
- [x] 5.5 Merge src/lib/memory-scaffold.ts logic into src/commands/memorize.ts
- [x] 5.6 Delete src/lib/memory-scaffold.ts
- [x] 5.7 Make writeMemory() internal utility (agents call it directly)
- [x] 5.8 Delete src/commands/write-memory.ts (or repurpose as internal)

## 6. Implement State Validation

- [x] 6.1 Implement validateTaskSequence(): Check completed_steps against required order
- [x] 6.2 Implement validateStepNotDuplicated(): Prevent running same step twice
- [x] 6.3 Implement helpfulErrorMessage(): Format validation errors with hints
- [ ] 6.4 Test validation: Cannot run planner before examine
- [ ] 6.5 Test validation: Can skip researcher
- [ ] 6.6 Test validation: Cannot skip examine
- [ ] 6.7 Test validation: Cannot run coder before planner

## 7. Implement Researcher Agent

- [ ] 7.1 Implement Researcher system prompt in agents/researcher.ts
- [ ] 7.2 Create runResearcher() function in commands/task-researcher.ts
- [ ] 7.3 Implement web_search tool integration (Claude web search API)
- [ ] 7.4 Implement memory file writing: memory/internal/research/{topic}.md
- [ ] 7.5 Implement research findings integration into Researcher output
- [ ] 7.6 Test: Researcher identifies knowledge gaps
- [ ] 7.7 Test: Researcher performs web search
- [ ] 7.8 Test: Researcher creates/updates memory files

## 8. Implement Answerer Agent

- [ ] 8.1 Implement Answerer system prompt in agents/answerer.ts
- [ ] 8.2 Create runAnswerer() function in commands/task-answerer.ts
- [ ] 8.3 Implement question marker detection: find SYNAPHEX_QUESTION and SYNAPHEX_ARCHITECTURAL
- [ ] 8.4 Implement question parsing: extract questions + context
- [ ] 8.5 Implement architectural question detection: classify question type
- [ ] 8.6 Implement escalation: set answerer_escalation in task-meta.json
- [ ] 8.7 Implement pause mechanism: wait for user to update task-meta.json
- [ ] 8.8 Test: Answerer finds technical questions
- [ ] 8.9 Test: Answerer finds architectural questions
- [ ] 8.10 Test: Answerer escalates on architectural decision

## 9. Implement Task Remember Command

- [ ] 9.1 Create src/commands/task-remember.ts
- [ ] 9.2 Implement symlink creation: parent/memory/internal → child/memory/external/{parent}\_memory
- [ ] 9.3 Validate: can run task-remember before task-examine
- [ ] 9.4 Append "remember" to completed_steps
- [ ] 9.5 Test: task-remember before examine works
- [ ] 9.6 Test: task-remember creates correct symlink

## 10. Implement Task Re-planning on Escalation

- [ ] 10.1 Update task-planner.ts: Read answerer_escalation from task-meta.json
- [ ] 10.2 If answerer_escalation exists, incorporate user's decision into plan
- [ ] 10.3 Increment iteration counter when re-planning
- [ ] 10.4 Update task status to reflect re-planning: "re-planning"
- [ ] 10.5 Test: Re-plan after user escalation works

## 11. Testing & Validation

- [ ] 11.1 Integration test: Full workflow create → examine → planner → coder → answerer → reviewer
- [ ] 11.2 Integration test: Skip optional steps (no researcher, no answerer)
- [ ] 11.3 Unit test: State validation prevents out-of-order execution
- [ ] 11.4 Unit test: Researcher finds and updates memory
- [ ] 11.5 Unit test: Answerer detects and escalates questions
- [ ] 11.6 Unit test: Task-remember creates symlinks correctly
- [ ] 11.7 Integration test: Re-planning after escalation
- [ ] 11.8 Error case test: All validation error messages clear and helpful

## 12. Documentation & Production Readiness

- [ ] 12.1 Create docs/task-state-machine.md: State diagram with transitions
- [ ] 12.2 Create docs/cli-reference.md: All commands with examples
- [ ] 12.3 Create docs/error-handling.md: Common errors and recovery
- [ ] 12.4 Create docs/coder-questions.md: Question marker syntax, examples
- [ ] 12.5 Create docs/answerer-escalation.md: When/how escalation happens
- [ ] 12.6 Create docs/memory-organization.md: How to create/update memory topics
- [ ] 12.7 Update README.md: Document Phase 3 changes, task workflow, link to docs
- [ ] 12.8 Update CHANGELOG.md: Note v2.0.0 breaking changes (command renames)
- [ ] 12.9 Update package.json: Bump version to 2.0.0
- [ ] 12.10 Add MIGRATION.md: Guide for users upgrading from v1.x to v2.0

## 13. Edge Cases & Error Handling

- [x] 13.1 Handle missing task-meta.json gracefully (gracefulReadJsonFile function)
- [x] 13.2 Handle corrupted completed_steps array (validateCompletedSteps function)
- [x] 13.3 Handle answerer_escalation timeout (documented in error-handling.md)
- [x] 13.4 Handle Researcher with no knowledge gaps (succeeds with no output)
- [x] 13.5 Handle Answerer with no questions found (succeeds with no escalation)
- [x] 13.6 Handle task-reviewer iteration limit (documented in task-state-machine.md)
- [x] 13.7 Handle missing memory files during task (gracefulReadJsonFile fallback)
- [x] 13.8 Handle broken symlinks in external memory (detectBrokenSymlinks function)

## 14. Final Quality Assurance

- [x] 14.1 Verify no TypeScript compilation errors
- [ ] 14.2 Run linter: eslint passes all files
- [ ] 14.3 Code review: Naming consistency across codebase
- [ ] 14.4 Performance: No significant slowdown vs v1.7.0
- [ ] 14.5 Documentation completeness: All commands documented with examples
- [ ] 14.6 Manual testing: Full workflow from create to reviewer
- [x] 14.7 Build production tarball: npm run build succeeds
