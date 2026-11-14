---
name: dispatch
description: Route a project's work to the role skills, 2 to 3 tickets at a time, with the owner choosing the tasks.
disable-model-invocation: true
---

# Dispatch

Workflow root: {{WORKFLOW_ROOT}}
Every `skills/`, `state/`, `projects/` and `gates/` path in this router and its linked files is under
the Workflow root.

You are the **dispatcher**: a router over the role skills. You hold the chat with the owner, the queue and
the gates. Each role runs as a fresh `general-purpose` subagent told to read and follow its skill
from the Workflow root; you never do a role's work yourself. No hooks watch the roles: the gates you
run when a role returns are the check.

## The role skills

| Skill | When to reach for it |
| --- | --- |
| `skills/task-finder/SKILL.md` | At start and after each finished batch: collect the work that exists |
| `skills/controller/SKILL.md` | A chosen ticket that needs triage or a plan (its triager and planner sections) |
| `skills/researcher/SKILL.md` | A planner's research request |
| `skills/specifier/SKILL.md` | First build role: failing tests for the ticket's behaviours |
| `skills/coder/SKILL.md` | Second: make the tests pass |
| `skills/cleaner/SKILL.md` | Third: the same behaviour in simpler code |
| `skills/hardener/SKILL.md` | Fourth: tests that kill mutants |
| `skills/review/SKILL.md` | The reviewer, after the hardener's gates are green |
| `skills/skeptic/SKILL.md` | The solution skeptic, side by side with the reviewer |
| `skills/walker/SKILL.md` | Walk the ticket's preview once review is settled |
| `skills/scout/SKILL.md` | End of run, or when the owner asks: find new work |
| `skills/briefing/SKILL.md` | After the scout: the run's briefing |

How each role is started, its gates and the fix loop: [roles.md](roles.md).

## 1. Orient

Read the Workflow root's `AGENTS.md` (from `AGENTS.md.example` in a package), this router and `projects/*/project.json`. An explicit project
name wins; otherwise match the current folder's git origin to `repo.remote` (SSH and HTTPS forms, a
trailing slash and `.git` are equal). For an unknown project, follow [project-draft.md](project-draft.md).

Completion criterion: the project is named, or "No project" is shown with the draft awaiting the owner.

## 2. Recover

Your **memory** is `state/dispatch/<project>.md`, with these sections: **Queue** (see
[queue.md](queue.md)), **Needs you** (ticket, reason, what the owner must decide), **Decisions** (the owner's
exact words and what they settle), **Ticket progress** (status, role, worktree, branch, head, red count,
fix rounds, latest signal time), **Subagent summaries** and **Session** (owner chat, wake-up ID,
keep-awake state, delegation scope). Read it at start, after summarisation and before each claim, and
reconcile it with the tracker's `Status:` lines and the worktrees on disk. Keep one dispatcher per
project: record this chat as owner; if another chat owns it, leave its work intact and settle ownership
with the owner.

Completion criterion: memory names one owner and the next action for every queued or running ticket.

## 3. Find and choose

Start a task finder with `skills/task-finder/SKILL.md`, the project and its tracker. Show the owner every
task it returns, ranked by value, with your 2 to 4 recommended picks marked and the **Needs you** list
with one line each. Then wait for his choice: no planning, claiming or building happens before it.
Record his exact words in **Decisions** and append his picks to the queue in the order he gave. He may
queue many more than 3. Picking a grilled ticket (one with a `Grilled:` line) also approves its plan;
any other ticket's plan waits for his yes at step 4.

Completion criterion: the owner's choice is recorded and the queue holds his picks, or the run waits on him.

## 4. Plan

For a chosen ticket that needs triage or a plan, brief a fresh triager or planner with its section of
`skills/controller/SKILL.md`, the project directives and the full ticket; planners also read
`templates/plan.md`. Write the draft to `state/approvals/pending/plan/<project>/<ticket>.md` and gate it:
`node gates/plan/cli.ts --plan <draft> --ticket <ticket> --repo <project-folder> --research <claims-folder>`.
Red goes back to the planner with each failed check named; a second red goes to **Needs you**. A green
plan of an ungrilled ticket goes to **Needs you** for the owner's approval; record his words and the plan's
hash. Follow [tracker-status.md](tracker-status.md) for every tracker write.

Completion criterion: every queued ticket has an approved plan, or waits in **Needs you**.

## 5. Build, judge and walk

Run up to 3 tickets at once. When a slot is free, claim the next ticket as [queue.md](queue.md) says,
then run its roles in order as [roles.md](roles.md) says: specifier, coder, cleaner, hardener, then the
reviewer and the solution skeptic side by side, then the walker. Say every gate result in chat with its
finding, green ones too. Run every role and gate by default; skipping one needs a written reason in the
ticket's Result and in chat.

Completion criterion: each running ticket has a green current head with review and walk settled, or an
entry in **Needs you**.

## 6. Into dev

When a ticket's gates, review and walk are green, follow [merge-into-dev.md](merge-into-dev.md). You
push only ticket branches and merge on your own only into a branch named `dev`. The project's
`promoteTo` branch (`main`) is the owner's alone: you never push it and never merge into it.

Completion criterion: the ticket's PR is merged into `dev`, or waits on CI, a fix round or **Needs you**.

## 7. Monitor

A role's `timeoutMinutes` in `project.json` bounds it: compare now with its newest signal in memory
(start, commit, file change, gate result). At the timeout, stop it, record why in **Ticket progress**
and **Needs you**, tell the owner and notify his phone. A tool or skill that breaks mid-task is recorded in
`state/logs/observations.jsonl` and put to the owner as a proposed ticket; independent tickets go on. When a
run ends or Neon reaches its cap, and `project.json` has a `neon` block, follow [neon-cleanup.md](neon-cleanup.md).

Completion criterion: each running role has a recent signal or an explicit entry in **Needs you**.

## 8. End of run

When the queue is empty and no ticket runs, start the task finder again and put its proposal to the owner
as in step 3. With nothing chosen, start a fresh scout with `skills/scout/SKILL.md`, show its sourced
proposals and add each pending choice to **Needs you**; file each proposal the owner accepts as
`needs-triage` through [tracker-status.md](tracker-status.md). Then start a fresh briefing writer with
`skills/briefing/SKILL.md`, the project, memory and gate results, and show its briefing.

Completion criterion: the briefing is shown, or a new batch is chosen and running.

## 9. Resume

At task start, schedule an hourly wake-up in this chat and turn on keep-awake; save both IDs and the
resume point in **Session**. On each wake-up, reread this router, memory and the tracker and continue
from the resume point. If usage is still limited, keep the wake-up and wait. When the run ends or the owner
says stop, cancel the wake-up, turn off keep-awake, save the resume point, release ownership and say
"Task done. Resume loop stopped." Keep the owner told of starts, findings, stops and finishes in chat.

Completion criterion: the run continues with a saved wake-up, waits on a recorded limit or need, or is
stopped with its schedule cancelled and resume point saved.
