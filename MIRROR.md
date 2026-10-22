# MIRROR

Blueprint A **v0.9.0**, exported one way from the reference repository at commit `226f47d57308` by its
`scripts/export-blueprint-a.ts`. Do not change files here: change them in the reference and export
again.

## What is here

| From the reference | Here |
|---|---|
| `templates/blueprint-a` | (the package root) |
| `docs/blueprint-a` | `docs` |
| `gates/secret-scan` | `gates/secret-scan` |
| `gates/hidden-unicode` | `gates/hidden-unicode` |
| `gates/handoff` | `gates/handoff` |
| `gates/boundaries` | `gates/boundaries` |
| `gates/plan` | `gates/plan` |
| `gates/four-checks` | `gates/four-checks` |
| `gates/git-guard` | `gates/git-guard` |
| `gates/red-check` | `gates/red-check` |
| `gates/test-deletion` | `gates/test-deletion` |
| `gates/debug-leftovers` | `gates/debug-leftovers` |
| `gates/test-strength` | `gates/test-strength` |
| `gates/onkel` | `gates/onkel` |
| `gates/lib` | `gates/lib` |
| `adapters/claude-code/git-rules.ts` | `gates/git-guard/git-rules.ts` |
| `adapters/claude-code/git-rules.test.ts` | `gates/git-guard/git-rules.test.ts` |
| `adapters/claude-code/shell-parse.ts` | `gates/git-guard/shell-parse.ts` |
| `adapters/claude-code/shell-parse.test.ts` | `gates/git-guard/shell-parse.test.ts` |
| `gates/hardener/gate.ts` | `gates/hardener/gate.ts` |
| `gates/hardener/gate.test.ts` | `gates/hardener/gate.test.ts` |
| `gates/hardener/gate.property.test.ts` | `gates/hardener/gate.property.test.ts` |
| `gates/research/claims.ts` | `gates/research/claims.ts` |
| `gates/research/facts.ts` | `gates/research/facts.ts` |
| `gates/research/fixtures.ts` | `gates/research/fixtures.ts` |
| `gates/ci-on-sha/gate.ts` | `gates/ci-on-sha/gate.ts` |
| `gates/ci-on-sha/gate.test.ts` | `gates/ci-on-sha/gate.test.ts` |
| `adapters/js-ts` | `adapters/js-ts` |
| `adapters/dotnet` | `adapters/dotnet` |
| `adapters/host` | `adapters/host` |
| `adapters/environment` | `adapters/environment` |
| `test/helpers/prove-it-bites.ts` | `test/helpers/prove-it-bites.ts` |
| `test/fixtures/skips` | `test/fixtures/skips` |
| `config/dependency-cruiser.cjs` | `config/dependency-cruiser.cjs` |
| `fixtures/sample-project` | `fixtures/sample-project` |
| `fixtures/dotnet-sample` | `fixtures/dotnet-sample` |
| `fixtures/azure-devops` | `fixtures/azure-devops` |
| `fixtures/kubernetes` | `fixtures/kubernetes` |
| `adapters/sonarqube` | `adapters/sonarqube` |
| `gates/sonarqube/gate.ts` | `gates/sonarqube/gate.ts` |
| `gates/sonarqube/gate.test.ts` | `gates/sonarqube/gate.test.ts` |
| `fixtures/sonarqube` | `fixtures/sonarqube` |
| `templates/plan.md` | `templates/plan.md` |
| `gates/sast/core.ts` | `gates/sast/core.ts` |
| `gates/sast/core.test.ts` | `gates/sast/core.test.ts` |
| `gates/sast/gate.ts` | `gates/sast/gate.ts` |
| `gates/sast/gate.test.ts` | `gates/sast/gate.test.ts` |
| `gates/sast/io.ts` | `gates/sast/io.ts` |
| `gates/sast/io.test.ts` | `gates/sast/io.test.ts` |
| `gates/sast/cli.ts` | `gates/sast/cli.ts` |
| `gates/sast/cli.test.ts` | `gates/sast/cli.test.ts` |
| `gates/sast/stop.ts` | `gates/sast/stop.ts` |
| `gates/sast/stop.test.ts` | `gates/sast/stop.test.ts` |
| `gates/sast/rules/README.md` | `gates/sast/rules/README.md` |
| `gates/sast/rules/SNAPSHOT.json` | `gates/sast/rules/SNAPSHOT.json` |
| `test/fixtures/sast` | `test/fixtures/sast` |
| `gates/consent` | `gates/consent` |
| `gates/locks` | `gates/locks` |
| `gates/canary` | `gates/canary` |
| `gates/duplication` | `gates/duplication` |
| `gates/licence` | `gates/licence` |
| `gates/review-schema` | `gates/review-schema` |
| `gates/slop-lint` | `gates/slop-lint` |
| `gates/supply-chain` | `gates/supply-chain` |
| `gates/tamper` | `gates/tamper` |
| `gates/walk` | `gates/walk` |
| `gates/evidence` | `gates/evidence` |
| `test/helpers/toy-canary.ts` | `test/helpers/toy-canary.ts` |
| `scripts/self-gate.ts` | `runner/self-gate.ts` |
| `scripts/self-gate-main.ts` | `runner/self-gate-main.ts` |
| `scripts/self-gate-main.test.ts` | `runner/self-gate-main.test.ts` |
| `scripts/self-gate-core.ts` | `runner/self-gate-core.ts` |
| `scripts/self-gate-core.test.ts` | `runner/self-gate-core.test.ts` |
| `scripts/self-gate-run.ts` | `runner/self-gate-run.ts` |
| `scripts/self-gate-cloud.ts` | `runner/ci-report.ts` |
| `scripts/self-gate-cloud.test.ts` | `runner/ci-report.test.ts` |
| `scripts/self-gate-run.test.ts` | `runner/self-gate-run.test.ts` |
| `scripts/self-gate-select.ts` | `runner/self-gate-select.ts` |
| `scripts/self-gate-select.test.ts` | `runner/self-gate-select.test.ts` |
| `scripts/self-gate-shells.ts` | `runner/self-gate-shells.ts` |
| `scripts/self-gate-merge.test.ts` | `runner/self-gate-merge.test.ts` |
| `scripts/shells.ts` | `runner/shells.ts` |
| `scripts/shells.test.ts` | `runner/shells.test.ts` |
| `scripts/affected-deps.ts` | `runner/affected-deps.ts` |
| `scripts/affected-deps.test.ts` | `runner/affected-deps.test.ts` |
| `scripts/merge-check.ts` | `runner/merge-check.ts` |
| `scripts/merge-check.test.ts` | `runner/merge-check.test.ts` |
| `scripts/runner-config.ts` | `runner/runner-config.ts` |
| `scripts/runner-config.test.ts` | `runner/runner-config.test.ts` |
| `scripts/runner-checks.ts` | `runner/runner-checks.ts` |
| `scripts/runner-checks-core.ts` | `runner/runner-checks-core.ts` |
| `scripts/runner-checks-core.test.ts` | `runner/runner-checks-core.test.ts` |
| `scripts/runner-checks.integration.test.ts` | `runner/runner-checks.integration.test.ts` |
| `scripts/portability.ts` | `runner/portability.ts` |
| `scripts/portability.test.ts` | `runner/portability.test.ts` |
| `scripts/spawn-timeouts.ts` | `runner/spawn-timeouts.ts` |
| `scripts/spawn-timeouts.test.ts` | `runner/spawn-timeouts.test.ts` |
| `scripts/check-package.ts` | `runner/check-package.ts` |
| `scripts/check-package.test.ts` | `runner/check-package.test.ts` |
| `scripts/check-package-core.ts` | `runner/check-package-core.ts` |
| `scripts/check-package-core.test.ts` | `runner/check-package-core.test.ts` |
| `scripts/install-pre-commit-core.ts` | `runner/install-pre-commit-core.ts` |
| `scripts/install-pre-commit.test.ts` | `runner/install-pre-commit.test.ts` |
| `scripts/full-run.ts` | `runner/full-run.ts` |
| `scripts/full-run-main.ts` | `runner/full-run-main.ts` |
| `scripts/full-run-main.test.ts` | `runner/full-run-main.test.ts` |
| `scripts/lock.ts` | `runner/lock.ts` |
| `scripts/lock.test.ts` | `runner/lock.test.ts` |
| `scripts/lock.integration.test.ts` | `runner/lock.integration.test.ts` |
| `scripts/lock-fs.ts` | `runner/lock-fs.ts` |
| `scripts/lock-fs.test.ts` | `runner/lock-fs.test.ts` |
| `scripts/locks.ts` | `runner/locks.ts` |
| `scripts/functions-core.ts` | `runner/functions-core.ts` |
| `scripts/functions-core.test.ts` | `runner/functions-core.test.ts` |
| `scripts/function-ledger-core.ts` | `runner/function-ledger-core.ts` |
| `scripts/function-ledger-core.test.ts` | `runner/function-ledger-core.test.ts` |
| `scripts/prices-core.ts` | `runner/prices-core.ts` |
| `scripts/prices-core.test.ts` | `runner/prices-core.test.ts` |
| `scripts/gate-metrics-core.ts` | `runner/gate-metrics-core.ts` |
| `scripts/gate-metrics-core.test.ts` | `runner/gate-metrics-core.test.ts` |
| `dispatcher/selection.ts` | `runner/selection.ts` |
| `dispatcher/selection.test.ts` | `runner/selection.test.ts` |
| `dispatcher/selection-records.ts` | `runner/selection-records.ts` |
| `dispatcher/function-records.ts` | `runner/function-records.ts` |
| `dispatcher/function-records.test.ts` | `runner/function-records.test.ts` |
| `dispatcher/observations.ts` | `runner/observations.ts` |
| `dispatcher/observations.test.ts` | `runner/observations.test.ts` |
| `dispatcher/sast-records.ts` | `runner/sast-records.ts` |
| `dispatcher/sast-records.test.ts` | `runner/sast-records.test.ts` |
| `dispatcher/tempo.ts` | `runner/tempo.ts` |
| `dispatcher/tempo.test.ts` | `runner/tempo.test.ts` |
| `dispatcher/tempo-records.ts` | `runner/tempo-records.ts` |
| `test/helpers/merge-gate-repo.ts` | `test/helpers/merge-gate-repo.ts` |
| `test/fixtures/affected-tests` | `test/fixtures/affected-tests` |
| `test/fixtures/sessions` | `test/fixtures/sessions` |
| `adapters/git/pre-commit.template` | `adapters/git/pre-commit.template` |
| `test/fixtures/observations` | `test/fixtures/observations` |
| `test/fixtures/ledger` | `test/fixtures/ledger` |
| `test/fixtures/portability` | `test/fixtures/portability` |
| `config/prices.json` | `config/prices.json` |
| `scripts/blueprint-flow` | `flow` |
| `scripts/pr-core.ts` | `flow/pr-core.ts` |
| `scripts/pr-core.test.ts` | `flow/pr-core.test.ts` |
| `scripts/watch-pr-core.ts` | `flow/watch-pr-core.ts` |
| `scripts/watch-pr-core.test.ts` | `flow/watch-pr-core.test.ts` |
| `scripts/ledger-core.ts` | `flow/ledger-core.ts` |
| `scripts/ledger-core.test.ts` | `flow/ledger-core.test.ts` |
| `dispatcher/staging.ts` | `flow/staging.ts` |
| `dispatcher/staging.test.ts` | `flow/staging.test.ts` |
| `scripts/queue.ts` | `flow/queue.ts` |
| `scripts/queue.test.ts` | `flow/queue.test.ts` |
| `scripts/queue-fs.ts` | `flow/queue-fs.ts` |
| `scripts/queue-fs.test.ts` | `flow/queue-fs.test.ts` |
| `scripts/queue.integration.test.ts` | `flow/queue.integration.test.ts` |
| `scripts/evaluate-core.ts` | `flow/evaluate-core.ts` |
| `scripts/evaluate-core.test.ts` | `flow/evaluate-core.test.ts` |
| `scripts/evaluate.ts` | `flow/evaluate.ts` |
| `scripts/evaluation-config.ts` | `flow/evaluation-config.ts` |
| `scripts/evaluation-config.test.ts` | `flow/evaluation-config.test.ts` |
| `scripts/gate-lessons-core.ts` | `flow/gate-lessons-core.ts` |
| `scripts/gate-lessons-core.test.ts` | `flow/gate-lessons-core.test.ts` |
| `dispatcher/learn.ts` | `flow/learn.ts` |
| `dispatcher/learn.test.ts` | `flow/learn.test.ts` |
| `dispatcher/tickets.ts` | `flow/tickets.ts` |
| `dispatcher/tickets.test.ts` | `flow/tickets.test.ts` |
| `dispatcher/run-guard.ts` | `flow/run-guard.ts` |
| `dispatcher/run-guard.test.ts` | `flow/run-guard.test.ts` |
| `dispatcher/workflow-config.ts` | `flow/workflow-config.ts` |
| `dispatcher/workflow-config.test.ts` | `flow/workflow-config.test.ts` |
| `dispatcher/owner-choice.ts` | `flow/owner-choice.ts` |
| `dispatcher/owner-choice.test.ts` | `flow/owner-choice.test.ts` |
| `briefing/decisions.ts` | `flow/decisions.ts` |
| `briefing/decisions.test.ts` | `flow/decisions.test.ts` |
| `test/helpers/flow-fakes.ts` | `test/helpers/flow-fakes.ts` |
| `test/helpers/fake-gh.ts` | `test/helpers/fake-gh.ts` |
| `test/helpers/repo-template.ts` | `test/helpers/repo-template.ts` |
| `test/helpers/portable-paths.ts` | `test/helpers/portable-paths.ts` |

