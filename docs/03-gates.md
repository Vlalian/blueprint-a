# Gates as contracts

Each gate below is described as a contract you can implement in any language and wire into any
harness. Field names are suggestions; what matters is that they are fixed and documented.

## The shared contract

Every gate is a command-line program that:

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
| A1 Dangerous version-control commands | `gates/git-guard` | A command line and the checked-out branch |
| C1 Four checks | `gates/four-checks` | The project's lint, typecheck, test and build commands |
| C1 Skipped tests are not green | `gates/four-checks/skips-cli.ts` | git and the test command's JSON report (vitest) |
| C2 Secret scan | `gates/secret-scan` | git |
| C3 Hidden Unicode | `gates/hidden-unicode` | git |
| C4 Import boundaries | `gates/boundaries` | dependency-cruiser (JS/TS) |
| D1 Red check | `gates/red-check` | git and the test command |
| D2 Test-deletion guard | `gates/test-deletion` | git |
| No debug leftovers | `gates/debug-leftovers` | git; fails on an added `console.log`, `console.debug` or `debugger` line outside tests |
| C6 Security rules (SAST) | `gates/sast` | git and Semgrep 1.179.0 (`pip install semgrep==1.179.0`); the pinned TypeScript, JavaScript and C# rules, copied in as `gates/sast/rules/README.md` says |
| D3 CRAP and mutation, through a language adapter | `gates/test-strength` with `adapters/js-ts` or `adapters/dotnet` | The adapter's tools: Stryker plus vitest, Jest or Karma for JS/TS; the .NET SDK, coverlet and Stryker.NET for .NET |
| D3 CRAP and mutation, scoped to changed lines (vitest projects) | `gates/onkel`; `gates/hardener/gate.ts` runs it on a change | Stryker and vitest |
| E1 Plan gate | `gates/plan` | The plan and ticket files |
| E2 Handoff gate | `gates/handoff` | git |
| F1 CI green on the exact commit | `gates/ci-on-sha/gate.ts` with `adapters/host` | The host: GitHub through the `gh` CLI, or Azure DevOps through its REST API and a personal access token in `AZURE_DEVOPS_PAT` |
| SonarQube's quality gate on the exact commit | `gates/sonarqube/gate.ts` with `adapters/sonarqube` | A SonarQube server (Developer Edition or above for pull requests) and a user token in `SONAR_TOKEN`; see [09-sonarqube.md](09-sonarqube.md) |

`gates/test-strength` reads only an **adapter interface** with three calls:
`coverage(paths)` gives each function's lines and how many the tests ran, `complexity(paths)`
each function's cyclomatic complexity, `mutate(paths)` each mutant with its status. The gates
judge; the adapter measures. A new language needs a new adapter, not a new gate: from v0.2,
`adapters/dotnet` measures .NET with coverlet and Stryker.NET (`--runner dotnet`).

---

## A. Pre-tool gates (refuse an action before it happens)

These run on the harness's **pre-tool event**: before a shell command, file write or edit
executes. The hook program reads the event payload, and either stays silent (allow) or prints a
reason and signals "block" (exit 2 in the reference build). Allow must be silent, so passing
hooks cost no context.

### A1. Dangerous version-control commands
- **Purpose:** stop history-destroying or check-skipping commands.
- **Input:** the command an agent is about to run.
- **Fails on:** force push (including `+refspec` and mirror pushes), deleting a remote branch,
  pushing everything, pushing to the main branch, skipping commit hooks (`--no-verify`, the
  short commit flag), hard reset, forced clean, forced branch delete, whole-tree checkout or
  restore, changing the hooks path, defining command aliases, merging or marking ready a pull
  request through the hosting CLI or its API.
- **Must parse the shell**, not grep the string: see through `env`, `sudo`, `sh -c`, `eval`,
  PowerShell `-Command` / encoded commands, `cmd /c`, subshells and command substitution,
  clustered flags and option abbreviations.
