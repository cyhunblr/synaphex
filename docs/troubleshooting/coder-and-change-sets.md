# Troubleshooting: CODER and change sets

CODER refusals, plan gates, applying and rejecting change sets, and recovery
after an interrupted apply.

## Troubleshooting index

- [Installation](installation.md)
- [Providers and agent execution](providers.md)
- [Sessions and locks](sessions-and-locks.md)
- **CODER and change sets**

## Symptom index

| Symptom | Code | Jump to |
| --- | --- | --- |
| CODER succeeded but my files are unchanged | — | [Source did not change](#coder-ran-but-my-source-did-not-change) |
| CODER refuses, worktree is dirty | `CODER_STAGING_WORKTREE_DIRTY` | [Dirty worktree](#dirty-worktree) |
| CODER refuses, not a Git repository | `CODER_STAGING_REQUIRES_GIT` | [Not a Git repository](#not-a-git-repository) |
| CODER refuses this repository shape | `CODER_STAGING_UNSUPPORTED_REPOSITORY` | [Unsupported repository](#unsupported-repository-shape) |
| CODER blocked by a plan draft | `PLAN_DRAFT_PENDING` | [Pending plan draft](#pending-plan-draft) |
| I approved the plan in chat, still blocked | `PLAN_DRAFT_PENDING` | [Chat approval](#i-said-looks-good-but-coder-is-still-blocked) |
| Change set will not apply | `CHANGE_SET_SOURCE_*` | [Apply refuses](#apply-refuses-because-the-source-changed) |
| Not the current target | `CHANGE_SET_NOT_CURRENT_TARGET` | [Not authoritative](#change-set-not-found-or-not-authoritative) |
| Apply worked, `git status` shows staged files | — | [Apply leaves staged changes](#apply-leaves-staged-changes) |
| CODER refuses right after a successful apply | `CODER_STAGING_WORKTREE_DIRTY` | [CODER after apply](#coder-refuses-after-i-applied) |
| REVIEWER will not run | `REVIEW_TARGET_*` | [REVIEWER refuses](#reviewer-refuses-to-run) |
| Apply was interrupted | `CHANGE_SET_APPLY_RECOVERY_REQUIRED` | [Interrupted apply](#interrupted-apply) |
| Cannot complete the task | `TASK_HAS_PENDING_CHANGE_SET` | [Completion blocked](#completion-blocked) |

## CODER ran but my source did not change

**This is expected, and it is the whole design.** It is the most common first-time surprise.

```text
CODER edits an isolated Git clone
  → Synaphex captures a durable change set
  → your source tree is untouched
```

CODER never writes to your working tree — not even on success. What you get back is a **reviewable proposal**.

**Safe next step.** Read the proposal, then decide:

1. `synaphex_get_change_set` — metadata: base commit, changed files, state.
2. `synaphex_read_change_set_patch` — the patch itself, in bounded slices; advance `offset` until you have read it all.
3. `synaphex_apply_change_set` or `synaphex_reject_change_set` — your explicit decision.

Nothing touches your source until you apply.

**Related.** [Change-set workflow](../workflows/coder-change-sets.md), [CODER isolation](../security/coder-isolation.md).

## Dirty worktree

**Symptom.** `CODER_STAGING_WORKTREE_DIRTY` — "CODER requires a clean source worktree; commit or set aside local changes first."

**Likely cause.** Uncommitted state of any kind: unstaged edits, staged edits, or untracked files.

**How to confirm.**

```bash
git status --short
```

**Why.** CODER stages from an exact committed baseline. If your own uncommitted work were present, the captured diff could not be attributed cleanly to the agent, and applying it later could silently entangle your changes with the proposal.

**Safe next step.** Decide how **you** want to handle that work before invoking CODER — commit it, stash it, or move it aside. That is your call and depends on your own Git habits; Synaphex deliberately does not choose for you.

**What not to do.** Don't reach for a destructive cleanup to get past the check. The refusal is protecting uncommitted work that nothing else is tracking.

## Not a Git repository

**Symptom.** `CODER_STAGING_REQUIRES_GIT` — "CODER requires the project source workspace to be a Git worktree."

**Likely cause.** The registered project path is not inside a Git worktree.

**Safe next step.** Initialize a repository and commit a baseline, or re-register the project at the path that actually contains the repository.

> Git is required for **CODER and change sets only**. Projects, tasks, sessions, rules, memory, plans, and the read-only agents all work without it.

## Unsupported repository shape

**Symptom.** `CODER_STAGING_UNSUPPORTED_REPOSITORY` — "CODER cannot safely stage this repository, or the produced changes were unsafe."

Three distinct conditions produce this, and they need different responses:

| Condition | What it means | Safe next step |
| --- | --- | --- |
| `detached_or_unborn_head` | No commit to anchor to — a fresh repository with no commits, or a detached HEAD with no resolvable commit | Commit a baseline, or check out a branch at a real commit |
| `submodule_gitlink` | The index contains a submodule | Not supported in v0.1 — CODER cannot run against this repository |
| `unsafe_symlink` | A tracked symlink points outside the repository | Only *escaping* symlinks are refused; adjust or remove that specific link |

**Why.** Each breaks the exact-baseline guarantee. Without a commit there is no deterministic baseline to capture or apply against. Submodules can require external repositories and network access, and introduce a second source-authority boundary. A symlink escaping the repository would let staged changes reach files outside the project.

> Ordinary symlinks **inside** the repository are fine. Only ones whose target escapes it are refused.

## Pending plan draft

**Symptom.** CODER fails with `PLAN_DRAFT_PENDING`.

**Likely cause.** A plan draft exists and has not been explicitly accepted or rejected. This gate applies to **CODER specifically** — other agents are unaffected.

**Safe next step.**

1. `synaphex_get_plan_state` with your `sessionId` — shows whether a draft is pending and its current `draftRevisionId`.
2. Read the draft.
3. `synaphex_accept_plan_draft` or `synaphex_reject_plan_draft`, passing that exact `draftRevisionId`.

**What not to do.** Don't re-run CODER hoping it clears. The gate stays until the draft is explicitly decided.

## "I said looks good, but CODER is still blocked"

**Cause.** Telling an agent the plan looks good is **not** plan acceptance. Approval is an explicit tool call, and nothing else counts.

**Why it works this way.** Acceptance is bound to an exact `draftRevisionId`. If the draft changed after you read it, accepting the old revision fails with `PLAN_DRAFT_REVISION_MISMATCH` rather than approving text you never saw. Conversational approval carries no revision, so it cannot offer that protection.

**Safe next step.** Call `synaphex_get_plan_state`, read the current draft, then `synaphex_accept_plan_draft` with the `draftRevisionId` it reports.

**Related.** [Plans](../concepts/plans.md), [planning and coding](../workflows/planning-and-coding.md).

## Change set not found or not authoritative

**Symptom.** `CHANGE_SET_NOT_FOUND`, `CHANGE_SET_NOT_CURRENT_TARGET`, or `CHANGE_SET_NOT_AUTHORIZED`.

**Likely cause.** The id is stale, belongs to a different session's authority, or has been superseded by a newer CODER run.

> **A directory on disk is not authority.** A change-set folder under `changes/` existing does not make it applicable. Authority comes from being the **latest authoritative CODER target** for the task, plus current task ownership. That is why a newer CODER run makes an older change set undecidable.

**Safe next step.** Inspect current state through MCP rather than the filesystem — `synaphex_get_change_set` for the id you believe is current. Decide on the current target.

**What not to do.** Don't try to force an orphaned change set through by copying files or reusing an old id.

## Apply refuses because the source changed

**Symptom.** `CHANGE_SET_SOURCE_HEAD_CHANGED`, `CHANGE_SET_SOURCE_DIRTY`, or `CHANGE_SET_APPLY_CHECK_FAILED`.

**Likely cause.** Your source no longer matches the baseline the change set was captured against.

| Code | Meaning |
| --- | --- |
| `CHANGE_SET_SOURCE_HEAD_CHANGED` | HEAD moved off the recorded base commit |
| `CHANGE_SET_SOURCE_DIRTY` | The worktree is not clean |
| `CHANGE_SET_APPLY_CHECK_FAILED` | The patch does not apply to the current state |

**Why.** Apply is **exact-baseline**. Synaphex does not three-way merge, rebase, or auto-resolve. A patch produced against one baseline is not silently reinterpreted against a different one.

**Safe next step.** Inspect your Git state (`git status`, `git log --oneline -3`) and decide how you want to reconcile your own history. Once you have, run a fresh CODER cycle against the current HEAD — that produces a change set whose baseline actually matches.

**What not to do.** Don't look for a way to bypass the baseline check. The check is what makes an applied change set mean exactly what you reviewed.

## Apply leaves staged changes

**Symptom.** Apply succeeded, and `git status` shows staged modifications.

**Expected v0.x behavior.** Apply brings your index and worktree to the captured result:

```text
apply → index == captured result → worktree == index → changes staged
```

**No commit. No push.** Synaphex stages the result and stops, leaving the commit message, the history shape, and whether to commit at all entirely to you.

This is not an incomplete apply. Review the staged changes and commit them when you are satisfied.

## CODER refuses after I applied

**Symptom.** Apply succeeded; the next CODER invocation fails with `CODER_STAGING_WORKTREE_DIRTY`.

**Cause.** Two correct behaviors meeting: apply intentionally leaves changes staged, and CODER intentionally requires a clean worktree. This is a known v0.x workflow limitation.

**Safe next step.** Decide what should happen to the applied changes before running CODER again — record them in Git, set them aside, or otherwise reconcile them. Once the worktree is clean, CODER proceeds normally.

**What not to do.** Don't discard the applied work reflexively — it is the change set you just chose to accept.

## Reject behavior

Rejecting is **terminal for that change set**:

- The decision cannot be reversed — `CHANGE_SET_ALREADY_DECIDED` on a second attempt.
- Your source stays unchanged.
- The patch and its metadata remain recorded for history.
- **Rejection does not re-run CODER.** If you want a different implementation, start a new CODER cycle with better instruction.

## REVIEWER refuses to run

REVIEWER reviews **applied** work, so its refusals describe the target's state.

| Code | Meaning | Safe next step |
| --- | --- | --- |
| `REVIEW_TARGET_NOT_AVAILABLE` | No CODER work record exists | Run CODER first |
| `REVIEW_TARGET_NOT_APPLIED` | The target is still pending | Inspect the patch, then apply or reject it |
| `REVIEW_TARGET_REJECTED` | The target was rejected | Run a new CODER cycle |
| `REVIEW_TARGET_APPLY_INTERRUPTED` | Its apply was interrupted | Work through [interrupted apply](#interrupted-apply) first |
| `REVIEW_TARGET_CHANGED` | The source moved after apply | Inspect Git state and re-establish a coherent target |

**What not to do.** Don't look for a way to review around these states. REVIEWER refusing means it cannot see the exact thing it is supposed to judge; a review of ambiguous state would be worse than no review.

## Interrupted apply

**Symptom.** Operations fail with `CHANGE_SET_APPLY_RECOVERY_REQUIRED`, or a change set is in `applying_interrupted`.

**Cause.** Synaphex recorded its intent to apply, then was interrupted before it could confirm the outcome. Because the intent is written *before* the source is touched, the situation is always detectable.

**Do not start repairing Git by hand.** First ask Synaphex what it can actually prove about your source:

```json
{ "sessionId": "ses_example", "changeSetId": "changeset_example" }
```

via `synaphex_get_apply_recovery_state`.

### Recovery decision table

| Observation | Meaning | Safe action |
| --- | --- | --- |
| `base_clean` | The original baseline is exactly present — the apply did not land | `synaphex_reconcile_interrupted_apply` → back to `pending` |
| `exact_applied` | The intended result is exactly present — the apply did land | `synaphex_reconcile_interrupted_apply` → recorded as `applied` |
| `divergent` | Neither state is provable | **Synaphex will not mutate anything.** Investigate yourself |

For `divergent`, Synaphex fails closed and makes no automatic change. Inspect your repository, decide what the correct state is, and reconcile it yourself according to your own Git and data policy.

> **Synaphex never runs `git reset --hard` or `git clean` on your behalf**, in any of these states. The client does not choose a recovery action either — the observed source state determines what reconciliation is allowed.

**Related.** [Interrupted-apply recovery](../workflows/interrupted-apply-recovery.md).

## "There is one extra untracked file — why is it divergent?"

Because the positive classifications mean **exactly**, not approximately.

`base_clean` and `exact_applied` each require **all four** of:

```text
HEAD matches the recorded base commit
the index matches the expected tree
no unstaged changes
no untracked files
```

A single untracked file fails the fourth condition, so neither positive state can be proven and the observation is `divergent`. That is deliberate: "mostly matches" is not a state Synaphex is willing to act on automatically, because acting on a near-match is how work gets silently destroyed.

If the extra file is genuinely unrelated, move it aside and observe again — the classification is recomputed each time.

## Completion blocked

**Symptom.** `synaphex_complete_task` fails.

| Code | Cause | Safe next step |
| --- | --- | --- |
| `PLAN_DRAFT_PENDING` | An undecided plan draft exists | Accept or reject the draft |
| `TASK_HAS_PENDING_CHANGE_SET` | The latest change set is `pending` or `applying_interrupted` | Apply, reject, or reconcile it |
| `INVALID_TASK_TRANSITION` | The task is not in a completable state | Check its current state |

Completion is allowed once the latest change set is `applied` or `rejected` — or if there is no change set at all.

> **A REVIEWER pass is not required to complete a task.** Review is a step you choose to run, not a gate Synaphex enforces.

**Related.** [Review, complete, archive](../workflows/review-complete-archive.md).

## Sharing diagnostics safely

Change-set ids and error codes are safe to share. Patches often contain your source — review before posting one. Avoid tokens, full environment dumps, `~/.synaphex` artifacts, and personal absolute paths where a placeholder would do.
