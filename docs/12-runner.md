# The gate runner

`runner/` is the code that makes the gates fast enough to run on every change: one command runs
every gate, a merge trusts a verified report at the exact commit, only the tests a change can
reach run, and a check is never run twice on the same tree. It is the reference build's own
self-gate, with everything tied to that repo moved into `config/runner.json`.
[11-optimisations.md](11-optimisations.md) says why each part pays off; this page says how to run it.

## What is in it

| Part | Files | What it does |
|---|---|---|
| Self-gate | `runner/self-gate.ts`, `self-gate-main.ts`, `self-gate-core.ts`, `self-gate-run.ts` | Typecheck, unit tests, integration tests (with `--integration`), the locked-files gate, then onkel (CRAP and mutation) on the source files changed since the base. Prints each stage's verdict and time, logs one observation per stage |
| Merge mode | `runner/self-gate.ts --merge <branch>`, `ci-report.ts`, `merge-check.ts` | One unit run with coverage, the selected tests only, Semgrep on the changes (`gates/sast`), and mutation of only the lines the merge itself changed when the branch's CI report can be trusted |
| CI report | `runner/ci-report.ts` | What a branch's gate run found (base, head, clean tree, verdict, mutants, survivors, highest CRAP), written as `<report.dir>/<report.name>` (by default `<branch>.gate.json`) and committed on the branch |
| Test selection | `runner/self-gate-select.ts`, `affected-deps.ts`, `selection.ts`, `selection-records.ts` | The tests a change can reach over dependency-cruiser's graph plus the paths tests name at run time; every test when the change touches shared ground or the graph cannot say |
| Full run | `runner/full-run.ts`, `full-run-main.ts` | The whole suite as the safety net under the selection; a failing test no merge selected is logged as a selection miss |
| Check-tree cache | `runner/runner-checks.ts`, `runner-checks-core.ts` | The project's own checks (`checks`), each reused when it already passed on the same tree, command and env file |
| Checks | `runner/portability.ts`, `spawn-timeouts.ts`, `check-package.ts`, `install-pre-commit-core.ts`, `lock.ts`, `locks.ts` | Windows portability rules, spawn timeouts in tests, the package check for a folder about to leave the repo, the pre-commit renderer (`adapters/git/pre-commit.template`), the single-writer lock, the lock manifest writer |
| Function registry | `runner/functions-core.ts`, `function-ledger-core.ts`, `prices-core.ts`, `function-records.ts` | Every function the workflow runs with its log id, and what each costs |
| Metrics | `runner/gate-metrics-core.ts`, `tempo.ts`, `tempo-records.ts`, `observations.ts`, `sast-records.ts` | Per-gate catches, escapes, false alarms and cost; build and merge times and pacing; the observation log they all read |

## config/runner.json

Every field is optional; a field left out keeps its default, and a field of the wrong type stops
the run (exit 2) naming it. Path patterns are a folder ending in `/`, a file name, or a name with
`*` standing for any characters but `/`.

| Field | Default | Meaning |
|---|---|---|
| `integrationBranch` | `main` | The branch merges go into; the self-gate's base when `--base` is not given |
| `sourceDirs` | `["src"]` | The folders whose TypeScript is graded (CRAP and mutation) |
| `graphDirs` | `["src", "test"]` | The folders dependency-cruiser walks for the test selection |
| `wholeSuite` | `package.json`, `package-lock.json`, `tsconfig*.json`, `vitest*.config.ts`, `test/helpers/`, `config/` | Shared ground: a change to one runs every test |
| `integrationTests` | `{ "suffix": ".integration.test.ts", "config": "vitest.integration.config.ts" }` | How an integration test is named, and the vitest config that runs them |
| `crapLimit` | `6` | The highest CRAP score a graded function may have |
| `strykerConfig` | `config/runner.json` | The JSON file whose `stryker` object holds `timeoutMS`, `timeoutFactor` and `dryRunTimeoutMinutes` |
| `report` | `{ "dir": "gate-reports", "trusted": ["mutation"], "ungraded": ["docs/"], "env": "CI", "name": "{branch}.gate.json" }` | The CI report's folder; the checks a merge may trust from it (`[]` trusts none); the paths that may change after it without making it stale; the variable that is `true` in the CI run that writes it; its file name, where `{branch}` (required) is the branch with `refs/heads/` or a remote prefix (`origin/`, `refs/remotes/<remote>/`) dropped and its slashes as dashes |
| `mergeCheck` | `""` | A module of the repo whose export `mergeCheck` the merge mode also asks (below) |
| `exempt` | `[]` | Process shells never mutated, by path; a shell can also declare itself with a line `// @process-shell` in its header |
| `sandboxIgnore` | `[]` | Folders Stryker's sandbox leaves out |
| `stateDir` | `state` | Where the logs and the check cache live; `WORKFLOW_STATE_DIR` overrides it. Keep it in `.gitignore`, or a cache write changes the tree it was keyed by |
| `busyLock` | `runner.lock` | A file in the state folder that means a run is under way; the idle full run waits for it |
| `checks` | `{}` | The project's checks for `runner/runner-checks.ts`, by name, each a shell command |
| `alwaysRun` | `[]` | Checks never taken from the cache |
| `envFile` | `""` | The env file the checks run with (its hash is part of the cache key); `""` for none |

