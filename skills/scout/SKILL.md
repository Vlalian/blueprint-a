---
name: scout
description: Scout for new work at the end of a project run or whenever the owner asks.
disable-model-invocation: true
---

# Scout

## 1. Orient

Read the Workflow root's `AGENTS.md`, `projects/<project>/project.json` and
`state/dispatch/<project>.md`, using the root supplied by the dispatcher.
Every `state/`, `projects/` and `gates/` path here is under that root.
Read the configured tracker and earlier proposals to **deduplicate** by source and problem.

Completion criterion: the project, tracker, source identities and existing proposals are known.

## 2. Reconnoitre

Collect **evidence** from each source, keeping the command or file and observation time:

- GitHub: derive `<owner/repo>` from `repo.remote`. Read all pages with
  `gh api --paginate repos/<owner/repo>/issues?state=open` (separate PR entries), and
  `gh api --paginate repos/<owner/repo>/pulls?state=open`. Follow relevant items with
  `gh issue view <number> --repo <owner/repo> --comments` or
  `gh pr view <number> --repo <owner/repo> --comments` and `gh pr checks <number> --repo <owner/repo>`.
- Vercel: use the project's configured identity or its worktree's `.vercel/project.json`.
  Read deployment status with `vercel list <project-name> --scope <team>` and inspect relevant
  deployments with `vercel inspect <deployment-url> --scope <team>`.
- Neon: use the configured project identity or `NEON_PROJECT_ID`; read project and branch status
  with `neon projects get <project-id>` and `neon branches list --project-id <project-id>`.
- Upstream: read the Workflow root's `watchlist.yaml`. If absent, report upstream as unconfigured.
  For each configured repo use its recorded `seen` SHA
  in `state/inputs/upstream.json`, falling back to `state/upstream.json`, then its watchlist
  `baseline`. Read `gh api repos/<owner/repo>/compare/<recorded-sha>...HEAD`; follow pagination
  and changed files before judging relevance. Cite the repo, both commits and compare URL.
  Leave baselines and cursors intact; present changes as proposals for review.
- Feedback: read the source named in this project's `project.json`. Read its named file, or use
  its configured read-only command/API/query, recording the exact invocation and source location.
  If none is named, report feedback as unconfigured.

Keep credentials and personal feedback details private.
Use only read commands; report each gap or tool defect to the dispatcher and continue the independent sources.

Completion criterion: every source has evidence or a named coverage gap, including truncated results.

## 3. Propose

Present each **proposal** to the dispatcher for its chat: problem, why it matters, suggested work,
source URL or file and command output, and any uncertainty. Link an existing ticket for duplicates.
The dispatcher puts each new choice to the owner and records his words in memory.
Return the evidence and choices to the dispatcher, which files accepted proposals in the tracker.

Completion criterion: each proposal links an existing ticket or a choice for the owner with its source.

## 4. Close

End with the **closing summary**: what you did, what went wrong and how well it went.
Include source coverage, proposal outcomes and ticket references for the dispatcher's memory.

Completion criterion: the dispatcher has the proposals and closing summary.
