## Why

Synaphex v2.0.0 shipped with comprehensive but scattered documentation. Current docs are spread across 9 separate files with overlapping content, inconsistent examples, and no clear "getting started" path for new users. Installation instructions are buried in README; workflow examples are spread across multiple guides; troubleshooting lacks organization.

Users need:

1. **Clear installation guide** — step-by-step for all platforms (npm, local dev, IDE integrations)
2. **Unified how-to guide** — common tasks with real examples (not just workflow overview)
3. **Practical examples** — copy-paste ready workflows for 5+ scenarios
4. **Better organization** — docs hierarchy makes sense to newcomers

This overhaul consolidates, reorganizes, and enriches documentation for v2.0.0 launch readiness.

## What Changes

**Reorganized Documentation Structure:**

```
docs/
├── INSTALLATION.md          (NEW: complete setup guide)
├── GETTING-STARTED.md       (NEW: 5-minute quick start)
├── HOW-TO-GUIDE.md          (NEW: common tasks with examples)
├── EXAMPLES.md              (NEW: 5+ real-world scenarios)
├── CLI-REFERENCE.md         (ENHANCED: all 8 commands)
├── WORKFLOW-GUIDE.md        (ENHANCED: updated for v2.0.0)
├── TROUBLESHOOTING.md       (REORGANIZED from error-handling.md)
├── ARCHITECTURE.md          (NEW: system design overview)
└── [IDE-INTEGRATION files]  (EXISTING: antigravity, vscode)
```

**Key Improvements:**

1. **INSTALLATION.md** — Complete setup for:
   - macOS (npm, local dev, IDE plugins)
   - Linux (npm, local dev, IDE plugins)
   - Windows (npm, local dev, IDE plugins)
   - Docker/containers
   - CI/CD integration

2. **GETTING-STARTED.md** — 5-minute onboarding:
   - Install in one command
   - Create first project
   - Run first task
   - Next steps

3. **HOW-TO-GUIDE.md** — Task-based examples:
   - How to create a project
   - How to run a simple task
   - How to research unfamiliar tech
   - How to handle escalations
   - How to link multi-project memory
   - How to debug errors
   - How to contribute improvements

4. **EXAMPLES.md** — 5+ complete scenarios:
   - Simple feature (password reset)
   - Complex feature (GraphQL)
   - Architecture decision (real-time notifications)
   - Multi-project inheritance
   - Refactoring with re-planning

5. **CLI-REFERENCE.md** — Existing but enhanced:
   - Add v2.0.0 command names
   - Add state machine rules
   - Add parameter validation

6. **TROUBLESHOOTING.md** — Reorganized:
   - Common errors → solutions
   - Debugging checklist
   - FAQ section
   - Recovery procedures

7. **ARCHITECTURE.md** — NEW:
   - System design (agents, state machine, memory)
   - Data flow diagrams
   - Component interactions

## Capabilities

### New Capabilities

- `installation-guide`: Multi-platform setup instructions
- `quick-start-guide`: 5-minute onboarding experience
- `how-to-guide`: Task-based documentation
- `examples-library`: Real-world workflow scenarios
- `architecture-overview`: System design documentation

### Modified Capabilities

- `cli-reference`: Enhanced with v2.0.0 state machine rules
- `workflow-guide`: Updated for v2.0.0 commands
- `error-handling`: Reorganized as troubleshooting guide

## Impact

- **Users**: Clear onboarding path, easier troubleshooting, real examples
- **Docs**: 3 new comprehensive guides, 4 reorganized guides, 1 consolidated
- **Discoverability**: Table of contents in README points to right guide
- **Maintenance**: Centralized examples reduce duplication
