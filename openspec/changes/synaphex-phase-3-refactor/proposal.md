## Why

Synaphex v1.7.0 (Phase 1+2) is feature-complete but architecturally misaligned: it was designed for automated orchestration but implemented as separate commands. This creates unnecessary complexity, confusing naming (task-implement vs. task-coder), missing agents (Researcher, Answerer), and no state validation. Phase 3 realigns the implementation with the actual user-orchestrated model: explicit CLI commands that users call in sequence, with the system enforcing order and preventing out-of-order execution. This produces a cleaner API, simpler codebase, and production-ready quality.

## What Changes

- **Command Renaming**: Clarify intent (task-implement → task-coder, task-plan → task-planner, task-review → task-reviewer)
- **Task Workflow**: User explicitly calls commands in order: task-create → task-remember (opt) → task-examine → task-researcher (opt) → task-planner → task-coder → task-answerer → task-reviewer
- **Missing Agents**: Implement Researcher (web search + memory updates) and Answerer (question answering with architectural escalation)
- **State Validation**: Prevent out-of-order execution (can't run task-coder before task-examine)
- **Code Cleanup**: Remove redundant files (file-tools.ts, memory-scaffold.ts, write-memory.ts), consolidate logic
- **Production Readiness**: Add error handling, document state machine, create CLI reference guide

## Capabilities

### New Capabilities

- `synaphex-task-workflow`: Renamed CLI commands aligned with user-orchestrated model (task-create, task-remember, task-examine, task-researcher, task-planner, task-coder, task-answerer, task-reviewer)
- `synaphex-researcher-agent`: Researcher agent performs web search on unknown topics, updates/creates memory files in memory/internal/research/
- `synaphex-answerer-agent`: Answerer agent answers Coder questions, escalates architectural decisions to user, pauses for clarification
- `synaphex-state-validation`: Task state machine prevents out-of-order execution, validates completed_steps in task-meta.json
- `synaphex-code-cleanup`: Consolidate file-tools.ts, memory-scaffold.ts, write-memory.ts; remove redundancy
- `synaphex-production-docs`: State machine diagram, CLI reference, error handling guide, recovery procedures

### Modified Capabilities

- `synaphex-agent-runtime`: Update to support Researcher and Answerer agents, add state tracking
- `synaphex-project-store`: Track completed task steps in task-meta.json

## Impact

- **Simpler API**: 8 explicit task commands instead of 5 + ambiguous naming
- **Safer Workflow**: System prevents running task-coder before task-examine
- **Complete Agent Suite**: Researcher and Answerer agents enable end-to-end workflows
- **Cleaner Codebase**: Remove ~500 LOC of redundancy; consolidate from 27 to ~20 files
- **Production Quality**: Error handling, state validation, documentation
- **User Control**: User orchestrates workflow at their own pace with clear decision points
