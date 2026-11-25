# Blueprint A: a gated agent workflow

**Release v1.0.0.** A dispatch router and twelve role skills, including evals, alongside docs,
quality gates and language adapters. The flow uses role subagents; the router calls the gates
when each role returns. The script flow, guard hooks, deleted gates and measurement tools from
v0.9.0 are retired. The skills remain Claude Code skills, while the gates run on Node alone. Work-harness wiring is
decided at work.

## What this is

A self-contained description of an AI-agent coding workflow in which **deterministic code
gates, not the model's own judgement, decide whether work may move on**. Agents with narrow
roles plan, write, clean and harden code; small programs with fixed exit codes check every step;
a human approves plans, accepts lessons and merges.

The owner chooses tasks and approves plans. The router starts specifier, coder, cleaner and
hardener subagents in order, runs their gates, then starts an independent reviewer and skeptic.
A preview walk and CI judge the exact head before integration. The scout proposes new work and
the briefing records results and choices. Details: [docs/02-flow-and-roles.md](docs/02-flow-and-roles.md).

The package contains:

- **`skills/`** holds the dispatch router and every role it names. Each folder is complete,
  including eval cases. Supply project configuration and directives at the installed root.
- **`docs/`** describes concepts, contracts and reasons. It carries no code for any particular
  agent harness. It was distilled from a working reference build on another harness and from an
  analysis of five public agent workflows, but you need neither to use it.
- **`gates/` and `adapters/`** are the gates that need no harness and no particular language, as
  code: command-line programs and callable gate libraries. **`runner/`** runs them: the
  self-gate and its merge mode, the test selection, the check-tree cache and the checks, with
  everything tied to a repo in `config/runner.json` ([docs/12-runner.md](docs/12-runner.md)). Most CLIs print one JSON object and
  exit 0 (pass), 1 (fail) or 2 (could not run); the output exceptions are listed below. They run on
  Node alone (22.18 or later; TypeScript runs as is, no build step). Each
  keeps its tests and a prove-it-bites test.

## First run

1. Run `npm ci`, then `npm run install:skills` to install `/dispatch` for Claude Code and bind
   `{{WORKFLOW_ROOT}}` to this package's absolute path. Keep the package at that path.
2. Copy `AGENTS.md.example` to `AGENTS.md` and fill in the owner's rules and locked-file list.
3. Copy `project.json.example` to `projects/<name>/project.json`. Edit the repo, tracker,
   branch, safety, commands and role settings for your project. The example uses JS/TS commands;
   use the .NET alternatives below when needed. Confirm safety settings with the owner.
4. Open Claude Code in the project and type `/dispatch`.

For .NET, use `dotnet format --verify-no-changes`, `dotnet build --no-restore`, `dotnet test`
and `dotnet build` as lint, typecheck, test and build commands. Replace the hardener's onkel
command with `node "{WORKFLOW}/gates/test-strength/cli.ts" crap --runner dotnet src/App.cs`
and a second check using `mutation --runner dotnet src/App.cs`. Set the actual source paths.
Configure the red check with a test command that emits the required JSON report; `dotnet test`
alone does not do that. Verify each configured gate against your project's real test output.
Omit `walk` when no preview exists, and omit `neon` unless the project uses Neon.

## The gates in this package

| Gate | Folder | Contract |
|---|---|---|
| Secret scan | `gates/secret-scan` | C2: no secret in the lines a change adds |
| Hidden Unicode | `gates/hidden-unicode` | C3: no invisible or direction-changing character in added lines |
| Import boundaries | `gates/boundaries` | C4: no import cycle, no import that resolves to nothing |
| Duplication | `gates/duplication` | C5: no clone (jscpd) with a line the change added |
| Four checks | `gates/four-checks` | C1: the project's lint, typecheck, test and build all green |
| Skipped tests are not green | `gates/four-checks/skips-cli.ts` | C1: no more tests with status `skipped`, `pending`, `todo` or `disabled` than at the base |
| Red check | `gates/red-check` | D1: a new test must fail on the base code (and zero tests is a fail) |
| Test-deletion guard | `gates/test-deletion` | D2: no test present at base may disappear unless allowed by file or `file::title`; a plan's Delete section must name a replacing test present on the branch (ticket 70) |
| No debug leftovers | `gates/debug-leftovers` | No added `console.log`, `console.debug` or `debugger`, or Python `print(`, `breakpoint(` or pdb, outside tests |
| CRAP and mutation | `gates/test-strength` + `adapters/js-ts`, `adapters/dotnet` or `adapters/python` | D3: every function CRAP ≤ 6, every mutant killed, through a language adapter |
| CRAP and mutation on changed lines | `gates/onkel`, `gates/hardener/gate.ts` | D3, scoped to the lines a change touched (vitest projects) |
| Canary | `gates/canary` | D5: every prove-it-bites test still passes clean input, fails the injected fault and passes the revert; each gate's state is logged |
| Plan gate | `gates/plan` | E1: plan lint, cross-artifact, EARS criteria, command allow list |
| CI green on the exact commit | `gates/ci-on-sha/gate.ts` + `adapters/host` | F1: CI green on the very commit being shipped, on GitHub or Azure DevOps |
| Supply-chain scan | `gates/supply-chain` | F4: every new or changed lockfile package has an allowed licence or a written exception, and runs an install script only if listed (`config/supply-chain.json`) |
| Walk gate | `gates/walk` + `gates/evidence` | F5: a walk of the preview is cited, bound to the head and patch-id, complete, with evidence matching each criterion |

