# Task State Machine (v2.0.0)

> **Note:** This documentation has been consolidated into [ARCHITECTURE.md](ARCHITECTURE.md#state-machine). Please refer to that file for the latest information.

## Overview

Synaphex v2.0.0 implements a user-orchestrated task workflow where users explicitly invoke commands in sequence. Each command validates prior state and appends to a `completed_steps` array in `task-meta.json`.

## State Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    TASK LIFECYCLE v2.0                          │
└─────────────────────────────────────────────────────────────────┘

                           [task-create]
                                 │
                    creates task-meta.json with
                    completed_steps: ["create"]
                                 │
                                 ▼
                    ┌──────────────────────┐
                    │   CREATE (done)      │
                    │  status: "created"   │
                    └──────────────────────┘
                                 │
                  (optional) ────┴─────────── (required)
                       │                          │
                       ▼                          ▼
            ┌──────────────────┐    ┌──────────────────────┐
            │ [task-remember]  │    │  [task-examine]      │
            │  (optional)      │    │  (required)          │
            │  status: same    │    │  status: "examined"  │
            └──────────────────┘    └──────────────────────┘
                       │                          ▲
                       └──────────────┬───────────┘
                                      │
                          (can link parent memory)
                                      │
                                      ▼
                    ┌──────────────────────────────┐
                    │  EXAMINE (done)              │
                    │  status: "examined"          │
                    │  memory: raw + compact       │
                    └──────────────────────────────┘
                                      │
                  (optional) ────────┬─────────────── (required)
                       │             │
                       ▼             ▼
            ┌──────────────────┐  ┌──────────────────────┐
            │ [task-researcher]│  │ [task-planner]       │
            │  (optional)      │  │ (required)           │
            │  status: same    │  │ status: "planned"    │
            └──────────────────┘  └──────────────────────┘
                       │             ▲
                       └──────┬──────┘
                              │
                    (answers guide planning)
                              │
                              ▼
                    ┌──────────────────────────┐
                    │  PLAN (done)             │
                    │  status: "planned"       │
                    │  saved: plan-v{N}.md     │
                    └──────────────────────────┘
                              │
                    (required)
                              │
                              ▼
                    ┌──────────────────────────┐
                    │ [task-coder]             │
                    │ status: "implementing"   │
                    │ → "implemented"          │
                    └──────────────────────────┘
                              │
                      ┌───────┴────────┐
                      │                │
              ┌───────▼────────┐   ┌───▼──────────────────┐
              │ No escalation  │   │ Escalation detected  │
              │ Continue       │   │ PAUSE for user input │
              └───────┬────────┘   └───┬──────────────────┘
                      │                │
                      │         (user updates task-meta.json
                      │          with escalation decision)
                      │                │
                      │         [task-planner] (re-plan)
                      │                │
                      │         iteration++
                      │                │
                      │         ┌──────▼────────┐
                      │         │ [task-coder]  │
                      │         │ (re-implement)│
                      │         └──────┬────────┘
                      │                │
                      └────────┬───────┘
                              │
                    (required or optional)
                              │
                              ▼
                    ┌──────────────────────────┐
                    │ [task-answerer]          │
                    │ (optional)               │
                    │ answers Coder questions  │
                    └──────────────────────────┘
                              │
                    (required)
                              │
                              ▼
                    ┌──────────────────────────┐
                    │ [task-reviewer]          │
                    │ status: "reviewing"      │
                    │ → "reviewed"             │
                    └──────────────────────────┘
                              │
                      ┌───────┴────────┐
                      │                │
                   pass            needs rework
                      │                │
                      ▼                │
              ┌──────────────┐        │
              │ DONE         │        │
              │ status: ok   │        │
              └──────────────┘        │
                                      │
                            feedback to Planner
                                      │
                                      ▼
                                 [task-planner]
                                      │
                                 iteration++
                                      │
                                      ▼
                                [task-coder]
                                  ... cycle
```

## State Definition

### CREATE

- **Input**: Task sentence (what to build)
- **Output**: `task-meta.json` with `completed_steps: ["create"]`
- **Status**: `"created"`
- **Validation**: None required (first step)
- **Optional**: task-remember can run before examine

### EXAMINE

- **Input**: Codebase at task location, internal/external memory
- **Output**:
  - `memory/internal/task_<slug>/<task_sentence>.md` (raw)
  - `memory/internal/task_<slug>/<task_sentence>_compact.md` (compact)
- **Status**: `"examined"`
- **Validation**: Must run after create
- **Optional**: task-researcher can run after examine

### RESEARCHER (Optional)

- **Input**: Task, examiner output
- **Output**: `memory/internal/research/*.md` (knowledge gap answers)
- **Status**: No status change
- **Validation**: Can run after examine
- **Impact**: Research findings available to Planner

### PLANNER

- **Input**: Task, examiner output, (optional) researcher output
- **Output**: `plan-v{N}.md` with implementation plan
- **Status**: `"planned"`
- **Validation**: Must run after examine
- **Re-planning**: If answerer escalates, user clarifies and planner re-runs with iteration++

### CODER

- **Input**: Task, plan, examiner compact output, memory digest
- **Output**: Implementation code
- **Status**: `"implementing"` → `"implemented"`
- **Validation**: Must run after planner
- **Tool access**:
  - read_file, write_file, edit_file, list_files, search_code
  - ask_answerer (calls Answerer synchronously for questions)
- **Question markers**:
  - `// SYNAPHEX_QUESTION: <question>` (technical)
  - `// SYNAPHEX_ARCHITECTURAL: <question>` (design decision)

### ANSWERER (Optional)

- **Input**: Implementation summary with embedded questions
- **Output**: Answers to questions, or escalation
- **Status**: No status change
- **Validation**: Can run after coder
- **Behavior**:
  - Detects SYNAPHEX_QUESTION and SYNAPHEX_ARCHITECTURAL markers
  - Answers technical questions
  - Escalates architectural decisions → sets `answerer_escalation` in task-meta.json
  - **PAUSE**: Task pauses at escalation until user clarifies

### USER CLARIFICATION (on Escalation)

- **Input**: User updates `task-meta.json` with decision to `answerer_escalation` field
- **Output**: Updated metadata
- **Validation**: Manual, user responsibility
- **Next**: task-planner with updated context (iteration++)

### REVIEWER

- **Input**: Implementation code and files
- **Output**: Pass/Fail feedback
- **Status**: `"reviewing"` → `"reviewed"`
- **Validation**: Must run after coder (or answerer if present)
- **Re-planning on fail**: Reviewer feedback sent to Planner, iteration++

## Transitions

| From → To            | Required | Validation                                |
| -------------------- | -------- | ----------------------------------------- |
| Create → Examine     | Yes      | Only create allowed before examine        |
| Create → Remember    | No       | Must run before examine                   |
| Examine → Researcher | No       | Optional, order doesn't matter vs Planner |
| Examine → Planner    | Yes      | After examine, completed_steps validated  |
| Planner → Coder      | Yes      | After planner, completed_steps validated  |
| Coder → Answerer     | No       | Optional question answering               |
| Answerer → Reviewer  | No/Yes   | Optional (user chooses reviewer mode)     |
| Coder → Reviewer     | Yes      | Can skip answerer                         |
| Reviewer → Done      | Yes      | If pass feedback                          |
| Reviewer → Planner   | No       | If fail feedback (iteration++)            |

## completed_steps Array

The `completed_steps` array in `task-meta.json` tracks which agents have run. It determines valid transitions:

```json
{
  "completed_steps": ["create", "examine", "planner"],
  "status": "planned",
  "iteration": 1
}
```

**Valid orders**:

- `create` → examine (required)
- create → remember → examine (optional remember)
- create → examine → (researcher optional) → planner → coder → (answerer optional) → reviewer
- create → examine → planner → coder → reviewer (skip researcher, answerer)

**Invalid orders** (prevented by validation):

- examine before create
- planner before examine
- coder before planner
- reviewer before coder
- Running same step twice (e.g., planner twice without coder in between)

## Escalation Flow

When Coder asks a question and Answerer detects an architectural decision:

1. Coder calls `ask_answerer` tool during implementation
2. Answerer runs, detects architectural nature via `isArchitecturalDecision()`
3. Answerer returns escalation response
4. Coder receives escalation marker, stops implementation
5. task-answerer command sets `answerer_escalation` in task-meta.json
6. **PAUSE**: User must update `answerer_escalation.decision` field
7. User runs task-planner with same iteration (or iteration++)
8. Planner incorporates user's decision, generates updated plan
9. User runs task-coder (possibly iteration++)
10. Cycle continues until no escalations

## Notes

- **Single task per directory**: Each slug creates one `task-meta.json`
- **Iteration tracking**: For re-planning loops after review or escalation
- **Memory persistence**: All agent outputs saved to `memory/internal/`
- **State is authoritative**: `completed_steps` array is source of truth
- **No auto-transitions**: User explicitly calls each command
