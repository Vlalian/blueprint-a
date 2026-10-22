# Optimisations learned in the reference build

The reference build ran this workflow every night for two weeks (2026-10-04 to 2026-10-20) and
measured where the time went and which step caught which defect. This page lists the changes that
paid off, in the order to adopt them, each with what it saves, how to build it, and how to prove it
bites. None of them weakens a gate: each one skips only work whose result is already known, and
**falls back to the full check whenever it cannot prove that**. Items 1 to 4 and 8 are code in
this package ([12-runner.md](12-runner.md)), items 5 to 7 too (`flow/`,
[02-flow-and-roles.md](02-flow-and-roles.md)); each of their sections ends with where.

| # | Change | Saves (reference build) | Effort |
|---|---|---|---|
| 1 | Trust a verified report at the exact commit | Merge gate 66 min down to 13.5 min | About 1 day |
| 2 | A report goes stale when the branch moves | About 1 h per stale report | About 2 h, after 1 |
| 3 | Run only the tests a change can reach | Integration 150-460 s per merge, and growing | About 3 h |
| 4 | Never re-run a check on an unchanged tree | 58% of a build's time | About half a day |
| 5 | The other model family reviews every round | Finds the defects the gates miss | About 2 h |
| 6 | The builder runs the strict checks before handover | A gate run plus a fix round (about 40 min) per miss | About 1 h |
| 7 | Cap builds in flight; merge the base into open branches | 17 of 23 h lost to usage limits in one night | About 3 h |
| 8 | Allow for load on Windows | About 40 min per false red | About 2 h |

## 1. Trust a verified report at the exact commit

**Why.** D3 (CRAP and mutation, [03-gates.md](03-gates.md)) was 60-85% of the merge gate's time,
and the merge gate re-mutated lines the build had already mutated. In two weeks the second run
found nothing the first had missed; the merge gate's real catches were merge breaks.

**How.**
1. The run that builds the branch (a CI job, or the stop gate of the last role) writes its D3 result
   as a file committed on the branch, for example `gate-reports/<branch>.json`, with: the base
   commit, the **head commit it ran on**, the files it covered, mutants killed and total, survivors,
   suppressions, and the highest CRAP score.
2. The merge gate reads that file and trusts it only when **all** hold:
   - its head commit is the branch tip being merged;
   - zero survivors, zero suppressions, CRAP at most 6;
   - its files equal the files the branch changes against the base.
3. When trusted, the merge gate mutates **only the lines the merge itself changes**: conflict
   resolutions and fixes made at merge time (diff the merge result against the branch tip).
4. When any condition fails, the gate runs full D3 on every changed line and its summary says why
   ("report names abc123, tip is def456").
5. Trust only checks whose result cannot differ between machines: mutation verdicts and CRAP from a
   recorded coverage file. Typecheck, lint, the test suite and anything that spawns processes
   always run again locally.
6. Every Nth trusted merge (5 is a good start) also runs full D3. A disagreement is an escalation
   to the human, not a quiet retry.

**Prove it bites:** a report naming an older commit → full D3 runs; a report with one survivor →
full D3 runs; a merge that adds one line on top of a trusted report → that line is mutated.

**In this package:** `runner/self-gate.ts --merge <branch>` with `runner/ci-report.ts`: the report
is `<report.dir>/<branch>.gate.json` (`config/runner.json`), and `report.trusted` names what a merge
may take from it. Not yet built here: the every-Nth full D3 of step 6. See [12-runner.md](12-runner.md).

## 2. A report goes stale when the branch moves

**Why.** Any commit after the report, including merging the base branch into the ticket branch
(item 7), makes the report name an old commit, so item 1 falls back to full mutation. That happened
three times in one week, about an hour each.

**How.**
1. Any step that commits to a branch with a report (a fix round, a base merge, a conflict
   resolution) runs D3 again on that branch and commits a fresh report before handing over.
2. The status view lists each open branch with "report current" or "report stale", so the
   controller sees it before it queues a merge gate.
3. Skip the base merge of item 7 for a branch whose report is current and whose merge is next in
   the queue: the merge gate will meet the base anyway.

**Prove it bites:** commit one line after the report → status shows stale and the next merge gate
runs full D3.

