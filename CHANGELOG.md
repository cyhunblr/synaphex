# [2.3.0](https://github.com/cyhunblr/synaphex/compare/v2.2.0...v2.3.0) (2026-04-18)


### Bug Fixes

* resolve ESLint and markdown linting errors in test files ([512c442](https://github.com/cyhunblr/synaphex/commit/512c44263ab9a0671e44dffd90b2ddd32f08652f))
* resolve ESLint and TypeScript errors in test utilities ([4b78643](https://github.com/cyhunblr/synaphex/commit/4b7864329216b14dc7afe6c0bbc8b97b13a05a15))
* update error handling in tests for missing memory file and improve type safety in test-utils ([1463a5e](https://github.com/cyhunblr/synaphex/commit/1463a5ea6324d12949dce3b72dcbe4f682c3dc69))


### Features

* add --version, --help, and --check CLI flags ([ffdde43](https://github.com/cyhunblr/synaphex/commit/ffdde436febd1ea2d9f5c41be30c13597f204494))

# [2.2.0](https://github.com/cyhunblr/synaphex/compare/v2.1.0...v2.2.0) (2026-04-18)


### Features

* implement Phase 3 memory and commands specification (55/55 tasks) ([8a008b4](https://github.com/cyhunblr/synaphex/commit/8a008b4a558e16529e6c76dd87174f5c55193193))
* implement researcher agent with web search and memory persistence (Phase 2.1) ([03f3467](https://github.com/cyhunblr/synaphex/commit/03f3467b1e50074761af42ea6e7be879fec9fe25))

# [2.1.0](https://github.com/cyhunblr/synaphex/compare/v2.0.0...v2.1.0) (2026-04-17)


### Bug Fixes

* resolve markdown linting issues in docs and OpenSpec files ([390c34b](https://github.com/cyhunblr/synaphex/commit/390c34b842a385ab1694a8a2124959340b9ad050))


### Features

* implement synaphex init command for IDE auto-setup ([4ec18fb](https://github.com/cyhunblr/synaphex/commit/4ec18fb01c53f180d82f453e8e2b19a447f05ce7))

# [2.0.0](https://github.com/cyhunblr/synaphex/compare/v1.8.1...v2.0.0) (2026-04-17)

### Features

- major refactoring for Phase 3 architecture ([4112d23](https://github.com/cyhunblr/synaphex/commit/4112d23aa0e07839a36a86dc80914f156300a8bd))
- comprehensive documentation overhaul for v2.0.0 release (INSTALLATION.md, GETTING-STARTED.md, HOW-TO-GUIDE.md, EXAMPLES.md, ARCHITECTURE.md, TROUBLESHOOTING.md, CLI-REFERENCE.md)

### BREAKING CHANGES

- Major architectural changes including task workflow state
  validation, researcher and answerer agents, and comprehensive error handling.

## [1.8.1](https://github.com/cyhunblr/synaphex/compare/v1.8.0...v1.8.1) (2026-04-17)

### Bug Fixes

- version ([23fc960](https://github.com/cyhunblr/synaphex/commit/23fc9602939b8a8bb8492aca1e67fb38c3ca0937))

# [1.8.0](https://github.com/cyhunblr/synaphex/compare/v1.7.1...v1.8.0) (2026-04-17)

### Bug Fixes

- resolve all markdown linting errors ([33a13ed](https://github.com/cyhunblr/synaphex/commit/33a13ed79cbe2b5274678965d3aeb09cfbca5e5b))
- resolve eslint error handling issues ([1dde577](https://github.com/cyhunblr/synaphex/commit/1dde57781e85b9dfef3eb82fc44ec3399f5c9dd4))
- resolve TypeScript type error in integration scenario tests ([da5f127](https://github.com/cyhunblr/synaphex/commit/da5f1271a73224cfafc96faa556911a1f494ae41))

### Features

- add comprehensive error handling and documentation ([128360e](https://github.com/cyhunblr/synaphex/commit/128360ecc8af5031b75e5bc4d9d01d025d8950b6))
- add documentation update commit message to permissions ([c8e9e21](https://github.com/cyhunblr/synaphex/commit/c8e9e21004001e88982b42527c4911dca33b8e4b))
- add git commit amend command to permissions ([5576e23](https://github.com/cyhunblr/synaphex/commit/5576e234b130571a23bf65671f991712c484d837))
- implement edge case handling for v2.0.0 ([db59bef](https://github.com/cyhunblr/synaphex/commit/db59bef04896f7fdedb0452dbfa0e873ed343456))
- implement Researcher and Answerer agent runners ([510114d](https://github.com/cyhunblr/synaphex/commit/510114d2ad5d1306a2eb031a2e45eb87da5d9803))
- implement task-remember command and complete Sections 9-11 ([f007430](https://github.com/cyhunblr/synaphex/commit/f007430d729ed7db25c3803f961c0185685a6bfd))
- **phase-3:** Foundational refactoring for user-orchestrated task workflow (37/118 tasks) ([5dbcee4](https://github.com/cyhunblr/synaphex/commit/5dbcee4f2ef56e3060989ee18cbbf3fbb3fd84d5))
- **phase-3:** Implement state validation in task commands (48/118 tasks) ([ce0214c](https://github.com/cyhunblr/synaphex/commit/ce0214cff3eec5bd7136baef72aa9a5fe432c3b4))

## [1.7.1](https://github.com/cyhunblr/synaphex/compare/v1.7.0...v1.7.1) (2026-04-16)

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
