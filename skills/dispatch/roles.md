# Roles, gates and fix rounds

## Starting a role

Every role is a fresh subagent with the whole scope in its brief: the role skill's path
(`<Workflow root>/skills/<skill>/SKILL.md`) and "read it in full and follow it", the full ticket, the
approved plan, the owner's later instructions, the project directives, the ticket's absolute worktree path,
the role's `editablePaths`, `testPaths` and `commands` from `project.json`, and the earlier roles'
summaries. Tell it to use absolute paths or `git -C <worktree>` (shell `cd` does not persist), to leave
committing to you, and to end with a summary of what it did, what went wrong and how well it went.

- **Claude builder:** an `Agent` call with `subagent_type: general-purpose` and the role's model from
  `roles.<role>.model`.
- **Codex builder:** `codex exec --sandbox workspace-write --model <model>` run from the ticket's
  worktree, with the same brief on stdin.

A ticket's build roles run in order in its one worktree; tickets run in parallel in their own.
Run Neon cleanup only when `project.json` has a `neon` block.

## Gates

When a role returns, run its gates yourself: every command under `roles.<role>.checks` in the project's
`project.json`, from the ticket's worktree, with `{WORKFLOW}` as the quoted Workflow root, `{BASE}` as
the ticket's base commit and `{PLAN}` as the approved plan's path. Exit 0 is green; any other exit,
a missing command or a crash is red. Say each result in chat.

| Role | Gates (the Blueprint A flow doc) |
| --- | --- |
| specifier | red check: every new test fails on the base |
| coder | the four checks (lint, typecheck, tests with skipped tests red, build), test deletion, debug leftovers |
| cleaner | the coder's gates, duplication, import boundaries |
| hardener | the coder's gates, onkel (a .NET or Python project: the test-strength CRAP and mutation checks, `--runner dotnet` or `--runner python`); on the finished build also SAST (Semgrep; bandit for Python), secret scan, hidden Unicode, supply chain (pip-audit for Python) |

The table is what Blueprint A asks for; `project.json` is what runs. A gate the table names that the
project's `checks` lack goes to **Needs you** as a config gap, never skipped in silence.

Green: commit the role's changes on the ticket branch (stage by path), record the head in
**Ticket progress**, start the next role.

## The consolidated check and head changes

Every gate result, judge verdict and walk is evidence for one head. While the build roles run, each
role's gates judge that role's own commit. When the hardener's gates are green, run the **consolidated
check** on that head: every role's gates from `project.json`, each command once. Its red follows the
rules below for the role whose gate failed. The judges start only on a green consolidated check.

Whenever the head changes after that (a fix round, a merge of the integration branch into it), record
the new head, mark all earlier evidence **stale**, and run the consolidated check again, then both
judges and the walk. Stale evidence never counts as green.

## Red

- **First red:** send the same role, fresh, the red gate's name and output, plus its own closing summary
  of why it thinks the gate failed. It fixes and returns; run its gates again.
- **Second red** of that role on this ticket: stop the ticket, add it to **Needs you** with both gate
  outputs, write them in the ticket's Result, tell the owner and free the slot.

## Judges

When the consolidated check is green, start two judges side by side, both from the family that did not
build the ticket (a Claude build gets Codex judges, `codex exec --sandbox read-only`; a Codex build gets
Claude `general-purpose` subagents). A ticket both families edited gets judges from each family for
the other's part. Each gets the ticket, the plan, the base commit and the worktree. The reviewer also
gets the diff against the base; the solution skeptic does not, because it writes its own design
before it reads the diff itself.

- **Reviewer** (`skills/review/SKILL.md`): findings on Standards and Spec. Triage each finding into
  **fix**, **decline** with a concrete reason, or **escalate** to **Needs you**, and record every one.
- **Solution skeptic** (`skills/skeptic/SKILL.md`): writes its own solution first, then compares.
  - "does not solve the ticket": start a fix round.
  - "a better design exists": add it to **Needs you** as the owner's choice; the ticket goes on through the
    walk and into dev without waiting for his answer. If he takes the design, it becomes a new ticket.
  - "solves it": nothing to do.

A **fix round** sends the findings to the owning build role (the coder for code, the hardener for
tests), then runs the consolidated check, both judges and the walk on the new head. At most 2 fix rounds; what
is still open after the second goes to **Needs you**.

## Walk

When the judges are settled, resolve the head's preview URL from `walk.previewUrl` and refuse it if it
matches a `walk.productionDomains` entry. Start a fresh walker with `skills/walker/SKILL.md`, the
preview, every acceptance criterion, the QA entries, the seeded account names, the head and its patch-id.
Check its report with the walk gate, which refuses a failed item, a report bound to another head and a
missing criterion:
`node "<Workflow root>/gates/walk/cli.ts" --report <report> --head <sha> --patch-id <id> --repo <worktree>`
with one `--criterion <id>` per acceptance criterion and `--qa <id>` or `--not-run <id>` per QA entry.
A failed walk starts a fix round; a new head needs a new walk. A project with no `walk` block, or a diff with no behaviour a
preview shows, skips the walk with its reason in Result and chat.
