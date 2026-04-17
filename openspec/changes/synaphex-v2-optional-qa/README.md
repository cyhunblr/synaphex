# Synaphex v2.0.0 Optional QA - Implementation Guide

This OpenSpec change captures the two deferred QA tasks from Phase 3:

- **14.4 Performance Benchmarking**
- **14.6 Manual Workflow Testing**

## Quick Overview

**Total Tasks**: 69 (split across 2 capabilities)
**Estimated Time**: 8-12 hours (if done sequentially)
**Blocking**: No — v2.0.0 ships without this work

## Two Capabilities

### 1. Performance Benchmarking (14.4)

**Goal**: Compare v2.0.0 performance vs v1.7.0

**What You'll Do**:

- Set up v1.7.0 for comparison
- Run identical workflows on both versions (3 times each for statistical validity)
- Measure: tokens, latency, memory
- Generate report with baseline, current, and delta

**Tasks**: Sections 1-4 (20 tasks)

- Setup (5 tasks)
- Simple workflow benchmarking (5 tasks)
- Complex workflow with research (5 tasks)
- Report generation (7 tasks)

**Time**: 3-4 hours

### 2. Manual Workflow Testing (14.6)

**Goal**: Document and validate all 8-step task workflows

**What You'll Do**:

- Execute 4 different task scenarios end-to-end
- Document each step (commands, outputs, observations)
- Validate UX (clarity, error messages, output readability)
- Log any issues found

**Tasks**: Sections 5-12 (49 tasks)

- Setup (4 tasks)
- Simple workflow testing (6 tasks)
- Research workflow testing (7 tasks)
- Escalation workflow testing (7 tasks)
- Multi-project workflow testing (7 tasks)
- UX validation (6 tasks)
- Issue documentation (6 tasks)
- Final documentation (6 tasks)

**Time**: 4-8 hours

## How to Use This

### Start the Work

```bash
# List available tasks
openspec status --change "synaphex-v2-optional-qa"

# Start implementing
/opsx:apply synaphex-v2-optional-qa
```

### Implementation Tips

1. **Do one capability at a time** — either benchmarking OR testing, not both simultaneously
2. **Read the design.md first** — it explains the approach
3. **Reference the specs** — they define what "done" looks like
4. **Mark tasks as you go** — the UI will show progress
5. **Document findings** — save your reports and testing logs

### Which to Do First?

- **Start with 14.6 (Manual Testing)** if you want quick wins and usability feedback
- **Start with 14.4 (Benchmarking)** if you want performance data

Both are independent — you can do them in any order.

## Acceptance Criteria

### 14.4 Complete When

✅ Benchmarks run on both v1.7.0 and v2.0.0
✅ Report includes: baseline, current, delta for tokens and latency
✅ Regressions identified (if any)
✅ Recommendations documented

### 14.6 Complete When

✅ All 4 workflows executed end-to-end
✅ Each step documented (commands, outputs)
✅ UX validated (commands clear, errors helpful, output readable)
✅ Issues logged and categorized
✅ manual-testing-log.md complete

## Resources

- **Design**: Read `design.md` for approach and decisions
- **Specs**: Check `specs/*/spec.md` for detailed requirements
- **v2.0.0 Workflow Guide**: See `docs/workflow-guide.md` in main repo
- **v2.0.0 CLI Reference**: See `docs/cli-reference.md`

## Questions?

Refer to:

- `design.md` → "Open Questions" section
- `specs/*/spec.md` → Scenario details
- Phase 3 workflow guide → Real-world examples

---

**Status**: Ready to work  
**Artifacts**: All complete (proposal, design, specs, tasks)  
**v2.0.0 Release**: At 116/118 (98%) — ships without this work
