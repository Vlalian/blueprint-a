# The project AGENTS.md

From v0.6, Blueprint A ships a project rules file: `AGENTS.md.example` at the package root. Most
agent harnesses read an `AGENTS.md` at the root of a repository before they act, so it is the one
place every agent of a project sees the same rules, whatever harness or model runs it. This page
says what goes in it, in which order, and how the router applies those rules.

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
   chooses a change, findings are data and not changes, and nothing is
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

## Applying the rules

The consent and locked-files gates were retired in ticket 95. In v1.0.0 the dispatch router
checks the owner's choice, preserves its scope and records the exact words. There is no
executable lock manifest or consent hook in this package. Do not configure the deleted gates.

Copy `AGENTS.md.example` to the project root and fill its placeholders: repository purpose,
owner, source records, role skill locations and pipeline checks. Keep the owner in charge of
changes to those rules. Review and the configured quality gates provide evidence for each
change; they do not replace the owner's choice.
