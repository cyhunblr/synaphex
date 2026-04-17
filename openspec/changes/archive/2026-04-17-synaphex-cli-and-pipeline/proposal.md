## Why

Synaphex currently lacks a structured CLI and multi-agent task pipeline to coordinate complex development workflows. Inspired by [OpenSpec](https://github.com/Fission-AI/OpenSpec)'s spec-driven development philosophy, developers need a way to manage projects (create, load, configure) and execute orchestrated agent pipelines (Examiner → Researcher → Planner → Coder → Answerer → Reviewer) with configurable agent parameters (model, provider, effort, thinking). Memory management (internal/external) must be first-class and composable across projects, enabling alignment between human intent and multi-agent execution. This change provides the foundational CLI commands and agent orchestration needed for Phase 2 of Synaphex, bringing OpenSpec's "agree on what to build before code is written" principle to AI-driven task execution.

## What Changes

- **New CLI Commands**: `/synaphex/create`, `/synaphex/load`, `/synaphex/memorize`, `/synaphex/remember`, `/synaphex/settings`, `/synaphex/task`, `/synaphex/fix`
- **Project Structure**: Global `.synaphex/` directory with per-project `settings.json` and `memory/` directories (internal/external subdirs)
- **Agent Configuration**: Per-project `settings.json` stores agent configurations (Examiner, Researcher, Planner, Coder, Answerer, Reviewer) with `provider`, `model`, `effort`, `think` parameters
- **Memory Organization**: Markdown-based memory files organized by topic in `memory/internal/` (editable) and `memory/external/` (linked projects)
- **Task Pipeline**: 6-agent orchestration with optional Researcher and Reviewer; Examiner compacts context for Coder; Coder can query Answerer; Reviewer loops back to Planner if issues found
- **Quick Fix Pipeline**: Fast path with Researcher disabled for rapid bug fixes
- **Agent Capability Matrix**: Support for multiple Claude models with model-specific feature availability (e.g., Haiku has no extended thinking or effort)

## Capabilities

### New Capabilities

- `synaphex-cli`: CLI commands for project and settings management (`create`, `load`, `memorize`, `remember`, `settings`)
- `synaphex-task-pipeline`: 6-agent task orchestration (Examiner→Researcher→Planner→Coder→Answerer→Reviewer) with optional stages and looping
- `synaphex-fix-pipeline`: Streamlined fix pipeline with Researcher disabled
- `synaphex-project-structure`: Directory structure for projects with `.synaphex/`, `settings.json`, and `memory/internal/external/` organization
- `synaphex-memory-management`: Markdown-based topic-organized memory with internal (editable) and external (linked) directories
- `synaphex-agent-configuration`: Per-agent settings including provider, model, effort, thinking with capability-aware constraints
- `synaphex-context-compaction`: Examiner compacts memory and code context for Coder using `task_sentence.md` and `task_sentence_compact.md`
- `synaphex-tool-support`: Multi-provider support (Claude, Gemini, OpenAI), direct/delegated execution modes, automated setup wizard, and credential management

### Modified Capabilities

- `synaphex-architecture`: Phase 1 skills integration extended with Phase 2 pipeline orchestration

## Impact

- **New CLI Interface**: Users interact with Synaphex via `/synaphex/` commands in Claude Code
- **Project Isolation**: Each project has independent settings and memory, enabling parallel work
- **Agent Flexibility**: Model selection per-agent allows cost/quality/speed tradeoffs across multiple providers (Claude, Gemini, OpenAI)
- **IDE Integration**: Automated setup wizard (`npx synaphex setup <platform>`) configures MCP servers, plugin bundles, and skills for Claude Code, VSCode Copilot, Antigravity
- **Execution Modes**: Both direct (API calls) and delegated (IDE model) execution enable flexibility for different IDEs and workflows
- **Knowledge Reuse**: Cross-project memory linking reduces redundant context gathering
- **Memory-Driven Development**: Markdown memory files become the source of truth for project context
- **Multi-Provider Ecosystem**: Support for Claude, Gemini, OpenAI (with extensible capability matrix) aligns with OpenSpec's "25+ tools" philosophy
