## Overview

This implementation builds on [OpenSpec](https://github.com/Fission-AI/OpenSpec) principles: specification-driven development where requirements are clarified before implementation. Synaphex extends this to multi-agent orchestration, where Examiner/Researcher/Planner establish specs and context before Coder implements, and memory becomes an evolving project specification.

## 0. Tool Support & Multi-Provider Infrastructure

- [ ] 0.1 Define capability matrix for Claude (Opus 4.6, Sonnet 4.6, Haiku 4.5) with adaptive thinking and effort 0-4 support
- [ ] 0.2 Define capability matrix for Gemini models with thinking/effort support
- [ ] 0.3 Define capability matrix for OpenAI models with thinking/effort support
- [ ] 0.4 Implement provider discovery system that queries available models at runtime
- [ ] 0.5 Build credential manager: read API keys from environment variables or secure storage
- [ ] 0.6 Implement direct mode execution: Synaphex calls provider APIs internally
- [ ] 0.7 Implement delegated mode execution: Synaphex returns prompt to IDE for IDE's model
- [ ] 0.8 Build `/synaphex/setup claude` wizard for Claude Code/VSCode
- [ ] 0.9 Build `/synaphex/setup copilot` wizard for VSCode Copilot integration
- [ ] 0.10 Build `/synaphex/setup antigravity` wizard for Antigravity IDE integration
- [ ] 0.11 Implement MCP server registration in `~/.claude.json` and `.mcp.json`
- [ ] 0.12 Implement plugin bundle installation at `~/.claude/plugins/synaphex/`
- [ ] 0.13 Implement fallback skill registration at `~/.claude/commands/synaphex/`
- [ ] 0.14 Implement legacy skill fallback at `~/.claude/skills/synaphex/`
- [ ] 0.15 Implement setup verification: check files, MCP registration, Node.js path
- [ ] 0.16 Build setup error reporting with remediation suggestions

## 1. CLI Foundation & Project Management

- [ ] 1.1 Create `/synaphex/create <project>` command that creates `.synaphex/{project}/` with `settings.json` and `memory/internal/external/` directories
- [ ] 1.2 Create `/synaphex/load <project>` command that loads a project's settings and memory context
- [ ] 1.3 Implement error handling for create/load: duplicate project check, non-existent project check
- [ ] 1.4 Build `/synaphex/settings <project>` command skeleton for interactive agent configuration

## 2. Agent Configuration System

- [ ] 2.1 Define capability matrix for Claude models (Haiku 4.5, Sonnet 4.6, Opus 4.6) with support for `provider`, `model`, `effort`, `think`
- [ ] 2.2 Implement validation logic: Haiku 4.5 cannot use extended thinking or effort > 0
- [ ] 2.3 Create interactive prompt flow in `/synaphex/settings` to configure each of the 6 agents (Examiner, Researcher, Planner, Coder, Answerer, Reviewer)
- [ ] 2.4 Generate default `settings.json` for new projects with sensible agent defaults
- [ ] 2.5 Build settings save/load with validation before persisting to JSON

## 3. Memory Organization & Management

- [ ] 3.1 Create `/synaphex/memorize <project>` command that analyzes codebase and generates topic-based Markdown memory files
- [ ] 3.2 Implement memory topic detection for C++, Python, ROS 1 Noetic, security concerns
- [ ] 3.3 Design memory file structure: `memory/internal/{topic}.md` files for architecture, APIs, dependencies, security, etc.
- [ ] 3.4 Create `/synaphex/remember <parent> <child>` command that creates symlinks from parent's `memory/internal/` into child's `memory/external/{parent}_memory/`
- [ ] 3.5 Implement symlink update/replace logic if link already exists

## 4. Task Pipeline Infrastructure (Part A: Setup & Examiner)

- [ ] 4.1 Implement `/synaphex/task <project> <task_sentence>` command with user prompts for Researcher activation and Reviewer handling
- [ ] 4.2 Implement `/synaphex/fix <project> <fix_sentence>` command (identical to task but Researcher pre-disabled)
- [ ] 4.3 Build Examiner agent that reads `memory/internal/`, codebase, and `memory/external/` linked memory
- [ ] 4.4 Implement Examiner context compaction: creates `memory/internal/task_sentence/task_sentence.md` (full) and `task_sentence_compact.md` (condensed)
- [ ] 4.5 Add task-aware compaction strategy (prioritizes different info for bug fixes vs. features)

## 5. Task Pipeline Infrastructure (Part B: Researcher Agent)

- [ ] 5.1 Build Researcher agent that performs internet research based on task_sentence
- [ ] 5.2 Implement Researcher findings storage: saves to `memory/internal/research/{topic}.md` if user chooses to keep
- [ ] 5.3 Create discard mechanism: findings are not persisted if user declines to save
- [ ] 5.4 Integrate research findings into compact task memory for Coder consumption

## 6. Task Pipeline Infrastructure (Part C: Planner & Coder)

- [ ] 6.1 Build Planner agent that receives Examiner/Researcher context and creates implementation plan
- [ ] 6.2 Implement Planner presentation & user approval flow: shows plan and waits for yes/no
- [ ] 6.3 Build Coder agent that implements according to Planner's approved plan
- [ ] 6.4 Implement Coder → Answerer query mechanism: Coder can ask questions when blocked
- [ ] 6.5 Build Answerer agent that responds to Coder questions or escalates architectural decisions to user

## 7. Task Pipeline Infrastructure (Part D: Reviewer & Looping)

- [ ] 7.1 Build Reviewer agent that examines implemented code for correctness and requirement adherence
- [ ] 7.2 Implement Reviewer feedback mechanism: provides detailed issue feedback to Planner
- [ ] 7.3 Implement Reviewer loop: Planner re-plans → Coder re-implements → Answerer supports → Reviewer re-checks
- [ ] 7.4 Implement loop iteration counter with max 3 loops; prompt user for manual intervention if exceeded
- [ ] 7.5 Handle Reviewer skip case: if user selects "no review", pipeline completes without Reviewer

## 8. Pipeline Orchestration & Routing

- [ ] 8.1 Implement pipeline execution order: Examiner → [Researcher] → Planner → Coder → Answerer → [Reviewer]
- [ ] 8.2 Build conditional stage routing: Researcher runs only if user enabled; Reviewer runs only if user configured
- [ ] 8.3 Implement Reviewer → Planner loop routing: redirect Reviewer feedback to Planner for re-planning
- [ ] 8.4 Build Answerer stateless query handler: each Coder question includes full context
- [ ] 8.5 Create pipeline context passing: each agent receives necessary context from prior agents

## 9. User Interaction & Prompts

- [ ] 9.1 Implement Researcher activation prompt in `/synaphex/task`: "Activate Researcher? [yes/no]"
- [ ] 9.2 Implement Reviewer handling prompt: "[user performs review / agent performs review / ask when reached]"
- [ ] 9.3 Implement user approval prompt for Planner's plan: "Proceed? [yes/no]"
- [ ] 9.4 Implement Researcher findings save prompt: "Save findings to memory? [yes/no]"
- [ ] 9.5 Implement escalation prompts: Answerer asks user for architectural decisions with clear options

## 10. Testing & Validation

- [ ] 10.1 Test project creation/loading with valid and invalid names
- [ ] 10.2 Test settings validation: reject Haiku 4.5 with Think=Yes or Effort>0
- [ ] 10.3 Test memory organization: verify topic-based Markdown files created correctly
- [ ] 10.4 Test symlink creation in `/synaphex/remember` with parent-child linking
- [ ] 10.5 Test full task pipeline execution with all agents (Examiner → Researcher → Planner → Coder → Answerer → Reviewer)
- [ ] 10.6 Test Reviewer loop: simulate Reviewer finding issues, verify Planner receives feedback and loops
- [ ] 10.7 Test `/synaphex/fix` disables Researcher while other agents function normally
- [ ] 10.8 Test context compaction: verify compact memory is significantly smaller than full memory
- [ ] 10.9 Test Coder → Answerer query flow with multiple questions
- [ ] 10.10 Test memory persistence: verify settings.json and memory files survive project reload

## 11. Documentation & Integration

- [ ] 11.1 Document all 7 CLI commands with usage examples and expected outputs
- [ ] 11.2 Document agent capability matrix and supported model combinations
- [ ] 11.3 Document memory organization scheme for users creating custom topics
- [ ] 11.4 Document symlink behavior and how external memory linking works
- [ ] 11.5 Document pipeline stages, agent roles, and user decision points
- [ ] 11.6 Integrate CLI commands as Claude Code skills under `/synaphex/*` namespace
- [ ] 11.7 Update main Synaphex documentation with Phase 2 architecture overview

## 12. Edge Cases & Error Handling

- [ ] 12.1 Handle missing project directory gracefully in all commands
- [ ] 12.2 Handle corrupted `settings.json` with helpful error message and recovery suggestion
- [ ] 12.3 Handle broken symlinks in `/synaphex/remember` and offer repair
- [ ] 12.4 Handle Coder returning incomplete implementation (partial code submission)
- [ ] 12.5 Handle network errors in Researcher internet searches with retry logic
- [ ] 12.6 Handle task cancellation mid-pipeline: allow user to abort and save partial progress
