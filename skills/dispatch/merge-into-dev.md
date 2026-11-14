# Into dev

The project's `integrationBranch` takes green tickets; its `promoteTo` branch (`main`) is the owner's alone.
Push ticket branches only. Merge on your own only into an integration branch named `dev`.
Every other integration branch needs the owner's yes for each merge: open the PR, add it to
**Needs you** and stop at step 4.

1. Move the ticket's tracker `Status:` to `ready-for-review` through [tracker-status.md](tracker-status.md).
2. Push the ticket branch to `pr.remote` and open the PR non-interactively:
   `gh pr create --base <integrationBranch> --head <ticket-branch> --title <ticket title> --body-file <file>`,
   the body holding the plan, the changes, each gate result and every finding's fate.
3. When `pr.coderabbit` is true, comment `@coderabbitai review`. Judge each CodeRabbit comment on its
   merits: a real one is a fix round, noise is dismissed with a concrete reason; record each one.
4. Wait for CI on the PR's exact head commit (`node "<Workflow root>/gates/ci-on-sha/cli.ts" --sha <head>
   --cwd <worktree>`). Red CI is a fix round.
5. When the integration branch is `dev` and the gates, the judges, the walk and CI are green on that
   same head with no stale evidence, merge the PR into `dev` (`gh pr merge <number> --merge`), set the
   queue line and the tracker to `done`, and free the slot. An open better-design choice in **Needs you** does not hold this merge.
6. Merge the new `integrationBranch` into every other open ticket branch that no role is writing to at
   that moment; that is a head change (see [roles.md](roles.md)). A conflict starts a fix round for that
   ticket. A branch a role is writing to gets a **pending update** line in **Ticket progress**, and you
   merge `integrationBranch` into it before its next role starts.
7. When `project.json` has a `neon` block, follow [neon-cleanup.md](neon-cleanup.md) for the ticket's Neon branches.

Completion criterion: the PR is merged into `dev` on a head with every check green, or waits in
**Needs you** for the owner's merge; every other open ticket branch carries it, has a fix round started, or
has a pending update.