## Left out, and why

| Path | Why |
|---|---|
| `dispatcher/` | the controller and its roles run Claude Code sessions (decision 23: no dispatcher); the observation log, the test selection's records, the tempo stats and the function, sast and selection records the runner writes are in runner/ (ticket 83) |
| `skills/` | role skills written for Claude Code (decision 23: no skills) |
| `agents/` | Claude Code agent definitions |
| `adapters/claude-code/` | Claude Code's hook scripts (decision 23: no hooks); the git rules and shell reader they use are here in gates/git-guard |
| `gates/hardener/cli.ts` | wires the reference repo's own self-gate; gate.ts is here, a harness wires its own shell |
| `briefing/` | the reference's morning briefing page, built from its own state and logs |
| `watchers/` | incident and upstream watchers, tied to the reference's hosting and upstream list; the incident rule on Kubernetes is in adapters/environment/incident.ts |
| `scripts/` | the reference repo's own tooling (pull requests, cloud sessions, this export), and its tamper exception for lessons (scripts/tamper-lessons.ts) that config/tamper.json names; the self-gate, the test selection, the checks, the function registry and the metrics are in runner/ (ticket 83) |
| `projects/` | per-project settings of the reference |
| `config/` | the reference's own settings; only the dependency-cruiser rules the boundaries gate reads are here, config/supply-chain.json holds the supply-chain gate's exceptions for this package's own dev tools, and config/runner.json the runner's settings for this package |
| `gates/ci-on-sha/cli.ts` | wires the reference repo's gh runner and project settings; gate.ts and the host adapters it reads (adapters/host) are here, a harness wires its own shell |
| `gates/sonarqube/cli.ts` | wires the reference repo's project settings and HTTP client; gate.ts and the SonarQube adapter it reads (adapters/sonarqube) are here, a harness wires its own shell |
| `gates/sonarqube/run.ts` | reads the reference repo's project settings for its shell; a harness wires the adapter, its wait and the gate itself |
| `gates/research/` | the researcher role's gate; only the claim shapes the plan gate reads are here |
| `gates/sast/rules/csharp/` | Semgrep's C# rule files: the Semgrep Rules License v1.0 allows internal use and no redistribution, so the export carries their pin (gates/sast/rules/SNAPSHOT.json: Semgrep version, semgrep-rules commit, every file and rule) and gates/sast/rules/README.md says how a team copies them in |
| `gates/sast/rules/javascript/` | Semgrep's JavaScript and TypeScript rule files, left out for the same licence; pinned in SNAPSHOT.json |
| `gates/sast/rules/typescript/` | Semgrep's TypeScript rule files, left out for the same licence; pinned in SNAPSHOT.json |
| `gates/sast/snapshot.test.ts` | checks the rule files against SNAPSHOT.json, and the rule files are not exported |
| `scripts/self-gate-chosen.ts` | the reference's merge check (only a change its owner chose merges, ticket 64); the runner asks a repo's own check through config/runner.json mergeCheck (runner/merge-check.ts), and gates/consent is the generic owner-consent gate |
| `scripts/self-gate-chosen-merge.test.ts` | that merge check end to end on a real merge |
| `scripts/runner-config-repo.test.ts` | checks the reference repo's own config/runner.json |
| `scripts/functions.ts` | writes the reference's registry from what functions-sources.ts reads; runner/functions-core.ts is the registry and its check |
| `scripts/functions-sources.ts` | reads the reference's hook settings, role skills, project configs and watchlist |
| `scripts/gate-metrics.ts` | prints the metrics with those lessons; a harness prints runner/gate-metrics-core.ts's gateMetrics itself |
| `scripts/tempo.ts` | records the reference's cloud build fires and merge preparations, and plans the next builds from its tickets; runner/tempo.ts is the stats and pacing it reads |
| `scripts/tempo-main.ts` | what scripts/tempo.ts does, wired to the reference's briefing, ticket files and cloud preflight |
| `dispatcher/tempo-pass-when.test.ts` | the tempo stats as the reference's briefing shows them |
| `scripts/run-command.ts` | the /flow command that starts the dispatcher; its single-writer lock is here in runner/lock.ts |
| `scripts/run-command-core.ts` | what /flow does, over the dispatcher's runs, tickets and decisions |
| `dispatcher/run-observations.ts` | the dispatcher's own observation records (choice, applied, complexity, improvement, merges), added to the log's MoreRecords |
| `scripts/self-gate-shells.test.ts` | checks that every shell on the reference's frozen list exists in the reference repo |
| `scripts/install-pre-commit-hook.test.ts` | the rendered hook in a real repo, under the reference's own tamper config and tiers |
| `dispatcher/tempo-config.test.ts` | checks the reference's own config/tempo.json |
| `scripts/flow/` | this repo's own flow (its night branch, Claude cloud runs and Codex builds, the CodeRabbit queue, and the pilot project's night of tickets with its Neon branch clean-up); flow/ is the same flow with every such name in config/flow.json |
| `dispatcher/neon.ts` | the pilot project's Neon database branches |
| `dispatcher/pr-queue.ts` | CodeRabbit's queue: one review an hour on its free plan, read through CodeRabbit's replies (dispatcher/coderabbit.ts); the flow's review is the other configured family's (flow/review.ts) |
| `scripts/flow/review-queue.ts` | puts PRs in that CodeRabbit queue |
| `scripts/codex-review-core.ts` | runs Codex and Claude Code by name; flow/model-run.ts runs any family config/flow.json names |
| `scripts/codex-io.ts` | finds the Codex CLI on this PC; a family's command in config/flow.json names its own CLI |
| `scripts/flow/codex-build.ts` | the Codex build; flow/build.ts builds with any configured family |
| `scripts/pr.ts` | wires the PR core to this repo's project settings (scripts/ship-io.ts); flow pr reads config/flow.json |
| `scripts/watch-pr.ts` | wires the CI watch to this repo; flow watch-pr reads config/flow.json |
| `scripts/ledger.ts` | wires the ledger to this repo; flow ledger is the same core |
| `scripts/ship-io.ts` | this repo's process and project-settings wiring, with Claude Code's command resolution |
| `scripts/ci-core.ts` | a re-export kept for old callers; the CI read is adapters/host |
| `scripts/gh-result.ts` | a re-export kept for old callers; the result type is adapters/host/process-result.ts |
| `dispatcher/run-io.ts` | the dispatcher's own I/O, wiring its roles, Neon, Codex and cloud sessions; flow/flow-io.ts is the flow's |
| `scripts/flow/cloud-prompt.ts` | the cloud routine's prompt for this repo's cloud builds |
| `scripts/cloud-import.ts` | carries a cloud session's records into this repo |
| `scripts/cloud-export.ts` | carries a cloud session's records out of it |
| `scripts/cloud-carry-io.ts` | the I/O of that carrying |
| `scripts/coderabbit-backfill.ts` | fills this repo's CodeRabbit queue from its past PRs |
| `scripts/export-blueprint-a.ts` | this export |
| `scripts/blueprint-a/` | this export's cores |
| `scripts/apply-lesson-core.ts` | writes accepted lessons into this repo's projects/<name>/directives.md and its Claude Code skills (skills/, not in the package) from the dispatcher's apply queue, and records each with the dispatcher's own applied record (dispatcher/run-observations.ts); the package's generic step is flow apply-lessons (flow/lessons.ts), which reads the owner's decisions file and writes each accepted lesson to config/flow.json's directivesFile, a skill in its skillsFolder or a gate ticket draft |
| `scripts/apply-lesson.ts` | wires that lesson writer to this repo; in the package, node flow/cli.ts apply-lessons (flow apply-lessons) applies accepted lessons |
| `scripts/evaluate.test.ts` | runs the evaluation's shell on a copy of this repo's own function registry (config/functions.json); flow/evaluate-core.test.ts tests the evaluation itself |