- **Prove it bites:** feed the payload for a push with the hook-skipping flag → block.

### A2. Protected files (authority tier 4)
- **Purpose:** agents cannot edit what the human owns.
- **Input:** the target path of a write or edit, or the write targets of a shell command
  (redirections, copy and move targets, in-place editors).
- **Fails on:** any path matching the tier-4 list from the tiers config (decision records,
  project context, standing directives, the tiers file), plus version-control hook folders and
  config. Normalise paths first (relative vs absolute, Windows and POSIX spellings).
- **Prove it bites:** payload editing a directives file → block.

### A3. Config protection
- **Purpose:** "fix the code, not the config": agents cannot weaken lint or format rules.
- **Fails on:** an edit to an **existing** linter or formatter config or its ignore file.
- **Prove it bites:** payload editing the lint config → block.

### A4. Fail closed on bad input
- **Purpose:** a hook that cannot read its input must not allow.
- **Fails on:** payload larger than the hook can inspect (512 KB in the reference build), not
  valid JSON, a field of the wrong type, or any crash.
- **Prove it bites:** a truncated payload → block.

### A5. Loop guard
- **Purpose:** stop an agent repeating itself.
- **Input:** each tool call (tool plus input), counted per ticket in a state file.
- **Fails on:** the Nth identical consecutive call (N = 5 in the reference build). It writes an
  escalation record and blocks that and every later call on the ticket.
- **Prove it bites:** send the same payload N times → the Nth is blocked.

### A6. External tool health (optional)
- **Purpose:** block calls to an external tool server that is known to be down, so the agent
  falls back instead of hanging.
- **Fails on:** a server whose probe failed recently (healthy results cached briefly; unhealthy
  ones backed off exponentially).

### A7. Human-only commands
- **Purpose:** some commands (review start, merge) may only be invoked by the human.
- **How:** use the harness's own mechanism to stop the model invoking them, if it has one.
  Otherwise, treat it as an open question.

---

## B. Stop gate (refuse "I am done")

Runs on the harness's **stop event**: when an agent declares it is finished.

- **Purpose:** an agent cannot finish with red checks.
- **Input:** the role's configured list of gate commands (see the role table in
  [02-flow-and-roles.md](02-flow-and-roles.md)), run in the role's working copy.
- **Output on red:** a block decision with the failures as the reason, fed back to the agent so
  it can fix them. A counter per ticket and role is incremented.
- **Escalation:** after **2** blocked stops, the next red stop (or any gate error, such as missing
  config) writes an escalation record `{ticket, reason, blocks, at}` and lets the stop through,
  so the controller can route the ticket back to `planned` with a report.
- **Prove it bites:** make a test fail, trigger a stop → block; twice more → escalation record.

---

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

### E2. Handoff gate
- **Purpose:** handoffs between roles are machine-valid; agents never write the final file.
- **Input:** a handoff draft (a few header lines), the sending role, the known roles, an outbox.
- **Output:** `{gate, pass, errors: [...], file?}`; on pass the gate writes the canonical file
  (sender, id, timestamps, full commit hash generated by the gate).
- **Fails when:** type is not `git_handoff` (needs recipient, priority, task, commit) or `note`
  (needs recipient, priority, message); reserved headers are present; priority is not two digits;
  a recipient is unknown or is the sender; the task name is not kebab-case or exceeds 40
  characters; the commit is not 7 to 40 hex characters or does not resolve to exactly one commit;
  the note exceeds 80 characters or contains control characters.
- **Exit 2:** not a repository, corrupt sequence state, or the output file already exists (never
  overwrite; claim sequence numbers exclusively).
- **Prove it bites:** an 81-character note; an ambiguous commit abbreviation.

