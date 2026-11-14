# Queue

The **Queue** section of `state/dispatch/<project>.md` lists the owner's picks, one line each, in the order he
gave them: `<ticket> | <state> | <worktree> | <builder family>`. It is the queue's single source of truth
and it survives a restart because it lives in that file, not in this chat.

States, in order: `queued`, `claimed`, `building`, `judging`, `walking`, `merging`, `done`. `needs-you`
takes a ticket out of the running set until the owner settles it.

## Claim

A **slot** is free while fewer than 3 tickets are `claimed` or later and not `done` or `needs-you`.
For a free slot, the next ticket is the first `queued` line, in queue order, whose `Depends on:` tickets
are all `done` and that nobody has claimed. Before any work on it:

1. Reread the memory file; another chat may have claimed it.
2. Write `claimed` on its queue line and set its tracker `Status:` to `claimed` through
   [tracker-status.md](tracker-status.md).
3. Create its worktree on a fresh ticket branch from the project's `integrationBranch`
   (`<repo.branchPrefix><ticket>`).

A ticket whose dependency is not `done` stays `queued`; the next one in order may go first.

Completion criterion: the claimed ticket's line says `claimed` with its worktree, written before any
role starts on it.

## Builder

Claude or Codex builds a ticket by capacity: Codex when Claude tokens are short, Claude otherwise. Record
the builder family on its queue line; the judges come from the other family ([roles.md](roles.md)).

## One heavy check at a time

A mutation run (onkel, Stryker) or a full test suite is a **heavy check**: at most one runs on this PC
at a time, across all tickets. Other tickets' heavy checks wait their turn; light checks (lint,
typecheck, red check, test deletion, debug leftovers, duplication, boundaries, the security scans) run
freely. AGENTS.md rule 5 (one local gate at a time) changes only by the owner's edit.