## Changed on the way out

- Relative imports pointed at where their files land here: 52 files.
- the pilot project's name: replaced in 3 places.
- a pilot project's ticket path: replaced in 1 places.
- the owner's first name, possessive: replaced in 29 places.
- the owner's first name: replaced in 33 places.
- this machine's checkout folder in recorded test reports: replaced in 3 places.
- the owner's first name in a file name: replaced in 0 places.
- the owner's first name in a code name: replaced in 22 places.
- the owner's first name in a ticket's file name: replaced in 3 places.
- the owner's first name in a code name, lower case: replaced in 1 places.
- the pilot project's short name: replaced in 8 places.

## Pilot markers

Resolved from the pilot's numbers:

- `04-flow-control.md`: the pilot kept every number in the table and added cleaner rounds; its time split is now in the doc
- `06-open-questions.md`: the pilot ran the bar on real code; incremental mutation exists in the JS/TS tool

Still marked "(to confirm after the pilot)":

- `docs/01-principles.md` line 96: (to confirm after the pilot).
- `docs/02-flow-and-roles.md` line 111: (to confirm after the pilot).
- `docs/05-decisions.md` line 28: | 21 | The reference build now builds tickets in cloud sessions and runs every gate locally before merging | Saves local resources and allows parallel builds; costs a round trip when a gate is red. (to confirm after the pilot) |
- `docs/06-open-questions.md` line 35: 70%)? (to confirm after the pilot)
- `docs/06-open-questions.md` line 60: 3. Should review run inside every run, or only when the human asks? (to confirm after the pilot)
- `docs/06-open-questions.md` line 62: model's speed? (to confirm after the pilot)

