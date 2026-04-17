## Context

Synaphex v2.0.0 has comprehensive but scattered documentation:

- 9 separate markdown files
- No unified "getting started" path
- Installation buried in README
- Examples spread across multiple guides
- Inconsistent formatting and terminology

Users report:

- Unclear where to start
- Hard to find installation instructions
- Too many files to navigate
- No single source of truth for workflows

This design reorganizes docs into a coherent structure with clear navigation.

## Goals / Non-Goals

**Goals:**

- Create clear onboarding path: Install → Get Started → Run Examples
- Centralize all examples in one place
- Make installation discoverable and platform-specific
- Reduce redundancy across docs
- Improve searchability and navigation

**Non-Goals:**

- Don't rewrite existing content (reuse and reorganize)
- Don't add new features (docs only)
- Don't change v2.0.0 functionality
- Don't create video tutorials

## Decisions

### Decision 1: Documentation Structure

Use hierarchical organization:

- **Top level**: README.md (links to all guides)
- **Level 1**: Installation, Getting Started, Examples
- **Level 2**: CLI Reference, Workflow Guide, Troubleshooting
- **Level 3**: IDE Integrations, Architecture Details

Rationale: Newcomers go L1 → L2. Power users jump to L2/L3.

### Decision 2: Installation Guide Format

Platform-specific sections (macOS, Linux, Windows) with:

- Prerequisites (Node, npm versions)
- Step-by-step commands
- Verification (how to confirm it works)
- Troubleshooting (if something breaks)

Rationale: Users know their OS; section-based layout matches mental model.

### Decision 3: Examples Organization

Central `EXAMPLES.md` with 5+ scenarios:

1. Simple task (no research, no escalation)
2. Complex task (with research)
3. Escalation task (architectural decision)
4. Multi-project inheritance
5. Refactoring with re-planning

Each example: copy-paste commands, expected outputs, observations.

Rationale: Users learn by doing. Centralized examples = easier to maintain.

### Decision 4: How-To vs Workflow Guide

- **How-To Guide**: Task-focused ("How do I X?")
  - Short, actionable
  - Links to examples for details
- **Workflow Guide**: End-to-end pipeline
  - Explains all 8 steps
  - Shows state machine flow
  - Describes agent interactions

Rationale: Different mental models. Some users think "tasks", others think "pipeline".

### Decision 5: README Reorganization

Update README to:

- Lead with v2.0.0 highlights (new in this release)
- Link to INSTALLATION.md early
- Provide table of contents pointing to all guides
- Keep "Quick Links" for common paths

Rationale: README is entry point. Make it a hub, not a guide itself.

## Risks / Trade-offs

**Risk 1: Documentation Fatigue**
→ Mitigation: Reuse existing content; don't write from scratch. Use copy-paste structure.

**Risk 2: Duplicate Content**
→ Mitigation: Examples go in EXAMPLES.md only. Other docs reference with links.

**Risk 3: Inconsistent Voice/Tone**
→ Mitigation: Create style guide (short rules) and review before merging.

**Risk 4: Navigation Overwhelm**
→ Mitigation: Each doc starts with "What's this for?" and "When to use this".

## Implementation Strategy

1. **Create new files** (INSTALLATION.md, GETTING-STARTED.md, EXAMPLES.md, etc.)
2. **Migrate content** from existing docs to appropriate new homes
3. **Remove redundancy** (delete duplicate examples, consolidate error messages)
4. **Update README.md** with new structure and links
5. **Review and test** navigation paths (newcomer journey, power user workflows)
6. **Final QA** (no broken links, consistent formatting)

## Migration Plan

1. Create all new doc files (empty)
2. Move/consolidate content from existing docs
3. Update internal links
4. Test with fresh clone (simulate new user)
5. Commit as single PR

Rollback: Restore from git if major issues found.

## Open Questions

- Should we create a "Architecture" doc or keep system design in existing guides?
- How much IDE-specific detail belongs in main docs vs separate files?
- Should we include video/screenshot references or markdown-only?
