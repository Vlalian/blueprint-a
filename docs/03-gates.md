# Gates as contracts

Each gate below is described as a contract you can implement in any language and wire into any
harness. Field names are suggestions; what matters is that they are fixed and documented.

## The shared contracts

The router runs the gate commands after each role returns. No harness hooks are shipped.

**A command-line gate** (every `gates/<folder>/cli.ts`, and the gates a pipeline or CI runs):

- prints **one JSON object** on stdout, always containing `gate` (its name) and `pass`
  (boolean), plus `error` (string) when it could not run, plus gate-specific detail fields;
- exits with:

| Exit | Meaning |
|---|---|
| **0** | Pass |
| **1** | Fail: the gate ran and found a violation |
| **2** | Could not run: usage error, missing input, tool crash, timeout. **Never a pass** |

Implementation pattern: wrap the whole gate body in a single "fail closed" handler, so any
exception becomes `{gate, pass: false, error}` with exit 2. Keep the deciding logic in a pure
core function that takes its I/O (files, git, processes) as parameters; the program itself is a
thin shell that wires in real I/O. The core can then be unit-tested and mutation-tested
in-process.

**"Added lines"** below means the lines a change adds, read from a zero-context unified diff
(either the staged changes, or everything since a base commit plus untracked files). Gates that
judge only what a change adds read these, so old debt does not block new work.

**Proving it bites:** each contract names a violation to inject. The test runs the real program
on a throwaway repository: clean → exit 0, injected → exit 1, reverted → exit 0.

## The gates as code in this package

From v0.1 the package carries these gates as code, each with its tests and its prove-it-bites
test. They need Node only (TypeScript runs as is) and no particular agent harness; run each as
`node gates/<folder>/cli.ts …`.

| Contract | Folder | What it needs |
|---|---|---|
| C1 Four checks | `gates/four-checks` | The project's lint, typecheck, test and build commands |
| C1 Skipped tests are not green | `gates/four-checks/skips-cli.ts` | git and the test command's JSON report (vitest) |
| C2 Secret scan | `gates/secret-scan` | git |
| C3 Hidden Unicode | `gates/hidden-unicode` | git |
| C4 Import boundaries | `gates/boundaries` | dependency-cruiser (JS/TS) |
| C5 Duplication | `gates/duplication` | git and jscpd (a dev dependency of this package) |
| D1 Red check | `gates/red-check` | git and the test command |
| D2 Test-deletion guard | `gates/test-deletion` | git |
| No debug leftovers | `gates/debug-leftovers` | git; fails on an added `console.log`, `console.debug` or `debugger` line outside tests |
| C6 Security rules (SAST) | `gates/sast` | git and Semgrep 1.179.0 (`pip install semgrep==1.179.0`); the pinned TypeScript, JavaScript and C# rules, copied in as `gates/sast/rules/README.md` says |
| D3 CRAP and mutation, through a language adapter | `gates/test-strength` with `adapters/js-ts` or `adapters/dotnet` | The adapter's tools: Stryker plus vitest, Jest or Karma for JS/TS; the .NET SDK, coverlet and Stryker.NET for .NET |
| D3 CRAP and mutation, scoped to changed lines (vitest projects) | `gates/onkel`; `gates/hardener/gate.ts` runs it on a change | Stryker and vitest |
| D5 Canary | `gates/canary` | vitest; the folders to search in `config/canary.json` (default `gates` and `adapters`) |
| E1 Plan gate | `gates/plan` | The plan and ticket files |
| F1 CI green on the exact commit | `gates/ci-on-sha/gate.ts` with `adapters/host` | The host: GitHub through the `gh` CLI, or Azure DevOps through its REST API and a personal access token in `AZURE_DEVOPS_PAT` |
| F4 Supply-chain scan | `gates/supply-chain` | git, an npm lockfile (v2 or v3) and the exceptions in `config/supply-chain.json` |
| F5 Walk gate | `gates/walk` with `gates/evidence` | The walk report, its media and the exact head and patch-id; see [08-previews-kubernetes.md](08-previews-kubernetes.md) |

`gates/test-strength` reads only an **adapter interface** with three calls:
`coverage(paths)` gives each function's lines and how many the tests ran, `complexity(paths)`
each function's cyclomatic complexity, `mutate(paths)` each mutant with its status. The gates
judge; the adapter measures. A new language needs a new adapter, not a new gate: from v0.2,
`adapters/dotnet` measures .NET with coverlet and Stryker.NET (`--runner dotnet`).

