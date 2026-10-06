# MIRROR

Blueprint A **v0.5.0**, exported one way from the reference repository at commit `bd8306b38365` by its
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
| `gates/evidence/report.ts` | `gates/evidence/report.ts` |
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

## Left out, and why

| Path | Why |
|---|---|
| `dispatcher/` | the controller and its roles run Claude Code sessions (decision 23: no dispatcher) |
| `skills/` | role skills written for Claude Code (decision 23: no skills) |
| `agents/` | Claude Code agent definitions |
| `adapters/claude-code/` | Claude Code's hook scripts (decision 23: no hooks); the git rules and shell reader they use are here in gates/git-guard |
| `gates/hardener/cli.ts` | wires the reference repo's own self-gate; gate.ts is here, a harness wires its own shell |
| `briefing/` | the reference's morning briefing page, built from its own state and logs |
| `watchers/` | incident and upstream watchers, tied to the reference's hosting and upstream list; the incident rule on Kubernetes is in adapters/environment/incident.ts |
| `scripts/` | the reference repo's own tooling (self-gate, ledger, pull requests, cloud sessions, this export) |
| `projects/` | per-project settings of the reference |
| `config/` | the reference's own settings; only the dependency-cruiser rules the boundaries gate reads are here |
| `gates/canary/` | reruns the reference repo's own prove-it-bites tests on a schedule |
| `gates/ci-on-sha/cli.ts` | wires the reference repo's gh runner and project settings; gate.ts and the host adapters it reads (adapters/host) are here, a harness wires its own shell |
| `gates/sonarqube/cli.ts` | wires the reference repo's project settings and HTTP client; gate.ts and the SonarQube adapter it reads (adapters/sonarqube) are here, a harness wires its own shell |
| `gates/sonarqube/run.ts` | reads the reference repo's project settings for its shell; a harness wires the adapter, its wait and the gate itself |
| `gates/supply-chain/` | reads GitHub through gh; the work host is an open question (06-open-questions.md, section 7) |
| `gates/review-schema/` | checks the reference's reviewer output; the review roles are not exported in v0.1 |
| `gates/walk/` | walks a deployed preview app with the reference's evidence and Playwright wiring; the environment adapter (adapters/environment) gives a Kubernetes preview's address and readiness, and the walk itself is a harness choice (08-previews-kubernetes.md) |
| `gates/research/` | the researcher role's gate; only the claim shapes the plan gate reads are here |
| `gates/evidence/` | the reference's evidence runs; only the report format the plan gate reads is here |
| `gates/duplication/` | not in v0.1: a clone detector per language is still to choose (06-open-questions.md, section 3) |
| `gates/licence/` | not in v0.1: licence rules differ per company |
| `gates/slop-lint/` | not in v0.1: prose lint is optional (03-gates.md, E5) |
| `gates/tamper/` | not in v0.1: it guards the reference's own tier-4 files |
| `gates/sast/rules/csharp/` | Semgrep's C# rule files: the Semgrep Rules License v1.0 allows internal use and no redistribution, so the export carries their pin (gates/sast/rules/SNAPSHOT.json: Semgrep version, semgrep-rules commit, every file and rule) and gates/sast/rules/README.md says how a team copies them in |
| `gates/sast/rules/javascript/` | Semgrep's JavaScript and TypeScript rule files, left out for the same licence; pinned in SNAPSHOT.json |
| `gates/sast/rules/typescript/` | Semgrep's TypeScript rule files, left out for the same licence; pinned in SNAPSHOT.json |
| `gates/sast/snapshot.test.ts` | checks the rule files against SNAPSHOT.json, and the rule files are not exported |

## Changed on the way out

- Relative imports pointed at where their files land here: 3 files.
- the pilot project's name: replaced in 3 places.
- a pilot project's ticket path: replaced in 1 places.
- the owner's first name, possessive: replaced in 29 places.
- the owner's first name: replaced in 17 places.
- this machine's checkout folder in recorded test reports: replaced in 3 places.
- the owner's first name in a file name: replaced in 0 places.
- the owner's first name in a code name: replaced in 22 places.

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
