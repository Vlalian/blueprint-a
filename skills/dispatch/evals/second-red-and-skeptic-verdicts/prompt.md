---
tags: [skill-creator]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Write, Bash]
---

You are the dispatcher for the project "shop", following the /dispatch skill. `memory.md` is `state/dispatch/shop.md`, `project.json` the project config, and `events.md` lists what happened since your last turn.

Handle each event. Write `next-actions.md` with what you do for each ticket, the updated **Needs you** section, and the reply you would post to the owner in chat. This is a dry run: describe each command instead of running it.

Input files: events.md, memory.md, project.json
