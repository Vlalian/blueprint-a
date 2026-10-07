# Blueprint A: a gated agent workflow, harness-neutral

**Release v0.5.** Docs plus the gates as code, with test-strength adapters for JS/TS and .NET, host adapters for GitHub and Azure DevOps, an environment adapter for previews and incidents on Kubernetes, and a SonarQube adapter. The reference build of this workflow has run its
first real end-to-end pilot; the docs carry its numbers. Anything still marked
**(to confirm after the pilot)** is a design choice or a number the pilot did not settle;
[MIRROR.md](MIRROR.md) lists each one, and what was resolved.

## What this is

A self-contained description of an AI-agent coding workflow in which **deterministic code
gates, not the model's own judgement, decide whether work may move on**. Agents with narrow
roles plan, write, clean and harden code; small programs with fixed exit codes check every step;
a human approves plans, accepts lessons and merges.

The flow in one line: the human starts a run → a dispatcher script fills a few controller slots →
each controller drafts a plan, the plan gates check it, **the human approves it** → a specifier
writes failing tests, a coder makes them pass, a cleaner tidies, a hardener strengthens the tests,
and a stop gate refuses "I am done" until that role's gates are green (escalating to the human
after two red stops) → a batch review with a skeptic → a verdict for the exact commit, CI green
on that commit, a draft pull request → **the human merges**. A briefing tells the human what the
agents decided and what they learned. Details: [docs/02-flow-and-roles.md](docs/02-flow-and-roles.md).

The package has two halves:

- **`docs/`** describes concepts, contracts and reasons. It carries no code for any particular
  agent harness. It was distilled from a working reference build on another harness and from an
  analysis of five public agent workflows, but you need neither to use it.
- **`gates/` and `adapters/`** are the gates that need no harness and no particular language, as
  code: command-line programs that print one JSON object and exit 0 (pass), 1 (fail) or 2 (could
  not run). They run on Node alone (22.18 or later; TypeScript runs as is, no build step). Each
  keeps its tests and a prove-it-bites test.

## The gates in this package

| Gate | Folder | Contract |
|---|---|---|
| Secret scan | `gates/secret-scan` | C2: no secret in the lines a change adds |
| Hidden Unicode | `gates/hidden-unicode` | C3: no invisible or direction-changing character in added lines |
| Git guard | `gates/git-guard` | A1: no force push, push to main, hook bypass, merge or "ready" by an agent |
| Import boundaries | `gates/boundaries` | C4: no import cycle, no import that resolves to nothing |
| Four checks | `gates/four-checks` | C1: the project's lint, typecheck, test and build all green |
| Skipped tests are not green | `gates/four-checks/skips-cli.ts` | C1: no more skipped or todo tests than at the base |
| Red check | `gates/red-check` | D1: a new test must fail on the base code (and zero tests is a fail) |
| Test-deletion guard | `gates/test-deletion` | D2: no test present at base may disappear |
| No debug leftovers | `gates/debug-leftovers` | No added `console.log`, `console.debug` or `debugger` outside tests |
| CRAP and mutation | `gates/test-strength` + `adapters/js-ts` or `adapters/dotnet` | D3: every function CRAP ≤ 6, every mutant killed, through a language adapter |
| CRAP and mutation on changed lines | `gates/onkel`, `gates/hardener/gate.ts` | D3, scoped to the lines a change touched (vitest projects) |
| Plan gate | `gates/plan` | E1: plan lint, cross-artifact, EARS criteria, command allow list |
| Handoff gate | `gates/handoff` | E2: machine-valid handoffs between roles |
| CI green on the exact commit | `gates/ci-on-sha/gate.ts` + `adapters/host` | F1: CI green on the very commit being shipped, on GitHub or Azure DevOps |
| SonarQube's quality gate on the exact commit | `gates/sonarqube/gate.ts` + `adapters/sonarqube` | VERIFIED / FAILED / NOT-VERIFIED like F1, from the analysis of the very commit being shipped; new-code issues as findings |