---

## Role completion

The router runs each role's configured checks itself. A nonzero exit, missing command or crash
is red. The first red returns to a fresh role; a second red stops that ticket for the owner.
The consolidated checks run on the finished head before independent review and walk.
See [02-flow-and-roles.md](02-flow-and-roles.md).

## C. Code checks

### C1. Four checks
- **Purpose:** the project's own lint, typecheck, test and build commands as one gate.
- **Input:** a project config mapping check names to commands.
- **Output:** `{gate, pass, results: [{name, command, exitCode, tail}]}`; `tail` is the last
  20 lines of output.
- **Fails when:** any command exits non-zero (all still run). A killed or timed-out command
  counts as a failure (10 minutes per command in the reference build). **No checks configured is
  exit 2**, not a pass.
- **Prove it bites:** a check that fails when a marker file exists; create it, remove it.

### C2. Secret scan
- **Purpose:** no credentials in what a change adds.
- **Input:** added lines (staged, or since a base).
- **Output:** `{gate, pass, findings: [{file, line, kind, excerpt}]}`. The excerpt is the first
  few characters plus an ellipsis; **the full secret is never printed**.
- **Fails on:** provider API keys (recognisable prefixes and minimum lengths), version-control
  hosting tokens, cloud access key ids, private key headers, and hard-coded credential
  assignments (`api_key`, `secret`, `token`, `password` = a quoted value of 8+ characters).
  Placeholders (all `x`, all `*`, `<...>`, `${...}`, values containing words like "example",
  "placeholder", "dummy", "redacted") pass; provider keys never count as placeholders.
- **Prove it bites:** add a file containing a token-shaped string (build it at runtime in the
  test so the test file itself does not trip scanners).

### C3. Hidden Unicode
- **Purpose:** no invisible characters that make code read differently from how it runs, or hide
  instructions from a reviewer (a prompt-injection defence).
- **Input:** added lines.
- **Output:** `{gate, pass, findings: [{file, line, column, codePoint, name}]}`, `codePoint` as
  `U+XXXX`.
- **Fails on:** bidirectional controls (U+202A to U+202E, U+2066 to U+2069, U+200E, U+200F,
  U+061C), zero-width characters (U+200B to U+200D, U+2060, U+180E), soft hyphen (U+00AD),
  byte-order mark except as the first character of a file, invisible operators (U+2061 to
  U+2064), and tag characters (U+E0000 to U+E007F).
- **Prove it bites:** add a string containing U+202E (written as an escape in the test).

### C4. Import boundaries
- **Purpose:** no import cycles and no imports that resolve to nothing; optionally layer rules.
- **Input:** source paths and a dependency-graph rules file (counting type-only imports).
- **Output:** `{gate, pass, violations: [{rule, from, to, cycle?}]}`.
- **Fails on:** any violation at error severity (warnings pass). Analyser output that cannot be
  read is exit 2.
- **Prove it bites:** add a two-file import cycle.

### C5. Duplication
- **Purpose:** no new copy-paste.
- **Input:** a base commit; a clone detector run over the project.
- **Output:** `{gate, pass, base, clones: [{first: {file, start, end}, second: {...}, lines}]}`.
- **Fails when:** any clone has an added line inside either fragment. Clones entirely in
  untouched code pass. No percentage threshold; the detector's minimum clone size applies.
  `gates/duplication` runs jscpd (its defaults: 5 lines, 50 tokens), with untracked files counted
  as added; a base that does not resolve is exit 2.
- **Prove it bites:** copy a block of code into a second file.

### C6. Security rules (SAST)
- **Purpose:** deterministic security rules on the code a change touches: injection, unsafe
  deserialisation, weak crypto, path traversal, SSRF. Without it, code-level security rests on
  the reviewers' judgement alone.
