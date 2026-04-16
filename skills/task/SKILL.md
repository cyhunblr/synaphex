---
name: task
description: Run the synaphex 6-agent pipeline to implement a task in a project.
argument-hint: <project> <task description>
allowed-tools: mcp__synaphex__task mcp__synaphex__examine mcp__synaphex__plan mcp__synaphex__implement mcp__synaphex__review
---

Run the full synaphex agent pipeline: Examiner → Planner → Coder → Reviewer.

## Step 1: Parse arguments

Split `$ARGUMENTS` into:

- **project**: first token
- **task**: everything after the first token

If no task is provided, ask the user to describe the task.

Get the current working directory using `pwd` in the terminal — this is the CWD that all agents will operate on.

## Step 2: Start the task

Call `task_start` with `project`, `task`, `cwd`, and `mode: "task"`.

Extract from the response:

- `slug` (from `<task_meta>`)
- `memory_digest` (from `<memory_digest>`)
- Brief settings summary

Tell the user: "Task **{slug}** initialized for project **{project}**."

## Step 3: Ask about review mode

Ask the user:

> How should code review be handled?
>
> - **agent** — Reviewer agent checks the code automatically
> - **user** — You review the code yourself after implementation
> - **ask** — Reviewer agent reviews, then asks you to confirm

Default to **agent** if the user just presses enter or says "default".

## Step 4: Run Examiner

Call `task_examine` with `project`, `slug`, `cwd`, `task`, and `memory_digest`.

Extract `examiner_compact` from the `<examiner_compact>` tag in the response.

Briefly summarize what the Examiner found (2-3 sentences).

## Step 5: Run Planner

Call `task_plan` with `project`, `slug`, `task`, `cwd`, `examiner_compact`, and optionally `reviewer_feedback` and `iteration`.

Extract `plan` from the `<plan>` tag in the response.

Present the plan to the user and ask:

> Do you want to:
>
> - **approve** — Proceed with implementation
> - **modify** — Give feedback to adjust the plan
> - **reject** — Cancel the task

If **modify**: ask for feedback, then call `task_plan` again with the feedback as `reviewer_feedback` and increment `iteration`. Present the new plan.

If **reject**: tell the user the task is cancelled and stop.

## Step 6: Run Coder

Call `task_implement` with `project`, `slug`, `task`, `cwd`, `plan`, `examiner_compact`, `memory_digest`, and `iteration`.

Check the response for:

- `<escalation>` tag — if present, show the user the question and context. Get their answer, then call `task_implement` again with the user's answer appended to the plan.
- `<implementation_summary>` tag — extract the summary.

Report to the user: files created/modified and a brief summary of what was done.

## Step 7: Run Review

Based on the review mode chosen in Step 3:

### If "agent" or "ask"

Call `task_review` with `project`, `slug`, `task`, `cwd`, `plan`, `implementation_summary`, `examiner_compact`, and `iteration`.

Check the `<review>` tag for the verdict:

- **APPROVED**: Tell the user the review passed. If mode is "ask", show the review and ask the user to confirm.
- **NEEDS_CHANGES**: Extract `<feedback_for_planner>`. If iteration < 3, tell the user and loop back to Step 5 with the feedback. If iteration >= 3, present all feedback to the user and stop.

### If "user"

Present the implementation summary and list of changed files. Ask the user to review. If they approve, mark done. If they want changes, collect feedback and loop back to Step 5.

### If "skip" (fix mode only)

Skip review entirely.

## Step 8: Done

Report final summary:

- Task description
- Files created/modified
- Number of iterations
- Total token usage (if available)

Tell the user: "Task complete! Review the changes and commit when ready."
