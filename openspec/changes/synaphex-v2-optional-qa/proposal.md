## Why

Synaphex v2.0.0 has shipped with 116/118 tasks complete (98%), with all core functionality implemented and validated by 82 automated tests. The two remaining tasks are optional post-release quality assurance: performance benchmarking against v1.7.0, and manual end-to-end workflow testing. These are deferred to v2.1 but should be tracked as independent work items with clear acceptance criteria.

## What Changes

No code changes. This is a post-release QA specification for:

1. **Performance Benchmarking (14.4)**: Establish baseline performance metrics for v2.0.0 against v1.7.0. Measure token usage, execution time, and memory footprint across all pipeline agents.

2. **Manual Workflow Testing (14.6)**: Document real-world usage patterns by running the complete 8-step task workflow (create → examine → researcher → planner → coder → answerer → reviewer) end-to-end with example projects.

## Capabilities

### New Capabilities

- `performance-benchmarking`: Compare v2.0.0 execution metrics (tokens, latency, memory) against v1.7.0 baseline. Identify any regressions.
- `manual-workflow-testing`: Execute and document full task pipeline workflows with real projects to validate feature completeness and usability.

### Modified Capabilities

(None — no existing specs are changing)

## Impact

- **Code**: None (no implementation changes)
- **Testing**: Adds benchmarking suite and workflow documentation
- **Documentation**: New performance report and workflow examples
- **Release**: v2.0.0 ships as-is; these tasks are v2.1 scope
