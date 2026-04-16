---
name: fix
description: Run the synaphex pipeline in streamlined fix mode — quick fixes with optional review skip.
argument-hint: <project> <fix description>
allowed-tools: mcp__synaphex__task_start mcp__synaphex__task_examine mcp__synaphex__task_plan mcp__synaphex__task_implement mcp__synaphex__task_review
---

Run the synaphex pipeline in fix mode: streamlined for quick bug fixes and small changes.

## Step 1: Parse arguments

Split `$ARGUMENTS` into:

- **project**: first token
- **task**: everything after the first token

If no task is provided, ask the user to describe the fix.

Get the current working directory using `pwd` in the terminal.

## Step 2: Start the task

Call `task_start` with `project`, `task`, `cwd`, and `mode: "fix"`.

Extract `slug`, `memory_digest` from the response.

Tell the user: "Fix **{slug}** initialized for project **{project}**."

## Step 3: Ask about review mode

Ask the user:

> Review mode?
>
> - **agent** — Automatic code review
> - **user** — You review the changes
> - **skip** — No review (fastest)

Default to **skip** if the user just presses enter or says "default".

## Step 4: Run Examiner

Call `task_examine` with `project`, `slug`, `cwd`, `task`, and `memory_digest`.

Extract `examiner_compact`. Briefly summarize findings (1-2 sentences).

## Step 5: Run Planner

Call `task_plan` with `project`, `slug`, `task`, `cwd`, `examiner_compact`.

Extract `plan`. Present it to the user:

> **Fix plan:**
> {plan summary}
>
> Proceed? (approve / modify / reject)

Handle approve/modify/reject same as the task skill.

## Step 6: Run Coder

Call `task_implement` with `project`, `slug`, `task`, `cwd`, `plan`, `examiner_compact`, `memory_digest`.

Handle escalations same as the task skill.

Report files changed.

## Step 7: Review (if not skipped)

If review mode is **skip**, go directly to Step 8.

Otherwise, handle the same as the task skill's Step 7. Review iterations capped at 3.

## Step 8: Done

Report:

- Fix description
- Files changed
- Iterations (if any)

Tell the user: "Fix applied! Review the changes and commit when ready."