The package carries its own `config/runner.json`, for running the runner on this package.

## Run it locally

```sh
npm run gate -- --base main                  # every gate on the change since main
npm run gate -- --base main --integration    # and the integration tests
npm run gate -- --base main --report my-branch   # and write gate-reports/my-branch.gate.json
npm run checks                               # the project's checks, cached by tree
node runner/full-run.ts --why promote        # the whole suite, logging selection misses
```

Exit 0 when every stage passes, 1 when one fails, 2 when one could not run. The summary lists
each stage with its time, the tests selected and why, which mutation ran and why, onkel's kills,
Stryker's timeouts and the ten slowest test files.

## In a pre-commit hook

`runner/install-pre-commit-core.ts` renders `adapters/git/pre-commit.template`: the secret,
hidden-Unicode, tamper and locked-files gates on the staged change, then the project's own checks.
Name the cached checks as the project check, so a commit on a tree the last run already judged
waits for nothing:

```sh
node runner/runner-checks.ts
```

A check that passed is stored under `<state>/check-cache/<project>/<tree>.json`, keyed by the
check's name, its command and the env file's hash; a failing check is never stored, and an
`alwaysRun` check never comes from the cache.

## In a pipeline

The branch's build writes the CI report and commits it; the merge reads it. Trust only checks
whose result cannot differ between machines: the merge mode trusts mutation verdicts, and
typecheck, the tests and anything that spawns processes always run again.

GitHub Actions, on the branch:

```yaml
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - run: node runner/self-gate.ts --base origin/main --integration --report ${{ github.head_ref }}
      - run: |
          git add gate-reports && git commit -m "CI report" && git push
```

Azure DevOps, on the branch (`TF_BUILD` is `True` there, so name the branch with `--report`;
`System.PullRequest.SourceBranch` is `refs/heads/my-branch`, and the runner drops `refs/heads/`, so
the report is `gate-reports/my-branch.gate.json`, the one `--merge origin/my-branch` reads):

```yaml
steps:
  - checkout: self
    fetchDepth: 0
    persistCredentials: true
  - task: NodeTool@0
    inputs: { versionSpec: '24.x' }
  - script: npm ci
  - script: node runner/self-gate.ts --base origin/main --integration --report $(System.PullRequest.SourceBranch)
  - script: git add gate-reports && git commit -m "CI report" && git push origin HEAD:$(System.PullRequest.SourceBranch)
```

The merge, in a worktree of the integration branch (`origin/` is dropped the same way, so the
merge reads the report the branch's build wrote):

```sh
git merge --no-ff --no-commit origin/my-branch
node runner/self-gate.ts --base main --merge origin/my-branch
```

The merge trusts the report only when it names the branch tip (nothing but the report folder and
the `ungraded` paths changed since the commit it gated), the tree was clean when it ran, its base
is on the branch merged into, and it is green with no surviving mutant. Then onkel mutates only
the lines the merge itself changed (conflict resolutions and fixes made at merge time). Anything
else mutates every changed line, and the summary says why, for example `stale: it gated abc12345,
and the tip def67890 changed src/a.ts since`.

## A repo's own merge check

`mergeCheck` names a module whose export `mergeCheck(branch, base, git)` returns its printed
lines, whether it refuses the merge, and the records a passing merge logs
(`runner/merge-check.ts`). The reference build asks there whether its owner chose the change; a
team might ask for a linked work item. A refusal still runs the gate, and fails it.

## What stays in the reference build

The parts that read the reference repo stay there, each listed in [MIRROR.md](../MIRROR.md):
its owner-choice merge check, the registry's reader of its hook settings and watchlist, the gate
lessons it files into its learning loop, its cloud build pacing and the `/flow` command that
starts its dispatcher.