### E3. Review schema (fail closed)
- **Purpose:** a reviewer's output is only usable if it matches a strict shape.
- **Input:** the reviewer's output file and its exit code.
- **Shape:** exactly `{findings: [Finding]}` where each finding has, all required and non-empty,
  no extra keys: `file`, `line` (integer ≥ 1), `severity` (`HIGH` | `MEDIUM` | `LOW`), `axis`
  (`standards` | `spec`), `claim`, `scenario`, `fix`, `ticket`. One JSON code fence around the
  whole output is tolerated; prose around it is not.
- **Output:** `{gate, pass, findings, errors}`.
- **Fails when:** the reviewer exited non-zero, output is missing or empty, not JSON, or the wrong
  shape. Bad arguments are exit 2.
- **Skeptic check:** `{refuted: boolean, evidence: string}`; anything unreadable = not refuted.

### E4. Tool licence check
- **Purpose:** before installing a tool, confirm it is the package you meant and its licence is
  acceptable (a real case: two tools shared a name).
- **Input:** package name plus a substring its repository address must contain.
- **Output:** `{gate, pass, packages: [{name, license, repository}], findings}`.
- **Fails when:** no licence, a licence not on the allow list (permissive licences such as MIT,
  ISC, Apache-2.0, BSD variants; an `OR` expression passes if either side is allowed), or the
  repository does not match. Validate the name before it reaches a shell.

### E5. Prose lint (library, optional)
- **Purpose:** the mechanical part of keeping generated reports readable.
- **Fails on:** a list of banned filler words and stock phrases, emoji in headings, "not X, but
  Y" contrasts, and too many long dashes.

### E6. Export package check
- **Purpose:** a folder leaving the repository (like this package) holds nothing private.
- **Input:** a folder and a rules file (a deny list of private names, a list of private
  repository owners or slugs).
- **Output:** `{gate, pass, dir, files, findings: [{file, line, kind, detail}]}`.
- **Fails on:** secrets (as C2), hidden Unicode (as C3), personal home-folder paths on Windows,
  Linux or macOS, email addresses, deny-listed names as whole words in any case, and links to
  private repositories. An empty folder is exit 2.
- **Prove it bites:** add a file containing a deny-listed name (built at runtime in the test).

---

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

### F2. Verdict ledger
- **Purpose:** a verdict belongs to one exact commit.
- **Rule:** verdicts are stored per commit hash, with a fixed set of verdict values. A new commit
  is `NOT-VERIFIED`; a commit whose patch identity is unchanged (for example after a rebase) keeps
  its verdict.

### F3. Pull request state machine
- **Purpose:** watch a pull request until it is ready, with typed outcomes.
- **Exit codes in the reference build:** 0 ready, 2 merge conflict, 3 unresolved review threads,
  4 CI failing, 5 timeout, 6 merge gate not met. (This is the one place where codes above 2 are
  used, because each outcome needs a different response.)

### F4. Supply-chain scan
- **Purpose:** every new or changed dependency in the lockfile has an allowed licence (or a
  written exception), and may run an install script only if allow-listed.
- **Output:** `{gate, pass, changed: ["name@version"], findings}`.
- **Fails when:** a new or changed package has a disallowed licence without an exception, or an
  install script without an allow-list entry. A lockfile in an unsupported format is exit 2.
  Save the lockfile as the new baseline only after a clean scan.

---

## Where each gate fires

| Where | Gates |
|---|---|
| Pre-tool event | A1 to A6 |
| Post-tool event | Formatter on edit; observation log (append-only, silent, no model call) |
| Stop event | B, running the role's set from C and D (C6 when the project turns it on) |
| Phase scripts | E1 (planning), D1 (specifier), E2 (every handoff), E3 + skeptic (review), E4 (new tools) |
| Version-control pre-commit | C2, C3, then the project's own checks: **the backstop that works in any harness** |
| CI | C1, C4, C5; F1 before "ready" |
| Dispatcher | Preflight, concurrency cap, retries, loop and budget limits, F2, F3, F4 once per run |
| Before export | E6 |

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
