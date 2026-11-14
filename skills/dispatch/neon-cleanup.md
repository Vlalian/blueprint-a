# Neon cleanup

Run only when `project.json` has a `neon` block. Use its configured Neon CLI and project identity.
List branches first.
Delete a run's own `dev/pilot-*` branch once its run has ended (PR opened, failed or abandoned).
Delete a `preview/*` branch whose PR is merged or closed or that is stale, checking PR state and
branch activity first. Keep `production`, the seed branch, `preview/dev`, `test/*` and `dev/afk`.
A run continues at the branch cap: free eligible branches and go on. Record deletions and their
eligibility evidence in ticket progress. Keep database values out of chat and memory.