`gates/lib` holds the shared contract (`contract.ts`), the diff reader and the git helpers;
`test/helpers/prove-it-bites.ts` the clean → injected → reverted check every gate is proven with.
Project-specific gate commands and safety settings come from project configuration. The package
ships runner, supply-chain, canary and package-check settings for its own gates. Adapt those to
your repository; no private project configuration is shipped.
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

`adapters/python` implements the same calls for Python: one pytest run under coverage.py gives
each function's own lines (its per-function regions, coverage 7.10 or later), `radon cc -j` its
complexity, joined by the function's first line; cosmic-ray gives the mutants, after its baseline.
A failed baseline or an incompetent mutant (the test command never ran) exits 2. A path may be a
folder of `.py` files, and `--base` holds the mutants to the lines changed since that ref:

```sh
node gates/test-strength/cli.ts crap     --runner python --cwd <project> src/app/pricing.py
node gates/test-strength/cli.ts mutation --runner python --cwd <project> --base origin/main src
```

The tools (pytest, coverage, radon, `cosmic-ray==8.9.0`, and for the other Python gates bandit,
pip-audit and import-linter) are the project's dev dependencies, found in the nearest `.venv` at or
above the project folder, or the Python `WORKFLOW_PYTHON` names (3.10 or later); a missing one
exits 2 with its `pip install` command. Role commands run that same Python through
`node adapters/python/run.ts -m <tool> …`.
`adapters/python/bites.integration.test.ts` proves both gates bite on `fixtures/python-sample`.
The red check (`--junit`), skipped tests, the test-deletion guard, debug leftovers, boundaries
(`--python`), SAST (bandit) and supply chain (pip-audit) read Python too;
`projects/sample-python/project.json` wires them (`adapters/python/project.integration.test.ts`
runs every one of its checks), and
`templates/ci/python-github.yml` and `templates/ci/python-azure.yml` are the CI side. See
[docs/03-gates.md](docs/03-gates.md).

### The host adapter

The CI and pull-request gates read only five calls (`adapters/host/host.ts`):
`checksForCommit(sha)`, `openDraftPr(branch, base, title, body)`, `prStatus(id)`, `workItem(id)` and
`setWorkItemState(id, state)`. `adapters/host/github.ts` answers them through the `gh` CLI,
`adapters/host/azure-devops.ts` through Azure DevOps' REST API, with a personal access token read
from the `AZURE_DEVOPS_PAT` environment variable only (without it, every call exits 2 naming the
variable; the token never appears in output). A draft pull request on Azure DevOps is created
with `isDraft: true` and never set to complete itself. `gates/ci-on-sha/gate.ts` is the F1 gate on
that interface; its CLI and the hardener CLI are shipped for the router.
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

## Who it is for

You, sitting with a different agent harness (for example an opencode-style harness with agents,
commands and plugins) and a local model, wanting to build the same kind of gated workflow there. The package includes
Claude Code role skills and a router; their work-harness wiring is decided at work.
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
10. [docs/10-agents-md.md](docs/10-agents-md.md): the project's `AGENTS.md` (from
    `AGENTS.md.example`) and owner-consent and lock concepts retired as executable gates in v1.0.0
11. [docs/11-optimisations.md](docs/11-optimisations.md): eight measured changes that cut gate and
    build time without weakening a gate, each with how to build it
12. [docs/12-runner.md](docs/12-runner.md): the gate runner that does five of them, run locally, in
    a pre-commit hook and in a GitHub or Azure DevOps pipeline, and every `config/runner.json` field

