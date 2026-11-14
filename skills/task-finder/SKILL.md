---
name: task-finder
description: Collect a project's existing work and sort it into buildable tasks and needs-you, for the dispatcher's Choose step.
disable-model-invocation: true
---

# Task finder

You collect work that already exists in one project and sort it for the owner's choice. You are read-only:
you never edit a file, change a `Status:` line or run code. You do not analyse the code for new work;
finding new work is the scout's job. The dispatcher gives you the Workflow root, the project name and
its tracker path. Every `state/`, `projects/` and `skills/` path here is under the Workflow root.

## 1. Collect

Read `projects/<project>/project.json` (its `tracker`, `tickets` and selection keys) and
`state/dispatch/<project>.md` when it exists. Gather a **task** from each source:

- **Tracker issues:** every ticket or issue file under the tracker whose `Status:` is not `done`,
  `wontfix` or `closed`. Match the leading token only (`done (2026-07-15) ...` is `done`).
- **Grill needed:** tickets marked as needing a grill: `Label: wayfinder:grilling`, `Status:
  needs-triage` or `needs-info`, or a workflow ticket whose `Status:` is `proposed`.
- **Map gaps:** functionality a `MAP.md` or `PRD.md` lists as missing or not yet built, that no issue
  covers yet.
- **Scout proposals:** proposals in the memory file's **Needs you** that the owner has not decided.

Record each task's source path and line. A task that two sources name is one task with both sources.

Completion criterion: every source above is read, or named as missing, and every task has its source.

## 2. Filter

Sort each task into **buildable** or **needs you**, using the project's run-afk rubric
(`<project repo>/.claude/skills/run-afk/AFK-SAFETY.md`) when it exists. Its four gates, in short:

1. **Label:** only buildable work (`wayfinder:task`) clears it; a grill, a map or a decision does not.
2. **Blockers:** every `Blocked by` or `Depends on` ticket is `done`, followed through the whole chain.
3. **Human gates:** no step only the owner can do: a signup, a credential, money, an open decision, an
   expert answer, a real-world act. Read for it; a missing `HITL:` marker proves nothing.
4. **Testable:** the acceptance criteria (or Pass when lines) yield a behaviour list.

A workflow ticket (this Workflow repo) is buildable only when its `Agreed:` line quotes the owner choosing
it (AGENTS.md rule 1). Grill-needed tasks and map gaps are always needs-you: they need the owner in a
conversation. When in doubt, the task is needs-you: a wrongly queued task stalls a night, a wrongly
deferred one costs the owner one line to read.

Completion criterion: every task is buildable or needs-you, and each needs-you task has a one-line
reason naming the gate it failed.

## 3. Rank and report

Rank the buildable tasks by **value**: what it unblocks (a cork that frees a chain ranks first), then
what the owner or the user gains, then size (smaller first on a tie). Mark the top 2 to 4 as recommended.
When nothing is buildable, name the cork: the one decision or act that unblocks the most work.

Return exactly this shape:

```markdown
## Buildable (ranked)
1. [recommended] <ticket> | <one line: what it does and why it ranks here> | <source>
2. ...

## Needs you
- <ticket or task> | <gate failed>: <one line reason> | <source>

## Cork
<one line, or "none">

## Closing summary
<what you did, what went wrong, how well it went; sources read and any source missing>
```

Completion criterion: every task found in step 1 appears exactly once in the report.
