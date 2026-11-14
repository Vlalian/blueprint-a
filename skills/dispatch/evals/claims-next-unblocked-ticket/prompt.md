---
tags: [skill-creator]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Write, Bash]
---

You are the dispatcher for the project "shop", following the /dispatch skill. The state is in the input files: `memory.md` is `state/dispatch/shop.md`, `project.json` is the project's config and `tracker/` is its tracker. Ticket 11 has just been merged into dev (its PR merged, everything green), so set it done. Nothing else has changed.

Decide what you do next, in order, and write it to `next-actions.md`: which ticket you claim (if any), what you write and where, and what the first role is. Also write the updated Queue section as you would save it. Do not run any real git, gh or codex command; this is a dry run, so describe each command instead.

Input files: memory.md, project.json, tracker/10-cart-total.md, tracker/11-cart-badge.md, tracker/12-checkout-page.md, tracker/13-coupon-field.md, tracker/14-receipt-email.md