**In this package:** the staleness check of step 1 (`runner/ci-report.ts`, `judgeCloudReport`):
any change since the gated commit outside the report folder and `report.ungraded` makes the merge
mutate every changed line and say so. The status view of step 2 is the harness's.

## 3. Run only the tests a change can reach

**Why.** The merge gate ran every integration test on every merge, and the stage grew with each
merge (301 s to 459 s over six merges). Gate time must not grow with the repository.

**How.**
1. From the changed files, walk the **reverse** import graph (every module that imports a changed
   module, transitively) and select each test file whose imports reach a changed file. Use the test
   runner's own graph where it has one (`vitest related`), and check it against the
   dependency-cruiser graph C4 already builds.
2. Add the dependencies the import graph cannot see: a test that spawns a CLI by path, reads a
   fixture or config file at run time, or loads a hook from the harness settings depends on that
   file.
3. A change to shared ground selects the **whole** suite: `package.json`, the lockfile,
   `tsconfig*`, test runner configs, shared test helpers, config folders.
4. Fail closed: if the graph cannot be built, or a changed file is not in it, run everything and
   say why.
5. Coverage for D3 is still measured on every changed source file. A changed file that no selected
   test reaches is a finding, not a pass.
6. Run the full suite as a safety net (before promoting to the main branch, and once a night when
   idle). A full-run failure in a test that was never selected for the change that broke it is a
   **selection miss**; record it with the missing edge, so the rule gets fixed.

**Prove it bites:** change a module imported two levels down by a test → that test runs; change
the lockfile → every test runs; delete the graph file → every test runs and the summary says why.

**In this package:** `runner/self-gate-select.ts` and `runner/affected-deps.ts` (steps 1-5, with
`wholeSuite` and `graphDirs` in `config/runner.json`), and `runner/full-run.ts` with
`runner/selection.ts` for the safety net and its selection misses (step 6).

## 4. Never re-run a check on an unchanged tree

**Why.** In the pilot, 80% of a build's time was checks, and 58% was checks repeated on code that
had not changed: the same tree was linted, typechecked and tested ten times in one build, and roles
that made no edit re-ran every check.

**How.**
1. Key each check result by **project, tree hash, check name, command and env-file hash**. The
   tree hash is `git write-tree` of the working copy with untracked files included (add them to a
   temporary index, never the real one).
2. Before running a check, look up the key. A hit with a pass reuses the result; anything else runs
   the check.
3. The controller does not re-run the checks the stop gate just passed on the same tree.
4. A role or fix round that leaves the tree unchanged reuses the last results.
5. A blocked round whose retry leaves the tree unchanged escalates at once with the original
   failure, instead of running identical checks up to the retry limit.
6. A check marked `alwaysRun` in project config is never cached. Never share the cache across
   projects.
7. Record `source: ran | cached` and the milliseconds for each check, so the evaluation shows the
   time saved.

**Prove it bites:** run twice on one tree → the second run is cached; change one byte → it runs;
change the check's command → it runs.

**In this package:** `gates/four-checks/cache.ts` keys and stores the results, and
`runner/runner-checks.ts` runs `config/runner.json`'s `checks` through it (steps 1, 2, 6 and 7), for a
pre-commit hook or a CI job. Steps 3 to 5 are the controller's, in the harness.

## 5. The other model family reviews every round

**Why.** Over two weeks the independent review found almost every real defect; the gates mostly
caught merge breaks. Reviews by the family that did not build: 36 runs with 18 high findings in one
direction, 13 runs with 1 high in the other. [02-flow-and-roles.md](02-flow-and-roles.md) says one
reviewer *should* be another family; make it a rule.

**How.**
1. Record the builder's family on every build and fix round (one line in the ticket's result:
   `Builder: <family>`).
2. The reviewer for that round is the **other** family. Either family may build; the one that built
   never reviews its own round alone.
3. Fix rounds are reviewed too, by the family that did not make the fix.
4. When the other family is unavailable, the stand-in reviewer of
   [02-flow-and-roles.md](02-flow-and-roles.md) applies, and the briefing says so.
5. Docs-only changes need no review.

**Prove it bites:** a round marked `Builder: A` reviewed only by family A → the merge gate refuses
it with "no review by the other family".