`gates/lib` holds the shared contract (`contract.ts`), the diff reader and the git helpers;
`test/helpers/prove-it-bites.ts` the clean → injected → reverted check every gate is proven with.
The full contracts, including the gates that are only described, are in
[docs/03-gates.md](docs/03-gates.md).

### The adapter interface

The test-strength gates read only three calls (`gates/test-strength/contract.ts`):
`coverage(paths)` → each function's lines and how many the tests ran; `complexity(paths)` → each
function's cyclomatic complexity; `mutate(paths)` → each mutant with its status. `adapters/js-ts`
implements them with the TypeScript compiler, one coverage run of the project's tests, and
Stryker:

```sh
node gates/test-strength/cli.ts crap     --runner jest   --cwd <project> src/app/price.service.ts
node gates/test-strength/cli.ts mutation --runner vitest --cwd <project> src/sign.ts
node gates/test-strength/cli.ts crap     --runner karma  --cwd <project> --coverage coverage/coverage-final.json src/app/x.ts
```

Karma has no coverage command of its own here: the project's `karma.conf.js` writes istanbul json
with karma-coverage, and the gate is handed that file. The project needs the tools the adapter
starts (Stryker and its runner plugin, the test runner) in its own `node_modules`.
`adapters/js-ts/angular.integration.test.ts` proves both gates bite on an Angular-style service
tested with Jest.

`adapters/dotnet` implements the same calls for .NET: one `dotnet test` run with coverlet's
collector gives each method's lines and, from its branch points, its McCabe complexity
(Cobertura XML); Stryker.NET gives the mutants (its json report). Run it from the folder with the
solution or test project; paths are the source files, relative to that folder:

```sh
node gates/test-strength/cli.ts crap     --runner dotnet --cwd <solution folder> src/Billing/Invoice.cs
node gates/test-strength/cli.ts mutation --runner dotnet --cwd <solution folder> src/Billing/Invoice.cs
node gates/test-strength/cli.ts crap     --runner dotnet --cwd <solution folder> --coverage coverage.cobertura.xml src/Billing/Invoice.cs
```

The project needs the .NET SDK (8 or later) on PATH, `coverlet.collector` in every test project,
and Stryker.NET as a local tool (`dotnet tool install dotnet-stryker` once, `dotnet tool restore`
on each machine). Without `dotnet` the gate exits 2 and says what to install.
`adapters/dotnet/bites.integration.test.ts` proves both gates bite on `fixtures/dotnet-sample`, a
class library with an xUnit test project; it is skipped, with that message, where there is no
`dotnet`. It was proven on Linux; its last check happens on real work code at work.

### The host adapter

The CI and pull-request gates read only five calls (`adapters/host/host.ts`):
`checksForCommit(sha)`, `openDraftPr(branch, base, title, body)`, `prStatus(id)`, `workItem(id)` and
`setWorkItemState(id, state)`. `adapters/host/github.ts` answers them through the `gh` CLI,
`adapters/host/azure-devops.ts` through Azure DevOps' REST API, with a personal access token read
from the `AZURE_DEVOPS_PAT` environment variable only (without it, every call exits 2 naming the
variable; the token never appears in output). A draft pull request on Azure DevOps is created
with `isDraft: true` and never set to complete itself. `gates/ci-on-sha/gate.ts` is the F1 gate on
that interface; a harness wires its own command line around it, as with the hardener.
`adapters/host/README.md` lists every Azure DevOps call with its Microsoft reference page and
what is still unverified: the tests run on replies in `fixtures/azure-devops/`, written in the
shape of Microsoft's published examples, and the first live check happens at work.

### The environment adapter