## Version history

| Version | Date | Notes |
|---|---|---|
| 0.1.0 | 2026-10-05 | First release: the seven docs with the pilot's numbers; the language-neutral gates as code (secret scan, hidden Unicode, handoff, git guard, boundaries, plan, four checks with skipped tests not green, red check, test deletion, no debug leftovers) and the CRAP and mutation gates behind an adapter interface; the JS/TS adapter (vitest, Jest, Karma) proven on an Angular-style Jest fixture. |
| 0.2.0 | 2026-10-05 | The .NET adapter (adapters/dotnet): coverage and McCabe complexity per method from one dotnet test run with coverlet (Cobertura), mutants from Stryker.NET's json report, run with --runner dotnet; proven to bite on a class library with an xUnit test project (fixtures/dotnet-sample), and a missing dotnet exits 2. Proven here on Linux with the .NET 8 SDK and Stryker.NET 4.16; its last check happens on real work code at work. |
| 0.3.0 | 2026-10-06 | The host adapter (adapters/host): the CI and pull-request calls (CI on one exact commit, a draft PR, PR status with its blocking policies, work item read and state change) behind one interface, for GitHub through gh and for Azure DevOps through its REST API with a personal access token from AZURE_DEVOPS_PAT only; the F1 gate gates/ci-on-sha/gate.ts on that interface, with the same VERIFIED / FAILED / NOT-VERIFIED mapping on both hosts. Tested on replies in fixtures/azure-devops written from Microsoft's published API examples, never against a live service; adapters/host/README.md lists the calls, their sources and what is unverified. Its first live check happens at work. |
| 0.4.0 | 2026-10-06 | The environment adapter (adapters/environment): previewUrl, ready, errorRate, rollback and cleanup behind one interface, for Kubernetes through kubectl and optionally Helm behind an injected runner: a namespace or a Helm release per branch, its address from its Ingress, ready when kubectl rollout status finishes within the timeout, the error rate from Prometheus through the API server's service proxy, rollback by kubectl rollout undo or helm rollback, cleanup of only the branch's own namespace (proved by its branch annotation) or release. The reference's incident rule on it (adapters/environment/incident.ts): alert only unless the project config turns rollback on, then at most one automatic rollback in 24 h. docs/08-previews-kubernetes.md maps the preview and incident rules to Kubernetes. Tested on output in fixtures/kubernetes written from the Kubernetes, Helm and Prometheus docs and kubectl's source, never against a cluster; adapters/environment/README.md lists the sources and what is unverified. Its first live check happens at work. |
| 0.5.0 | 2026-10-06 | The SonarQube adapter (adapters/sonarqube): the analysis of one exact commit (a branch's by the commit its analysis names, a pull request's by the task the scanner submitted for it), its quality gate, the new-code issues and the new-code measures through SonarQube's Web API, with a token from SONAR_TOKEN only; gates/sonarqube/gate.ts gives the quality gate on the head commit as VERIFIED / FAILED / NOT-VERIFIED like F1, a stale analysis never a pass, and turns new-code issues into findings triaged like review findings, naming the gate of ours that checks the same thing; docs/09-sonarqube.md says where SonarQube overlaps our gates and what it does not check. Tested on replies in fixtures/sonarqube written from SonarQube's own example answers, never against a live server; adapters/sonarqube/README.md lists the calls, their sources and what is unverified. Its first live check happens at work. Also the security-rules gate (gates/sast): Semgrep 1.179.0 on the changed TypeScript, JavaScript and C# files, failing on a new ERROR finding, a suppression only line-level with its rule and a reason; the rules are pinned in gates/sast/rules/SNAPSHOT.json but not shipped, because their licence allows no redistribution: a team copies the pinned rule files in for its own use. |
| 0.5.1 | 2026-10-07 | The CodeRabbit fixes (its review of v0.5.0), each with a test. Fail-open paths closed: the Semgrep gate with --cwd a subfolder scanned nothing, as the changed files, the worktree and the base were read on different path bases (now all relative to the folder it runs in, names read with -z); the git guard resolves where a push really goes (remote.<name>.push, push.default, a refspec without :<dst>, and --repo, where the first positional wins), so main or master is blocked however it is spelled; the GitHub host reads every page of check runs, and a total_count above what was read throws; a parent statement that starts on a callback's line is CRAP-scored as the parent's (columns), so an untested parent no longer reads covered; untracked files with spaces or non-ASCII names are read (-z, not quotePath); the import-boundaries config resolves the project's tsconfig path aliases. Also: the red check keeps % literal for cmd.exe; a secret's excerpt shows at most a quarter of it; Semgrep rule ids are stripped to the last language folder; Prometheus answering success with no data throws with the query; a Stryker run killed before it finished is rejected, never read from its report; SonarQube reads a task with no branch key as the main branch's (asking api/project_branches/list) and a pull request's task as no branch's. Docs: separate contracts for command-line gates and hooks (03-gates.md), the research_request handoff, and the SonarQube states none and unbound as NOT-VERIFIED. |
| 0.6.0 | 2026-10-20 | Three changes that need no dispatcher. A project rules file: AGENTS.md.example (the owner's rules first, as placeholders, then the adopted fence, non-negotiables, autonomy, subagents, principles and upkeep rules, adjusted to run under the team's flow, each citing its source Vancouver style) and docs/10-agents-md.md on writing one. Owner consent as a gate (gates/consent, A8): a ticket is buildable only when its Agreed line quotes the owner choosing it, and a locked path changes only on the branch of such a ticket; the owner's name and the ticket folder are configuration (config/consent.json); the core has no imports so a harness hook can load it, and cli.ts (--staged or --base <ref>) runs in any pre-commit or CI. Locked files as a gate (gates/locks, A9): each locked file's SHA-256 in config/locks.lock, a change fails unless the branch builds an agreed ticket, --relock rewrites the manifest; the lock list is config/locks.json, by default the gates, their config, CI and the build and test files of a JS/TS or .NET repo. |
| 0.7.0 | 2026-10-20 | The remaining eight gates of the reference, each with its CLI exit contract (an unknown option exits 2), its tests and a prove-it-bites test, and its names and paths from configuration. The canary (gates/canary) reruns every prove-it-bites test and logs each gate's state; its log format is its own (io.ts) and the folders it searches are config/canary.json's, by default gates and adapters. Duplication (C5, jscpd on changed lines), the tool licence check (E4), the review schema and skeptic validators (E3), the prose lint (E5, a library), the supply-chain scan (F4, with config/supply-chain.json as a starting exception list), and the walk gate with the evidence gate it reads (gates/evidence). The tamper gate (A2): protected globs, the owner, the files to fingerprint as hooks (git's hooks folder when none are named) and an optional exception module come from config/tamper.json or --config; --state is optional. A config in the repo under check is read at the base (HEAD with --staged), with its tiers file, its exception module and the repo files that module imports (only plain relative imports and node: builtins; any other import form exits 2), and those policy files are protected too, so editing them in the working tree never loosens the gate. jscpd joins the package's dev dependencies. |
| 0.8.0 | 2026-10-21 | The gate runner (runner/): the self-gate that runs every gate in one command (typecheck, unit, integration, locked files, onkel's CRAP and mutation on the changed lines, and in merge mode Semgrep), its merge mode trusting a CI report at the exact commit (the report folder, the trusted checks, the ungraded paths and the CI variable are configuration) so a merge mutates only the lines the merge itself changed, the test selection over dependency-cruiser's graph plus the paths tests name (shared ground such as the lockfile selects every test), the whole-suite full run with its selection misses, the check-tree cache for a project's own checks (runner/runner-checks.ts: tree hash, check name, command and env-file hash), the portability and spawn-timeout checks, the package check, the pre-commit renderer, the single-writer lock, the function registry and ledger, the gate metrics and the tempo stats with the observation log they read. Everything tied to a repo is config/runner.json (integration branch, source and graph folders, whole-suite paths, integration tests, CRAP limit, Stryker config, shells, state folder, checks), each with a documented default; a repo's own merge check plugs in through mergeCheck. docs/12-runner.md says how to run it locally, in a pre-commit hook and in an Azure DevOps or GitHub pipeline. |
| 0.9.0 | 2026-10-21 | The flow tools (flow/, node flow/cli.ts <tool>): status with the builds in flight against the build cap, every model family counted together; the gate queue running config/flow.json's gate commands one gate at a time; build and review through one model-run, each family a build and a review command in config/flow.json, so Codex, Claude Code, opencode or a local model plug in alike, and the other-family rule: a round is reviewed by a configured family other than the one that built it, and the merge refuses a round reviewed only by its builder's family; the merge after the owner's yes, a green gate and that review, then the base into every open ticket branch (base-into), each typechecked in its own worktree and never force-pushed; the draft PR, the CI watch on one exact commit and the SHA ledger on GitHub or Azure DevOps through adapters/host; the queue, the evaluation, the gate lessons and the dispatcher modules they read (learn, tickets, run-guard, workflow-config, owner-choice, decisions); flow apply-lessons, which writes each lesson the owner accepted in the decisions file to the configured directives file, a skill or a gate ticket draft, with its approval id. Model and gate commands get their placeholders as environment variables, never in the command line, and the gate lock is one file under git's common directory for every worktree. config/flow.json holds the integration branch, the build cap (3), the owner, the ticket folder, the host, the families and the commands, and the lessons' decisions file, waiting folder, directives file and skills folder, each with a documented default (docs/02-flow-and-roles.md); 11-optimisations.md items 5-7 point at the code. |
