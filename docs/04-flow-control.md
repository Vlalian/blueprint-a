# Flow control, state and logs

The dispatch router owns flow control as instructions and project memory. Gates judge code;
there is no script dispatcher, stop hook, verdict ledger or automatic metrics recorder.
`skills/dispatch/SKILL.md` and its linked files define the current flow.

## Limits

| Setting | Rule | At the limit |
| --- | --- | --- |
| Tickets in flight | Up to 3, across model families | The next ticket waits for a slot |
| Local gate | One at a time | Other tickets wait |
| Role gate failures | First red retries the same role fresh | Second red stops the ticket in Needs you |
| Review fix rounds | At most 2 | Remaining findings go to Needs you |
| Role timeout | Project's `timeoutMinutes`, measured from newest signal | Stop the role, record why and notify the owner |
| Usage limit | Save the resume point and wake-up | Resume after reset; do not claim completion |

A role's newest signal is its start, commit, file change or gate result. The router monitors
those timestamps in memory. These are agent responsibilities, not enforcement by deleted hooks.
A broken skill or tool is recorded and proposed to the owner as a ticket; independent work goes on.

## State

`state/dispatch/<project>.md` contains Queue, Needs you, Decisions, Ticket progress, Subagent
summaries and Session. Queue lines carry ticket, state, worktree and builder family. States are
`queued`, `claimed`, `building`, `judging`, `walking`, `merging`, `done`; `needs-you` removes a
ticket from the running set until the owner settles it. Claim only the next unclaimed queued
ticket whose dependencies are done. Reread memory and record the claim before starting a role.

Keep one dispatcher owner per project. Recover memory against tracker Status lines and worktrees
at start and after summarisation. Do not use a process lock or a folder move as the queue.
Session records ownership, wake-up ID, keep-awake state, delegation scope and resume point.
Cancel scheduling and release ownership when the run ends or the owner stops it.

## Evidence and isolation

Each ticket has its own branch and worktree; roles on that ticket run in order. Every gate,
judge and walk result names its head. A later edit or base merge makes it stale. Re-run the
consolidated checks and judges and obtain fresh walk evidence before integration.

Decisions record the owner's words and their scope. Progress records heads, role results,
red counts and fix rounds; the ticket Result records outcomes and written reasons for skips.
The briefing reads those records and reports pending choices. The router records tool failures
in `state/logs/observations.jsonl`; there is no per-tool hook or cost and metrics pipeline.
