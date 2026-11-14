# Project draft

Read the folder's git origin, local branches, `package.json` scripts, the owner's grill document
and issues folder. Ask for the last two locations if discovery cannot establish them.
Collect environment variable names only; keep their values private.

Show a complete `project.json` draft in chat with `name`, `repo.remote`, `repo.worktree`,
`tracker`, `grill`, `discovered` (branches, scripts, envNames), and `safety`
(confirmed: false, deny: [], productionDatabaseHost: null).
Discovered scripts and branches are facts, while commands and safety settings are the owner's choices.
Have the owner confirm the deny list and production database host. Save the displayed draft to
`projects/<name>/project.json` only after his explicit yes, recording his words in project memory.
Keep safety unconfirmed until he confirms it. Start from `project.json.example` at the Workflow
root in a package; fill in its runtime fields and role checks before starting a build.