The preview, walk-the-app and incident steps read five calls (`adapters/environment/environment.ts`):
`previewUrl(branch)`, `ready(branch)`, `errorRate(release, window)`, `rollback(release)` and
`cleanup(branch)`. `adapters/environment/kubernetes.ts` answers them with `kubectl` (and Helm, in
helm mode) behind an injected runner: a namespace or a Helm release per branch, its address from
its Ingress, ready when `kubectl rollout status` finishes within the timeout, the error rate from
Prometheus through the API server's service proxy, rollback by `kubectl rollout undo` or `helm
rollback`, and cleanup of only the branch's own namespace or release.
`adapters/environment/incident.ts` is the reference's incident rule on that interface: alert only,
unless the project config turns rollback on; then at most one automatic rollback in 24 hours.
[docs/08-previews-kubernetes.md](docs/08-previews-kubernetes.md) maps the rules;
`adapters/environment/README.md` lists every command with its source and what is unverified. The
tests run on output in `fixtures/kubernetes/`, never against a cluster; the first live check
happens at work.

### The SonarQube adapter

The sonarqube gate reads SonarQube through four calls (`adapters/sonarqube/sonarqube.ts`):
`analysisFor(sha, ref)`, `qualityGate(ref)`, `newIssues(ref)` and `newCodeMeasures(ref)`.
It waits for the analysis of the exact head commit and gives F1's verdicts:
- `VERIFIED`: the analysis passed its quality gate.
- `FAILED`: it failed, with the conditions that failed.
- `NOT-VERIFIED`: the analysis is still running, only an older commit was analysed, or the
  analysis failed. A stale analysis is never a pass.

A branch's analysis is matched by the commit it names. A pull request's analysis is matched by the
task the scanner submitted for the commit (`ceTaskId` in `report-task.txt`): SonarQube's Web API
names no commit for a pull request analysis.

The server and project key come from the project's settings, and the token from the `SONAR_TOKEN`
environment variable only. Without it the gate exits 2 naming the variable, and the token never
appears in output.

Each new-code issue becomes a finding with source `sonarqube`, triaged as a real defect, style or a
false alarm. A finding of a kind one of our gates checks names that gate. `adapters/sonarqube/findings.ts`
compares SonarQube's findings with ours on the same commit.

[docs/09-sonarqube.md](docs/09-sonarqube.md) covers where SonarQube and our gates overlap, what
SonarQube does not check, and its editions. `adapters/sonarqube/README.md` lists every call, its
source and what is unverified. The tests run on replies in `fixtures/sonarqube/`, written in the
shape of SonarQube's own example answers, and the first live check happens at work.

## Who it is for

You, sitting with a different agent harness (for example an opencode-style harness with agents,
commands and plugins) and a local model, wanting to build the same kind of gated workflow there.
The intended use is a conversation: give your local LLM this folder, ask it to explain the flow
back to you, then work through [docs/06-open-questions.md](docs/06-open-questions.md) together and
decide how each piece maps onto your harness and your hosts.

**Make no assumptions about how your harness works.** Where this package says "pre-tool event"
or "stop event", it means a generic hook point: a place where the harness lets a small program
look at what the agent is about to do (or at the agent declaring itself finished) and refuse it.
Find out with your LLM whether and how your harness offers such points before designing around
them. The gates themselves do not care: a hook, a script, a pre-commit hook or a CI step can run
them.

## Read order (about 40 minutes)

1. [docs/01-principles.md](docs/01-principles.md): the ideas everything else rests on (5 min)
2. [docs/02-flow-and-roles.md](docs/02-flow-and-roles.md): who does what, in which order, and
   what they hand each other (10 min)
3. [docs/03-gates.md](docs/03-gates.md): every gate as a contract: purpose, input, output, exit
   codes, what makes it fail, how to prove it bites, and which ones are code here (15 min)
4. [docs/04-flow-control.md](docs/04-flow-control.md): retries, caps, escalation, state and logs,
   with the pilot's numbers (5 min)
5. [docs/05-decisions.md](docs/05-decisions.md): the decisions behind the design, with reasons
   (5 min)
6. [docs/06-open-questions.md](docs/06-open-questions.md): what you and your LLM still have to
   decide, including the adapters for GitHub, Azure DevOps and Kubernetes
7. [docs/07-glossary.md](docs/07-glossary.md): terms used throughout; look things up as needed
8. [docs/08-previews-kubernetes.md](docs/08-previews-kubernetes.md): previews, the walk and the
   incident rule mapped to Kubernetes, when you get to them
9. [docs/09-sonarqube.md](docs/09-sonarqube.md): reading SonarQube's quality gate, where it
   overlaps our gates and what it does not check (when work runs SonarQube)

## Run it

```sh
npm ci                     # installs only what the gates need: no agent harness
npm test                   # every gate's unit tests and fast prove-it-bites tests
npm run test:integration   # the slow bites tests with real Stryker, vitest and Jest
npm run typecheck
```

`npm ci` works with npm 10 and 11. To change dependencies and write a new lockfile, use npm 11 or
later (it comes with Node 24): npm 10 fails to resolve vitest's optional peers here.
`package.json` overrides `test-exclude` to its current major, so Jest's coverage does not pull in a
deprecated `glob`.

Each gate prints its usage when started without arguments, for example
`node gates/secret-scan/cli.ts --staged` in a pre-commit hook, or
`node gates/git-guard/cli.ts --branch feature/x "git push --force"` from a pre-tool hook.

## Import the zip into your company's host

The release is `blueprint-a-v<version>.zip`, holding one folder, `blueprint-a/`. To start a
repository from it:

1. Unpack it and turn the folder into a repository:

   ```sh
   cd blueprint-a
   git init -b main
   git add -A
   git commit -m "Blueprint A v0.5.0"
   ```

2. Create an empty repository on the host, with no README or licence, so the first push is not
   refused:
   - **GitHub (or GitHub Enterprise):** New repository, then
     `git remote add origin https://<host>/<org>/blueprint-a.git`.
   - **Azure Repos:** in the Azure DevOps project, Repos → New repository (uncheck "Add a
     README"), then `git remote add origin https://dev.azure.com/<org>/<project>/_git/blueprint-a`.
3. `git push -u origin main`, then `npm ci && npm test` on a fresh clone to see it stand alone.

For a later release, unpack the new zip over a clean checkout, review the diff (MIRROR.md says
what changed), commit it as one change and tag it `v<version>`. The package is exported one way:
make changes to it in the reference and export again, or fork it at work and stop taking releases.

## How to use it with a local model

- **Start small.** The first useful slice is: one coder agent, the four basic checks (lint,
  typecheck, tests, build) wired to the stop event, and a counter that escalates to you after two
  blocked stops. Everything else can be added gate by gate.
- **Keep instructions short.** Weaker local models follow short, concrete role briefs better
  than long prose. The gates carry the rigour, so the prompts do not have to.
- **Let gates speak JSON.** Every gate prints one JSON object and exits 0, 1 or 2. That is the
  only interface the agents and the controller need, whatever the harness.
- **Prove every gate bites** before you trust it (see [docs/01-principles.md](docs/01-principles.md)).
- **Run the gates outside the agent too.** A git pre-commit hook running the same gate programs
  is a backstop that works in any harness, even one with no hook points at all.
- **Do not re-run unchanged checks.** In the pilot, 58% of a build's time was checks repeated on
  code that had not changed ([docs/04-flow-control.md](docs/04-flow-control.md)).

## What is deliberately not here

- No agent harness: no dispatcher, controller, role skills or hooks for any particular harness.
  [MIRROR.md](MIRROR.md) lists every part of the reference build that was left out, and why.
- No secrets, personal paths, private project names or links to private repositories. The
  folder is scanned for these before it leaves the reference repository.
- No vendored third-party text. Ideas taken from other workflows and authors are paraphrased and
  credited by name in [docs/05-decisions.md](docs/05-decisions.md) and in [LICENSE](LICENSE).

## Licence

MIT; see [LICENSE](LICENSE).
