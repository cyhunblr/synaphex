## Context

Synaphex v2.0.0 is feature-complete with 116/118 tasks done. The two remaining QA tasks were deferred as optional post-release work:

- **14.4 Performance Benchmarking**: Compare v2.0.0 metrics vs v1.7.0
- **14.6 Manual Workflow Testing**: Document end-to-end 8-step pipelines

Both tasks are non-blocking for the v2.0.0 release (82 automated tests validate core functionality). This design captures how to implement them when resources are available.

## Goals / Non-Goals

**Goals:**

- Establish performance baseline: token usage, latency, memory for v2.0.0 vs v1.7.0
- Document real-world usage with complete task workflows (create → examine → researcher → planner → coder → answerer → reviewer)
- Identify any performance regressions in v2.0.0
- Provide reference documentation for users

**Non-Goals:**

- Optimize performance (if regressions found, that's v2.1.x work)
- Automate manual testing (82 existing automated tests suffice for CI/CD)
- Change any v2.0.0 code or features

## Decisions

### 14.4 Performance Benchmarking

#### Decision 1: Benchmark Approach

- Compare same workflows on v1.7.0 (checkout from git tag) vs v2.0.0 (current)
- Measure: input tokens, output tokens, total latency, memory peak
- Run identical task: "Add user authentication with JWT" across both versions
- Use real Anthropic API calls (not mocked)

#### Decision 2: Metrics to Track

- Agent-level: tokens per agent, execution time per agent
- Pipeline-level: total tokens, total time, memory usage
- Report: baseline (v1.7.0), current (v2.0.0), delta, % change

#### Decision 3: Regression Threshold

- Acceptable: ≤5% token increase (API cost)
- Acceptable: ≤10% latency increase (user-facing)
- Flag if: >5% token delta or >10% latency delta for investigation

### 14.6 Manual Workflow Testing

#### Decision 1: Test Scenarios

- Scenario 1: Simple task (no researcher, no escalation) — "Add password reset endpoint"
- Scenario 2: Complex task (with researcher) — "Integrate GraphQL subscriptions"
- Scenario 3: Escalation task (architectural question) — "Implement real-time notifications"
- Scenario 4: Multi-project (child inherits parent knowledge)

#### Decision 2: Documentation Output

- Screenshot/transcript of each step
- Observations on UX clarity
- Notes on command output readability
- Any issues encountered
- Time to complete each workflow

#### Decision 3: Test Environment

- Use existing test projects in ~/.synaphex
- Real Anthropic API (not mocked)
- Document exact commands and outputs
- Save as markdown guide in docs/manual-testing-log.md

## Risks / Trade-offs

**Risk 1: Performance Regression Detection**
→ Mitigation: Strict threshold (5% tokens, 10% latency). If found, create v2.1.x performance issue.

**Risk 2: v1.7.0 Checkout Compatibility**
→ Mitigation: Verify v1.7.0 still builds/runs before benchmark. If not, benchmark against v1.6.0.

**Risk 3: Flaky API Metrics**
→ Mitigation: Run each workflow 3× on each version, report average ± std dev.

**Risk 4: Manual Testing Takes Too Long**
→ Mitigation: Limit to 4 scenarios max. Use existing test projects (don't create new ones).

## Open Questions

- Should we also profile memory usage or just tokens/latency?
- Should benchmarking include error cases (invalid input, missing dependencies)?
- Should manual testing be done by different users to catch UX pain points?
