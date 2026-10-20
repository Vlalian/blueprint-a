# Flow control, state and logs

Unattended runs need hard limits that a script enforces, and state that a script owns. None of
this is left to the model.

## Numbers (one config file)

All defaults are from the reference build. Its pilot (five builds of real tickets on a real
project, 2026-10-05) kept every number in the table below and added one: **cleaner rounds per
ticket, 2** (it was 1), because one build spent its only cleaner round on complexity and then
stopped on 3 equivalent mutants the hardener had already written simplifications for.

**Where the pilot spent its time:** about 80% of a build's wall time went to checks, and 58% to
checks repeated on code that had not changed. In the one build that reached review (25.6 min),
the same tree was linted, typechecked and tested 10 times; the test command alone took 48% of
the run and agent work 10%. The reference build now records each check result with the tree it
judged and reuses it while the tree is unchanged, and resumes an escalated ticket at the role
that failed instead of redoing the green ones (a retry would otherwise have redone 10.5 to 16.4
minutes of green roles). Build both in from the start. On a local
model with a different speed and context size, expect to tune most of them.

| Setting | Default | What happens at the limit |
|---|---|---|
| Controllers at once | 2 | The rest queue. Raise once the cost log shows headroom |
| Tickets per controller run | 2 | The controller stops picking new tickets |
| Stop-gate blocks before escalating | 2 | The 3rd red stop escalates |
| Identical tool calls in a row | 5 | The loop guard blocks and escalates |
| Wall clock per ticket | 90 min | Ticket back to the queue with a report |
| Retries per ticket (all failure types) | 2 | Ticket abandoned with a report |
| Context handoff | ~70% full | The role agent hands off to a fresh one via the handoff file (designed; not yet built in the reference) |
| Review fix rounds | 2 | Remaining findings escalate |
| Budget per run | a fixed amount | No new ticket starts |

A missing, unknown or malformed setting stops the dispatcher **before** it starts anything.

## Retry table, by failure type

| Failure | Retry |
|---|---|
| Context overflow | Once, with a smaller scope |
| Network error | Up to twice, as is |
| Tool error | Once |
| Unknown | Once |
| CI flake | One fresh run; a second failure is real |
| Usage limit | Never retried: stop clean, ticket back to the queue, resume after the reset |

Each row is also capped by the per-ticket retry total.

## Escalation

An escalation is a record (ticket, reason, count, time) written by a script, not a message the
model chooses to send. The controller moves an escalated ticket back to `planned` with a report,
and the briefing lists it under "needs you". "Blocked by ambiguity" is also an escalation: stop
and ask, do not guess.

## State a script owns

- **Work queue = folder location.** Each work item is a file; its state is the folder it sits in
  (`ready`, `running`, `done`, `failed`). Scripts move files; a script refuses to run if two items
  are `running` for one slot.
- **Single-writer lock** on shared trackers: a lock file with the owner's process id, stale-lock
  takeover, atomic writes (write a temporary file, then rename or link).
- **Counters** per ticket: stop-gate blocks, identical calls.
- **Verdict ledger** keyed by commit hash (see gate F2).

## Logs the briefing reads

- **Decision log** (one tab-separated line per decision the agents took on their own, with the
  reason).
- **Cost log** (one JSON line per model call: tokens, cost, role, ticket).
- **Observation log** (one JSON line per tool call: tool, target, result, time), written by a
  post-tool hook that is asynchronous, append-only, silent and makes no model call. Analysed once
  per run.
- **Session summary** at stop and before context compaction.

## Hook hygiene (lessons from other workflows)

- No catch-all matchers: register hooks only for the tools they inspect.
- Start hooks from an installed binary, not a package-runner bootstrap (the reference measured
  roughly ten times the start-up cost for the latter).
- Silent on pass. Never echo the payload back.
- Each hook costs time on every matching call; keep the set small.

## Isolation

- Each controller works in its **own working copy** (a separate worktree or clone) on a feature
  branch. Nothing is pushed to the main branch.
- Optional per project: a throwaway database branch per working copy with a time-to-live, and a
  smoke test against a preview deployment.