- **Input:** a base commit; Semgrep at a pinned version with its rules pinned to a snapshot on
  disk (TypeScript, JavaScript and C#), so a run never needs the network.
- **Output:** `{gate, pass, scanned, findings, warnings, suppressed, notScanned, semgrep}`, each
  finding with its rule, severity, file and line.
- **Fails on:** a new ERROR-severity finding in a changed source file (tests and fixtures are left
  out). A finding the base already has on the same code is not new. WARNING findings are reported
  and pass. A suppression is line-level only, naming the rule and giving a reason
  (`// nosemgrep: <rule> -- <reason>`); one without either is itself a finding. Semgrep missing or
  failing is exit 2 with what to install, never a pass.
- **Licence:** Semgrep's registry rules are under the Semgrep Rules License v1.0: internal use
  only, no redistribution. This package carries the pin (`gates/sast/rules/SNAPSHOT.json`: version,
  commit, every rule file), not the rule files; a team copies them in for its own use.
- **Prove it bites:** a command injection in TypeScript (`child_process` run with a function's
  argument) and one in C# (`Process.StartInfo.Arguments` built from a parameter).

---

## D. Test strength

### D1. Red check (red before green)
- **Purpose:** prove a new test actually tests something. No source workflow checked this.
- **Input:** a base commit; the test command; an optional allow list.
- **How:** copy each new or changed test file into a temporary checkout of the **base** code and
  run it there.
- **Output:** `{gate, pass, base, tests, exitAtBase, findings: [{file, detail}]}`.
- **Fails when:** a test **passes** at base, or never ran (timeout, killed, command not found).
  Clean up the temporary checkout afterwards; quote file names safely.
- **Prove it bites:** add a test that already passes on the base code.

### D2. Test-deletion guard
- **Purpose:** agents cannot make tests pass by removing them.
- **Input:** a base commit; an optional allow list (file, or file plus test title) from the plan.
- **Output:** `{gate, pass, base, deleted: [{file, title}]}`.
- **Fails when:** a test title present at base is missing now (renamed counts as deleted; a
  deleted file reports all its tests; repeated titles counted per copy).
- **Prove it bites:** remove one test from a two-test file.

### D3. Complexity-times-coverage and mutation, on touched code
- **Purpose:** changed code must be simple and its tests must be strong.
- **Input:** a base commit and the changed source files; the scope is every function overlapping
  a changed line.
- **Score:** `complexity² × (1 − coverage)³ + complexity` per function (the CRAP metric). A fully
  covered function scores its complexity.
- **Fails when:**
  - any touched function scores **above 6**;
  - any mutant on the touched code **survives** or has no covering test (mutation score must be
    100%; timeouts and compile errors count as killed);
  - a mutant is suppressed **without a written reason** next to the suppression;
  - the run produced no mutants, a file is untested, the mutation tool skipped files, or a status
    is inconclusive.
- **Property tests** are run separately and **excluded** from coverage, mutation and the score,
  so randomised tests cannot hide weak example tests.
- **Output:** `gates/test-strength` prints the shared JSON contract: `{gate: "crap", pass,
  ceiling, functions, over: [...]}` and `{gate: "mutation", pass, mutants, standing: [...],
  ignored: [...]}`. The change-scoped `gates/onkel` prints a text report ending in `PASS` or
  `ESCALATE` with numbered problems.
- **Prove it bites:** delete the test that kills a mutant; separately, leave a branchy function
  untested.

### D4. Spec mutation (optional, per project)
- **Purpose:** check that a golden test notices when the specification's example values change.
- **How:** mutate example values in a spec or golden prompt; the golden test must fail.

### D5. Canary (do the gates still bite?)
- **Purpose:** a gate that stopped biting passes everything and looks green. The canary reruns
  every prove-it-bites test on a schedule (weekly in the reference build) and turns red for a gate
  that no longer fails its injected fault.
- **Input:** `--root` (default: the package), the folders to search from `config/canary.json`
  (`{"dirs": [...]}`, default `gates` and `adapters`); every `*bites.test.ts` and
  `*bites.integration.test.ts` there runs in its own vitest process. Each check reports its three
  exit codes through `WORKFLOW_CANARY_REPORT`; a test that reports none is judged by its exit code.
  With `--state <folder>` each gate's state (`green`, `red`, `could-not-run`) is appended to
  `<folder>/logs/observations.jsonl`.
- **Output:** `{gate, pass, gates: [{gate, file, state, detail}]}`.
- **Fails when:** a check's injected run did not exit 1, its clean or reverted run did not exit 0,
  or a bites test failed. No bites test at all, or one that could not run, is exit 2.
- **Prove it bites:** a toy gate whose injected fault no longer fails → the canary exits 1 and
  logs it red.

---

## E. Artifact gates

### E1. Plan gate (four checks in one)
- **Purpose:** a plan is checked against its ticket before a human spends time on it.
- **Input:** the plan file, the ticket file, an optional extra command allow list.
- **Output:** `{gate, pass, checks: {lint: [...], crossArtifact: [...], ears: [...], commands: [...]}}`,
  each a list of `{message}`.
- **Fails when any check has findings:**
  - **Lint:** header lines present; the fixed sections present, in order and non-empty;
    behaviours numbered 1..n with no gaps; each behaviour has a code block of real test code and
    an "expected failure before implementation" line.
  - **Cross-artifact:** every ticket acceptance criterion maps to at least one behaviour; every
    mapping points at a real criterion and behaviour; every behaviour is claimed; every file path
    the plan cites exists.
  - **EARS:** every criterion is in EARS form: "When/While/Where X, the S shall Y", "If X, then
    the S shall Y", or "The S shall Y".
  - **Commands:** every command in the plan is on an allow list of test, lint, typecheck and build
    commands, with no shell chaining, pipes, redirection or substitution.
- **Prove it bites:** start from a known-good plan and ticket; break one thing per test.

## F. Release and supply chain

### F1. CI green on the exact commit
- **Purpose:** green on a parent commit does not count.
- **Input:** a commit reference (default: the current one).
- **Output:** `{gate, pass, host, sha, ci: green | failing | pending, verdict: VERIFIED | FAILED |
  NOT-VERIFIED, passed, failing, pending}`.
- **Fails when:** anything failed, anything is still pending, there are no checks at all, or a
  status is unknown. Hosting CLI or API errors, a missing token and bad references are exit 2.
- **Host adapter:** the gate reads CI only through `checksForCommit(sha)` of a host adapter
  (`adapters/host`, from v0.3), which also opens draft pull requests, reads their status and
  policies, and reads and moves work items. GitHub reads check runs and commit statuses; Azure
  DevOps reads the newest pipeline run of each pipeline on the commit. Both map to the same
  verdict: green is `VERIFIED`, failing `FAILED`, pending or nothing reported `NOT-VERIFIED`.

### F4. Supply-chain scan
- **Purpose:** every new or changed dependency in the lockfile has an allowed licence (or a
  written exception), and may run an install script only if allow-listed.
- **Output:** `{gate, pass, changed: ["name@version"], findings}`.
- **Fails when:** a new or changed package has a disallowed licence without an exception, or an
  install script without an allow-list entry. A lockfile in an unsupported format is exit 2.
  Save the lockfile as the new baseline only after a clean scan.
- **Input:** `--base <ref>` (the lockfile at that commit) or `--base-file <lockfile>`, the
  lockfile now (`--lockfile`, default `package-lock.json`) and the exceptions file (`--allowlist`,
  default `config/supply-chain.json` beside the gates): `licenceExceptions` and `installScripts`,
  each a package name (a trailing `*` matches a prefix) with why it is accepted.
- **Prove it bites:** a new package with an install script and no entry → exit 1; removed → exit 0.

### F5. Walk gate
- **Purpose:** check that a preview walk is cited, complete and bound to the head being judged.
- **Input:** a walk report and saved media, `--head`, `--patch-id`, and the expected criteria and QA items.
- **Output:** `{gate, pass, report, problems, flags}`.
- **Fails when:** evidence is invalid or missing, the head or patch-id differs, an expected item is
  missing, a criterion is not run, or an item failed. Flagged items go to the owner.
- **Prove it bites:** a complete bound report passes; change the head or remove a criterion and it fails.

## Where each gate fires

| Where | Gates |
| --- | --- |
| Router after each role | The role's configured checks, with red check for specifier and mutation for hardener |
| Finished build | Consolidated role checks, security scans, independent judges, walk report |
| Pre-commit | Secret scan, hidden Unicode and the project's checks |
| CI | Project checks, then CI on the exact head before integration |
| Self-gate | Typecheck, unit, property, integration when requested, canary, SAST and onkel |
| Before export | check-package, standalone install, typecheck, unit and integration tests |

## Gates considered and not adopted

- **Fact-forcing on first touch** (make the model state facts before its first edit of a file):
  the retry always passes, so it adds friction without proof.
- **Global coverage threshold:** D3 is stricter, on changed code only.
- **Debug-statement and commit-message hooks:** belong in the linter and a commit-message linter.
- **Score-plateau stop:** only useful for score-optimising loops.
- **Hash-chained run journal**, workflow-file security lint, worktree prune classifier,
  image-diff gate, keep-or-revert performance hill-climbing: revisit when the work needs them.

## LLM verdicts that only look deterministic

These add findings but never pass work on their own: reviewer pass/fail, scores parsed from a
model's prose, ticked plan checkboxes, a model calling a mutant "equivalent", and a model saying
it wrote the test first (which is why D1 exists).
