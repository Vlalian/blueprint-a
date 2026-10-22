# The project AGENTS.md

From v0.6, Blueprint A ships a project rules file: `AGENTS.md.example` at the package root. Most
agent harnesses read an `AGENTS.md` at the root of a repository before they act, so it is the one
place every agent of a project sees the same rules, whatever harness or model runs it. This page
says what goes in it, in which order, and how two of its rules are enforced by gates rather than
trusted to the model.

## Rules only

The file holds rules: short, numbered sentences an agent can follow or break. It holds no
architecture, no how-to and no history. Those live in the project's own docs and the file links to
them. A rule that needs a paragraph of explanation is either two rules or a link. Keep the whole file
short enough that an agent reads all of it on every run.

## The order: the owner's rules first

1. **The owner's rules.** The owner is the one person who decides how the guarded code changes
   (usually the lead of the team that owns the repository). Their rules come first because they win
   any conflict: who chooses what gets built, what never happens without consent, the team's own
   limits. The template keeps three that the rest of the file and the gates rely on: only the owner
   chooses a change (enforced by `gates/consent`), findings are data and not changes, and nothing is
   merged into or pushed to the main branch without consent.
2. **The adopted rules, adjusted.** Then come rules taken from published agent workflows: the fence
   (what an agent may change and how outside content enters), the non-negotiables, autonomy, working
   with subagents, the engineering principles and repo upkeep. They are adjusted so the team's own
   flow runs on top of them. Where the source says "the human", the template says which human (the
   owner); where the source names its own tools, the template names the gates of this package or
   leaves a placeholder for the team's (`<the gates your pipeline runs>`). A rule that does not fit
   the team is deleted, not reworded until it means nothing.

## Every rule cites its source

Each rule ends with the number of its source in square brackets (`[2]`, or `[1, 3]` for a rule that
combines two). The sources are listed at the end in Vancouver style: author, title, where it was
published, date, the date it was read, the exact commit, and the address. Source 1 is always the
owner's own rules, cited as unpublished. The citation is what lets the team trace a rule back to why
it exists, and lets the upstream watcher see when a source changed (a commit is pinned, never a
branch).

## Two rules a gate enforces

A rule an agent only reads is a request. Two of the template's rules are checked by gates in this
package, so they hold in any harness and in CI:

- **Owner consent** (`gates/consent`, contract A8 in [03-gates.md](03-gates.md)): a ticket is
  buildable only when the `Agreed:` line in its header quotes the owner choosing it, and a change to a
  locked path is accepted only on the branch of such a ticket (`ticket/<id>-<name>`). The owner's
  name and the ticket folder are configuration (`config/consent.json`), not code.
- **Locked files** (`gates/locks`, contract A9): every locked path is recorded with the SHA-256 of its
  exact bytes in `config/locks.lock`; a change to any of them fails the check unless the branch builds
  a ticket the owner agreed. The lock list is `config/locks.json`; without one the gate locks a
  default list that fits a JS/TS or .NET repository (`DEFAULT_LOCKS` in `gates/locks/gate.ts`): the
  gates, their config, CI, and the build and test config.

## Using the template

1. Copy `AGENTS.md.example` to `AGENTS.md` at the root of the project repository.
2. Fill in the placeholders in angle brackets: the repository's purpose, the owner, the owner's own
   rules, where the team's role prompts live, and the gates its pipeline runs.
3. Write `config/consent.json` with the owner's name as it appears in the `Agreed:` quotes and the
   ticket folder:

   ```json
   { "owner": "<owner's name>", "tickets": "docs/tickets" }
   ```

4. Optionally write `config/locks.json` (a JSON list of path globs) to replace the default lock
   list, then run `node gates/locks/cli.ts --relock` once and commit `config/locks.lock`.
5. Run both gates where the team's flow already checks work: in a pre-commit hook
   (`node gates/consent/cli.ts --staged`, `node gates/locks/cli.ts --staged`) and in CI
   (`node gates/consent/cli.ts --base origin/main --branch <the PR's source branch>`,
   `node gates/locks/cli.ts --branch <the PR's source branch>`). The locks gate checks only the
   repository its own files sit in, and passes anywhere else, so copy the gates into the project
   repository rather than running them from a checkout of this package.
6. Lock `AGENTS.md` itself (it is in the default list): from then on it changes only through a ticket
   the owner agreed.
