# Performance Benchmarking Capability

## ADDED Requirements

### Requirement: Establish v2.0.0 performance baseline vs v1.7.0

The system SHALL measure and compare key performance metrics between v2.0.0 and v1.7.0 to identify any regressions in token efficiency, execution time, and memory usage.

#### Scenario: Benchmark token usage across task pipeline

- **WHEN** running identical task workflow on both v1.7.0 and v2.0.0
- **THEN** total input tokens, output tokens, and combined token count are recorded for each version
- **AND** percent change (delta) is calculated and reported

#### Scenario: Benchmark execution time per agent

- **WHEN** profiling a complete task execution
- **THEN** execution time is measured for each agent: examiner, researcher (if used), planner, coder, answerer, reviewer
- **AND** individual agent timings are reported for both versions with delta

#### Scenario: Identify regressions using acceptance threshold

- **WHEN** comparing token usage metrics
- **THEN** if v2.0.0 tokens > v1.7.0 tokens + 5%, flag as regression
- **AND** if execution time increases > 10%, flag as regression
- **AND** regressions are documented for investigation in v2.1.x

#### Scenario: Generate benchmark report

- **WHEN** benchmark run completes
- **THEN** report is generated with: baseline (v1.7.0), current (v2.0.0), delta, % change for each metric
- **AND** report includes: test date, workflows tested, token breakdown, latency breakdown, recommendations

### Requirement: Support multiple test scenarios for benchmarking

The system SHALL run benchmarks across representative workflows to ensure metrics are meaningful.

#### Scenario: Benchmark simple task (no research, no escalation)

- **WHEN** running task: "Add password reset endpoint"
- **THEN** benchmark includes: examine, planner, coder, answerer, reviewer steps
- **AND** token usage and latency are recorded

#### Scenario: Benchmark complex task with research

- **WHEN** running task: "Integrate GraphQL subscriptions"
- **THEN** benchmark includes: examine, researcher, planner, coder, answerer, reviewer steps
- **AND** researcher token cost and latency are isolated

#### Scenario: Run each benchmark 3 times for statistical validity

- **WHEN** benchmark runs on same workflow
- **THEN** test is executed 3 times on v1.7.0 and 3 times on v2.0.0
- **AND** results include: mean, standard deviation, min, max for each metric
- **AND** outliers are identified and documented

### Requirement: Compare v1.7.0 and v2.0.0 on same system

The system SHALL ensure fair comparison by using identical environment, API keys, models, and configurations.

#### Scenario: Checkout v1.7.0 from git for comparison

- **WHEN** starting benchmark
- **THEN** v1.7.0 is checked out from git tag
- **AND** dependencies are installed and build succeeds
- **AND** v1.7.0 is verified functional before benchmark starts

#### Scenario: Use identical agent configurations for both versions

- **WHEN** configuring agents for benchmark
- **THEN** both v1.7.0 and v2.0.0 use same: model (e.g., claude-opus-4-7), think setting, effort tier
- **AND** task parameters are identical
- **AND** project memory state is identical (or empty)

#### Scenario: Report environment details in benchmark report

- **WHEN** generating benchmark report
- **THEN** report includes: OS, Node version, Anthropic SDK version, API key region, timestamp
- **AND** external factors (network, API throttling) are noted if detected
