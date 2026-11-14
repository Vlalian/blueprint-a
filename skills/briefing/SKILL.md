---
name: briefing
description: Write a project briefing when a dispatcher run ends or the owner requests one.
disable-model-invocation: true
---

# Briefing

## 1. Reconcile

Read `state/dispatch/<project>.md` and `projects/<project>/project.json` from the Workflow root
supplied by the dispatcher. Every `state/`, `projects/` and `gates/` path here is under that root.
Read the configured tracker in full for the run's tickets, including Status lines and comments.
For GitHub tickets use `gh issue view <number> --repo <owner/repo> --comments`.
Read the gates' own pass/fail result lines from the run's gate output or saved reports named in
memory and ticket Results. Match each result to its ticket, revision and run; request missing
output from the dispatcher. Mark stale, conflicting or unavailable evidence explicitly.

Completion criterion: every reported ticket and gate outcome has current evidence or a named gap.

## 2. Brief

Write the **briefing** into the dispatcher chat, with **Needs you** first: each unresolved choice,
its ticket, reason, plan/source link and the action the owner needs to take. Say "None" when empty.
Follow with completed work, work in progress, gate failures or blockers, scout proposals and the
next action, using the reconciled evidence.

Every number names the file (with section or result line) or exact command output it came from.
For a derived number, give the calculation and inputs. Check pagination, limits, time window,
ticket selection and revision before treating a count as a total. Label partial coverage and
unknowns; report a gate as green only from its own matching result line.

Completion criterion: the chat briefing starts with Needs you and every number is traceable.

## 3. Close

End with the **closing summary**: what you did, what went wrong and how well it went.
Name evidence gaps and reconciliation conflicts for the dispatcher to add to memory.

Completion criterion: the dispatcher has the chat briefing and closing summary.