**In this package:** `flow/review.ts` with `flow/model-run.ts`: `flow review <ticket>` gives the round
to a family of `config/flow.json` other than its last `Builder:` line and refuses the builder's own,
and `flow merge` (`flow/merge.ts`) refuses a round whose recorded review is by the family that built
it. Not yet built here: the docs-only exemption of step 5. See [02-flow-and-roles.md](02-flow-and-roles.md).

## 6. The builder runs the strict checks before handover

**Why.** The commonest merge-gate failures were ones the builder could have seen: a function over
CRAP 6 after a hand fix, and surviving mutants from weak tests. Each cost a gate run plus a fix
round of about 40 minutes.

**How.**
1. Every build and fix brief ends with: run the **full** unit suite, and D3 on the touched code,
   before handing over; report the highest CRAP and the mutants killed of total in the result.
2. The handoff gate (E2) refuses a handover whose result does not state both numbers for the head
   commit.
3. For a model that cannot run the mutation tool in its sandbox, run CRAP from a coverage file at
   least, and say so in the result.

**Prove it bites:** a handover result without a CRAP line → E2 refuses it.

**In this package:** `flow/build.ts`: every build brief asks for the checks and both numbers, and
the round is pushed only when `config/flow.json`'s `checks` pass in its worktree. The E2 refusal of
step 2 is the handoff gate's (`gates/handoff`).

## 7. Cap builds in flight, and merge the base into open branches

**Why.** One night, with six builds in flight, spent 17 of 23 hours paused on usage limits and five
runs died half-way. Tickets built side by side from an old base broke one by one as each merged
ahead of them (four breaks in one night).

**How.**
1. Cap builds in flight at **2-3 in total**, counting every model family together
   ([04-flow-control.md](04-flow-control.md) numbers). The status view warns above the cap.
2. After each merge into the integration branch, merge it into every open ticket branch that no
   build is writing to, each in its own worktree; typecheck it; push it when clean.
3. A branch that conflicts or fails typecheck is left untouched and listed, with its conflicting
   files, for the next fix round. A branch a build is writing to is skipped: that build merges the
   base itself before it hands over.
4. Never force-push. Record each push, skip and conflict, so the evaluation counts how often the
   base breaks an open branch.
5. Mind item 2: this merge makes the branch's report stale.

**Prove it bites:** with a fake git, four builds in flight → a warning; a conflicting branch → left
unchanged and listed.

**In this package:** `flow/in-flight.ts` (the cap of `config/flow.json`, `buildCap`, every family
together; `flow status` warns above it, `flow build` refuses a round over it) and `flow/base-into.ts` (run
by `flow merge` after each push: a worktree per open branch, the configured typecheck, never a
force-push, one `base-into` record per branch).

## 8. Allow for load on Windows

**Why.** Tests that spawn git or node passed alone and in CI (Linux), and timed out on a Windows PC
when the whole suite ran in parallel. Each surfaced only at the local merge gate and cost a full
rerun of about 40 minutes. A test fake that appended `/` to a joined path passed on Linux and
found nothing on Windows.

**How.**
1. Rule for every test-writing role: a test that spawns a process has a timeout of at least three
   times its time alone and never below 60 s; it never races the wall clock; polling uses a fake
   clock and the fewest real spawns that prove the behaviour.
2. A check that finds test files calling `spawn`, `spawnSync` or `execFileSync` (directly or through
   a test helper) without an explicit timeout of at least 60 s, and names file and line.
3. A portability check on test files and helpers: refuse a `/` appended to a value from `join`,
   `resolve` or `dirname`, and `startsWith`/`endsWith`/`includes` with a `/` literal on such a value.
   Name the portable form in the finding (`path.sep`, or normalise with `split(sep).join('/')`).
4. Run the unit suite once in CI with workers set to twice the core count, so a test that needs
   spare CPU fails there first.

**Prove it bites:** a spawning test with the default timeout → the check names it; the line
`p.startsWith(\`${dir}/\`)` in a fake → refused.

**In this package:** `runner/spawn-timeouts.ts` (step 2) and `runner/portability.ts` (step 3), each
swept over every test file by its own test. Step 4 is a CI setting:
`node node_modules/vitest/vitest.mjs run --maxWorkers=<twice the cores>`.
