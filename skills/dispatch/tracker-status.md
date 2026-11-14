# Tracker Status moves

Read the configured tracker ticket before each write. Change only its `Status:` line and append
comments, preserving its body and earlier comments. This repo's tracker also permits a ticket's
`Result` section. Write only tickets selected by the project's configuration.

- Triage moves `needs-triage` to `ready-for-agent`, `needs-info` or `closed`, with its verdict appended.
- Move `ready-for-agent` to `planned` only when the owner approves the exact gated plan, or picks a
  grilled ticket, which approves its plan; name its plan path.
- Once that plan is approved, move `planned` to `claimed` when the dispatcher claims it,
  `claimed` to `ready-for-review` when its PR opens, and `ready-for-review` to `done` when that PR
  is merged into the project's `integrationBranch`. A fix round returns to `claimed`.
- Other moves need the owner's recorded choice. Preserve his scope when applying a delegated approval.
- A workflow ticket stays `proposed` until its `Agreed:` line quotes the owner choosing it or names an
  accepted proposal. Run the plan gate's criteria check before queueing it.

For an owner's existing `planned` ticket, read the plan named on its Status line and gate it.
Use that plan if green; otherwise plan it again as `ready-for-agent` and seek approval.