## Run it

```sh
npm ci                     # installs only what the gates need: no agent harness
npm test                   # every gate's unit tests and fast prove-it-bites tests
npm run test:integration   # the slow bites tests with real Stryker, vitest and Jest
npm run typecheck
npm run gate -- --base main   # every gate on the change since main (the gate runner, runner/)
npm run checks                # config/runner.json's checks, reused on an unchanged tree
```

`npm ci` works with npm 10 and 11. To change dependencies and write a new lockfile, use npm 11 or
later (it comes with Node 24): npm 10 fails to resolve vitest's optional peers here.
`package.json` overrides `test-exclude` to its current major, so Jest's coverage does not pull in a
deprecated `glob`.

Each CLI's header lists its arguments. For example, run
`node gates/secret-scan/cli.ts --staged` in a pre-commit hook, or
the configured role checks when a subagent returns.
The red check's test command must emit Vitest/Jest JSON naming the requested file with a failed assertion; the default
is `npx vitest run --reporter=json`. Set `--test-command "npx jest --json"` for Jest. An import
or configuration error alone does not prove a test red.
For planned test deletions, pass `--plan <file>` to the test-deletion CLI and list each under
`## Delete` as `- Test: old.test.ts::title -> replacement.test.ts::title`.

## Import the zip into your company's host

The release is `blueprint-a-v<version>.zip`, holding one folder, `blueprint-a/`. To start a
repository from it:

1. Unpack it and turn the folder into a repository:

   ```sh
   cd blueprint-a
   git init -b main
   git add -A
   git commit -m "Blueprint A v1.0.0"
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

- **Start small.** The first useful slice is: one coder subagent and the four basic checks (lint,
  typecheck, tests, build), run by the router when it returns. A second red goes to you. Everything else can be added gate by gate.
- **Keep instructions short.** Weaker local models follow short, concrete role briefs better
  than long prose. The gates carry the rigour, so the prompts do not have to.
- **Read each gate's contract.** Most command-line gates print one JSON object and exit 0
  (pass), 1 (fail) or 2 (could not run). `skips-cli.ts` passes through the test command's output
  and exit status, adding skip-guard failures; `node gates/onkel/run.ts <path...>` prints a human report by
  default and accepts `--json <path>` for its report file. Library-only gates return objects
  to the harness. The usage comment at each CLI's top lists its arguments.
- **Prove every gate bites** before you trust it (see [docs/01-principles.md](docs/01-principles.md)).
- **Run the gates outside the agent too.** A git pre-commit hook running the same gate programs
  is a backstop that works in any harness, even one with no hook points at all.
- **Do not re-run unchanged checks.** In the pilot, 58% of a build's time was checks repeated on
  code that had not changed ([docs/04-flow-control.md](docs/04-flow-control.md)).

## What is deliberately not here

- No script dispatcher or agent hooks. `skills/dispatch` is a Claude Code router skill,
  accompanied by all twelve role skill folders and their evals. It starts fresh subagents and
  runs the executable gates when they return. Mapping those skills to another harness is work
  to do at work. The retired script flow and measurement tools remain in v0.9.0.
  [MIRROR.md](MIRROR.md) lists every part of the reference build that was left out, and why.
- No secrets, personal paths, private project names or links to private repositories. The
  folder is scanned for these before it leaves the reference repository.
- No vendored third-party text. Ideas taken from other workflows and authors are paraphrased and
  credited by name in [docs/05-decisions.md](docs/05-decisions.md) and in [LICENSE](LICENSE).

## Credits

Sources of ideas, paraphrased here:

- Robert C. Martin (Uncle Bob): [Agentic Discipline](https://cleancoders.com) and his [crap4* and mutate4* repositories](https://github.com/unclebob) inspired the CRAP-and-mutation hardening gate (onkel). No code or text was taken, since those repositories carry no licence.
- pstack: coordinator roles, verdicts tied to an exact commit, retry tables, pull-request state machines and plan linting.
- ECC: tool-blocking hooks, shell-parsing guards, secret and hidden-Unicode scans, and hook hygiene.
- [Matt Pocock's skills](https://github.com/mattpocock/skills): skill style, router skill and wayfinder.
- [backnotprop/product-engineering](https://github.com/backnotprop/product-engineering): the pe-verify walk.

These are idea credits, consistent with the attribution in [LICENSE](LICENSE); no source code or
text from these sources is included.

## Licence

MIT; see [LICENSE](LICENSE).
