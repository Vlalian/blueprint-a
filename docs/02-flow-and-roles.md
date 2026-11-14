# Flow and roles

The flow is a router skill, `skills/dispatch/SKILL.md`, dispatching fresh role subagents. The
router holds the conversation with the owner, the queue and the gates. It reads each role's
skill and gives the subagent the full ticket, approved plan, project directives, worktree,
commands, editable paths and previous summaries. Gates remain executable code, run by the router
when a role returns. No agent hooks or `flow/` scripts orchestrate this release.

## Choose and plan

The task finder collects existing work and ranks it. The owner chooses the tasks; the router
records the exact choice before planning or claiming. The controller skill provides triager and
planner sections. Research questions go to the researcher. Plans pass `gates/plan` and wait for
owner approval unless choosing a grilled ticket already approved its plan.

## Build and check

| Role skill | Work | Gates after it returns |
| --- | --- | --- |
| specifier | Failing tests for the ticket's behaviours | Red check against the base |
| coder | Make those tests pass | Four checks, test deletion, debug leftovers |
| cleaner | Simplify without changing behaviour | Coder checks, duplication, import boundaries |
| hardener | Strengthen tests and kill mutants | Coder checks, onkel; security scans on the finished build |

The project's `roles.<role>.checks` commands are what actually run. A missing gate command is a
configuration gap for the owner, never a silent skip. The router reports every result, green
ones too. A first red returns to a fresh instance of the same role with the output and earlier
summary; a second red stops that ticket and adds it to **Needs you**.

## Judge, walk and integrate

After a consolidated run of every distinct role check on the finished head, two fresh judges
from the family that did not build run side by side: the reviewer checks Standards and Spec;
the skeptic designs its own solution first, then compares. Every review finding is fixed,
declined with a concrete reason, or escalated. A skeptic verdict that the change does not solve
the ticket starts a fix round. A better design becomes an owner's choice without blocking the
otherwise green ticket. At most two fix rounds run.

The walker checks the preview against each acceptance criterion and QA entry. The walk report
gate binds its report and evidence to the head and patch-id. A project without a preview-visible
behaviour records why the walk is skipped. Any head change makes earlier checks, judgments and
walk evidence stale; the consolidated checks, judges and walk run again.

The router pushes ticket branches only. It may merge green tickets into `dev` after CI passes
on the exact head. Other integration branches require the owner's choice. Promotion to `main`
is the owner's action. After a merge, update every open branch no role is writing to; record a
pending update for active branches and start a fix round for conflicts.

## End and resume

The scout proposes new work with sources; the briefing skill explains results and choices.
The router saves queue, decisions, progress and subagent summaries in project memory so a fresh
session can recover. See [04-flow-control.md](04-flow-control.md) and the router's linked files
for the precise state transitions and limits.

## Using the package at work

The whole router and role folders, including evals, are shipped as Claude Code skills. Set
`{{WORKFLOW_ROOT}}` to the installed package root and supply project configuration, directives
and tracker access. The reference project configuration and private state are not exported.
Mapping subagents, commands, scheduling and keep-awake to the work harness is work to do at work.
The gates run independently of that harness. The retired script flow is available in v0.9.0;
ticket 95's archive records explain what was deleted.
