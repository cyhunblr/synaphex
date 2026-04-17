# Task List: v2.0.0 Optional QA (Tasks 14.4 and 14.6)

## 1. Performance Benchmarking Setup

- [ ] 1.1 Create benchmark directory: `benchmarks/v2-baseline/`
- [ ] 1.2 Clone v1.7.0 codebase for comparison
- [ ] 1.3 Verify v1.7.0 builds and runs successfully
- [ ] 1.4 Document v1.7.0 setup steps and environment
- [ ] 1.5 Create benchmark configuration file with metrics to track

## 2. Benchmark Execution (Simple Task)

- [ ] 2.1 Run "Add password reset endpoint" task on v1.7.0 (3 iterations)
- [ ] 2.2 Record tokens, latency, memory for each iteration
- [ ] 2.3 Run same task on v2.0.0 (3 iterations)
- [ ] 2.4 Calculate mean, std dev, min, max for each metric
- [ ] 2.5 Compare results and identify any regressions

## 3. Benchmark Execution (Complex Task with Research)

- [ ] 3.1 Run "Integrate GraphQL subscriptions" on v1.7.0 (3 iterations)
- [ ] 3.2 Record researcher token cost separately
- [ ] 3.3 Run same task on v2.0.0 (3 iterations)
- [ ] 3.4 Compare researcher performance between versions
- [ ] 3.5 Document findings for researcher agent

## 4. Benchmark Reporting

- [ ] 4.1 Create `benchmarks/v2-baseline/report.md`
- [ ] 4.2 Add baseline (v1.7.0) metrics table
- [ ] 4.3 Add current (v2.0.0) metrics table
- [ ] 4.4 Add delta and % change columns
- [ ] 4.5 Document environment details (OS, Node, SDK versions)
- [ ] 4.6 Highlight any regressions (>5% tokens, >10% latency)
- [ ] 4.7 Include recommendations for v2.1.x

## 5. Manual Testing Setup

- [ ] 5.1 Create test projects for manual workflows
- [ ] 5.2 Create `docs/manual-testing-log.md` for documentation
- [ ] 5.3 Document test environment and versions
- [ ] 5.4 Prepare example codebases for each scenario

## 6. Manual Testing - Simple Workflow

- [ ] 6.1 Run "Add password reset endpoint" full workflow (create → examine → planner → coder → answerer → reviewer)
- [ ] 6.2 Document each command executed
- [ ] 6.3 Record output from each step
- [ ] 6.4 Note execution time and token usage
- [ ] 6.5 Verify all files are created correctly
- [ ] 6.6 Test state validation (can/cannot skip steps)

## 7. Manual Testing - Research Workflow

- [ ] 7.1 Run "Integrate GraphQL subscriptions" workflow
- [ ] 7.2 Execute task-researcher step
- [ ] 7.3 Verify research files created in memory/internal/research/
- [ ] 7.4 Document researcher output quality
- [ ] 7.5 Verify planner incorporates research findings
- [ ] 7.6 Complete rest of workflow (coder, answerer, reviewer)

## 8. Manual Testing - Escalation Workflow

- [ ] 8.1 Run "Implement real-time notifications" workflow
- [ ] 8.2 Verify coder embeds architectural questions with markers
- [ ] 8.3 Verify answerer detects questions
- [ ] 8.4 Verify escalation is set in task-meta.json
- [ ] 8.5 Document escalation format and user guidance
- [ ] 8.6 Simulate user decision and re-planning (iteration 2)

## 9. Manual Testing - Multi-Project Workflow

- [ ] 9.1 Create parent and child projects
- [ ] 9.2 Add memory files to parent project
- [ ] 9.3 Run task-remember to link parent memory
- [ ] 9.4 Verify symlink creation in child's external memory
- [ ] 9.5 Create task in child project
- [ ] 9.6 Verify child planner can access parent memory
- [ ] 9.7 Complete workflow using parent context

## 10. UX and Error Validation

- [ ] 10.1 Test all command help texts and descriptions
- [ ] 10.2 Verify error messages for out-of-order steps
- [ ] 10.3 Verify error messages are actionable
- [ ] 10.4 Test invalid inputs (bad project names, missing files)
- [ ] 10.5 Verify file paths in output are clear and absolute
- [ ] 10.6 Verify token usage is displayed where applicable

## 11. Issue Documentation

- [ ] 11.1 Log any UX issues encountered (with severity)
- [ ] 11.2 Log any functional issues or errors (with reproduction steps)
- [ ] 11.3 Log any performance observations
- [ ] 11.4 Categorize issues by: blocker, important, nice-to-have
- [ ] 11.5 Create GitHub issues for blockers
- [ ] 11.6 Compile list of improvements for v2.1.x

## 12. Final QA Documentation

- [ ] 12.1 Finalize manual-testing-log.md with all scenarios
- [ ] 12.2 Add screenshots/transcripts of workflows
- [ ] 12.3 Document lessons learned
- [ ] 12.4 Create summary: what worked well, what needs improvement
- [ ] 12.5 Archive benchmarks and testing artifacts
- [ ] 12.6 Close out task with sign-off
