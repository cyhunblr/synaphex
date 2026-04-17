# [2.0.0](https://github.com/cyhunblr/synaphex/compare/v1.7.1...v2.0.0) (2026-04-17)

### Features

- implement Phase 3 refactoring with task workflow state validation ([#48](https://github.com/cyhunblr/synaphex/issues/48))
- add researcher agent for knowledge gap research and web search integration ([#47](https://github.com/cyhunblr/synaphex/issues/47))
- introduce task state machine with sequential workflow validation ([#46](https://github.com/cyhunblr/synaphex/issues/46))
- add answerer agent for question answering and escalation handling ([#45](https://github.com/cyhunblr/synaphex/issues/45))
- add comprehensive error handling documentation and guidelines ([#44](https://github.com/cyhunblr/synaphex/issues/44))
- add memory organization guidelines for project memory management ([#43](https://github.com/cyhunblr/synaphex/issues/43))

### Bug Fixes

- resolve all markdown and eslint linting errors for codebase compliance ([#50](https://github.com/cyhunblr/synaphex/issues/50))
- fix error handling in examiner agent with proper cause preservation ([#49](https://github.com/cyhunblr/synaphex/issues/49))

### BREAKING CHANGES

- Major architectural refactoring for Phase 3 — task workflow and agent pipeline changes

## [1.7.1](https://github.com/cyhunblr/synaphex/compare/v1.7.0...v1.7.1) (2026-04-16)

### Bug Fixes

- finalize linting and plugin transition ([9ac47e5](https://github.com/cyhunblr/synaphex/commit/9ac47e5889f1d6a2af8053058b51976d5604b633))

# [1.7.0](https://github.com/cyhunblr/synaphex/compare/v1.6.3...v1.7.0) (2026-04-16)

### Features

- namespace task-related tools and remove native MCP prompts in favor of plugin-based skills ([6ab0d17](https://github.com/cyhunblr/synaphex/commit/6ab0d1719a7afa2049dac3222c8c2d9c1557ff6f))

## [1.6.3](https://github.com/cyhunblr/synaphex/compare/v1.6.2...v1.6.3) (2026-04-16)

### Bug Fixes

- finalize bulletproof multi-path plugin and skills discovery ([330efbf](https://github.com/cyhunblr/synaphex/commit/330efbf8341ce68f0c4975206d48a2205df71656))

## [1.6.2](https://github.com/cyhunblr/synaphex/compare/v1.6.1...v1.6.2) (2026-04-16)

### Bug Fixes

- include .claude-plugin in package distribution files ([7860ad7](https://github.com/cyhunblr/synaphex/commit/7860ad7326813765472adc7e486eedc1c09f9432))

## [1.6.1](https://github.com/cyhunblr/synaphex/compare/v1.6.0...v1.6.1) (2026-04-16)

### Bug Fixes

- align documentation with plugin architecture and namespaced commands ([3d0485f](https://github.com/cyhunblr/synaphex/commit/3d0485ff196c417eb19d41056ed09659e08a31e2))

# [1.6.0](https://github.com/cyhunblr/synaphex/compare/v1.5.1...v1.6.0) (2026-04-16)

### Features

- transition to Claude Code plugin with namespaced commands ([de6d8bf](https://github.com/cyhunblr/synaphex/commit/de6d8bfa83db1263850bef60b2cc478a0ed732d7))

## [1.5.1](https://github.com/cyhunblr/synaphex/compare/v1.5.0...v1.5.1) (2026-04-16)

### Bug Fixes

- resolve skills path relative to package root instead of cwd ([5092ef7](https://github.com/cyhunblr/synaphex/commit/5092ef700db978f64889fccf478b702ea6ec5468))

# [1.5.0](https://github.com/cyhunblr/synaphex/compare/v1.4.0...v1.5.0) (2026-04-16)

### Features

- add automated CLI setup wizard for IDE integration and skill linking ([927cdeb](https://github.com/cyhunblr/synaphex/commit/927cdeb23faaf2f5459c58ca492281d26a6a794b))

# [1.4.0](https://github.com/cyhunblr/synaphex/compare/v1.3.0...v1.4.0) (2026-04-16)

### Features

- implement native MCP prompts for Claude Code slash command integration ([dbe8ad9](https://github.com/cyhunblr/synaphex/commit/dbe8ad90137b5258e097ade5667c41098622d689))

# [1.3.0](https://github.com/cyhunblr/synaphex/compare/v1.2.0...v1.3.0) (2026-04-16)

### Features

- **docs,schema:** add vscode model IDs, remove api keys, model transition hints ([48484c7](https://github.com/cyhunblr/synaphex/commit/48484c7ab81f8ac6ba512243dfa9da3e160e2206))
- **schema,docs:** add latest Copilot model IDs (GPT-5, Gemini 3), update vscode transitions ([e0588ac](https://github.com/cyhunblr/synaphex/commit/e0588ac42c8ea3e87310939042fe546e133b0ba5))

# [1.2.0](https://github.com/cyhunblr/synaphex/compare/v1.1.1...v1.2.0) (2026-04-16)

### Features

- **settings:** add Antigravity model IDs, update defaults, translate delegated prompts to English ([3a1fec5](https://github.com/cyhunblr/synaphex/commit/3a1fec52d26cacc1e946b39b320f793797776ac5))

## [1.1.1](https://github.com/cyhunblr/synaphex/compare/v1.1.0...v1.1.1) (2026-04-16)

### Bug Fixes

- **responses:** replace legacy cli slash command references with natural tool names ([d4fee71](https://github.com/cyhunblr/synaphex/commit/d4fee7111cf530aecfb2442bf7346d2243d1a632))

# [1.1.0](https://github.com/cyhunblr/synaphex/compare/v1.0.0...v1.1.0) (2026-04-16)

### Features

- add delegated mode for IDE model delegation ([26bddc1](https://github.com/cyhunblr/synaphex/commit/26bddc175fe1f7f8fb21397a1bcd607b38313a90))

# 1.0.0 (2026-04-16)

### Features

- project initialized ([e63daa4](https://github.com/cyhunblr/synaphex/commit/e63daa41d4e61f61113d4f7ad14ffb0ff3b5ae0a))
