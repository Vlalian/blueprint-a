# SonarQube beside the gates

From v0.5, Blueprint A can read SonarQube's result. Work already runs SonarQube: on each analysis
it judges the new code for bugs, vulnerabilities, code smells, duplication, cognitive complexity and
coverage, and its quality gate passes or fails the pull request. Until now this workflow was blind to
that result. This page covers three things: how the sonarqube gate reads SonarQube, where SonarQube
and our gates check the same thing, and what SonarQube does not check at all.

## The gate

`gates/sonarqube/gate.ts` reads SonarQube's quality gate on the **exact commit being shipped**. It
follows the same contract as F1 ([03-gates.md](03-gates.md)):
- `VERIFIED` when the analysis of that very commit passed its quality gate;
- `FAILED` when that analysis failed it, with the conditions that failed (for example coverage on
  new code under 80%);
- `NOT-VERIFIED` otherwise.

These cases are all NOT-VERIFIED:
- the analysis is still running;
- only an older commit was analysed;
- the analysis failed;
- the project has no quality gate.

**An analysis of an older commit is never a pass.** The gate waits for the analysis of the head
commit for up to the project's `waitMinutes` (10 by default), then gives its verdict. A missing
token or server address exits 2 (could not run) and names what is missing.

The gate reads SonarQube only through the adapter `adapters/sonarqube`. Its four calls are
`analysisFor(sha, ref)`, `qualityGate(ref)`, `newIssues(ref)` and `newCodeMeasures(ref)`. The
server address and project key come from the project's settings, and the token from the
`SONAR_TOKEN` environment variable only. The token never appears in output, logs or fixtures.
`adapters/sonarqube/README.md` lists every Web API call with its source and what is still
unverified. The tests run on replies in `fixtures/sonarqube/`, and the first live check happens at
work.

**How the gate knows which analysis belongs to which commit:**
- **On a branch**, SonarQube's analyses name the commit they analysed, and the gate finds the
  commit's own analysis that way.
- **On a pull request**, SonarQube's Web API names no commit. The link is the task the scanner
  submitted for the commit (`ceTaskId` in the scanner's `report-task.txt`), which the pipeline
  hands to the gate. Without that task id, a pull request is NOT-VERIFIED.

## Findings: who caught what

Each issue SonarQube raises in new code becomes a finding with source `sonarqube`: its rule,
severity, file, line, and a triage in the same three kinds as review findings.

| Kind | Which issues |
|---|---|
| real defect | a bug, a vulnerability, or an impact on reliability or security |
| style | the other code smells |
| false alarm | an issue someone marked as a false positive or accepted |

A finding of a kind one of our gates checks names that gate. If our gate passed the same file,
that is an **escape**: something a gate let through. The run's analysis turns escapes into lessons
([02-flow-and-roles.md](02-flow-and-roles.md), step 6).
Each finding of ours that SonarQube did not raise is recorded too. Per gate, the gate counts what
SonarQube raised, what ours raised and what both raised on the same file.

**The rule agreed for overlaps:** where SonarQube and one of our gates check the same thing, run
both and record which caught what. After about 10 pull requests, decide per check from those
numbers whether to keep both. That decision weighs the value each check adds first and its speed
second.

## Where SonarQube and our gates overlap

| Check | Our gate | SonarQube | How a SonarQube finding is mapped to our gate |
|---|---|---|---|
| Duplication | `gates/duplication` in the reference build (06-open-questions.md, section 3) | the duplication measure on new code; the "Sonar way" quality gate fails above 3% | rule `common-*:DuplicatedBlocks` |
| Secrets | `gates/secret-scan` (C2) | secrets rules, in every edition (more kinds from Developer Edition) | rule repository `secrets:` |
| Complexity | `gates/test-strength` and `gates/onkel` (D3: CRAP ≤ 6 per function) | cognitive complexity per function (rule `S3776`, default threshold 15); cyclomatic (`S1541`) where enabled | rules `S3776`, `S1541` |
| Debug leftovers | `gates/debug-leftovers` | console and debugger rules | rules `S1525`, `S2228`, `S106` |
| Coverage | D3 counts coverage inside CRAP, per function | coverage on new code as one number; the "Sonar way" quality gate fails under 80% | not mapped: a measure, not an issue |

The complexity rows measure different things. SonarQube flags a function that is hard to read
(cognitive complexity). CRAP flags a function whose complexity is not covered by tests. A function
can fail either one alone. That is why the two are recorded side by side and not swapped for each
other.

## What SonarQube does not check

These stay ours, whatever the numbers say:

- **Mutation testing** (D3): SonarQube runs no mutants, so a test that runs a line without checking
  it passes there.
- **CRAP as one number** (D3): complexity and coverage per function, judged together.
- **Red check** (D1): a new test must fail on the base code.
- **Test deletion** (D2): no test present at the base may disappear.
- **Skipped tests are not green** (C1): SonarQube's rule `S1607` only asks for a reason on a skip,
  and a skipped test still counts as passing.
- **Import boundaries** (C4): SonarQube's architecture rules need a paid edition or add-on
  (unverified; see 06-open-questions.md, section 7). Our boundaries gate needs none.
- Anything about the process: plan gate, handoffs, git guard, CI on the exact commit.

## Editions

| | Community Build | Developer Edition and above |
|---|---|---|
| Main branch analysis | yes | yes |
| Branch and pull request analysis | **no** | yes |
| Quality gate on a pull request | no | yes |
| Secrets detection | yes | yes, more kinds of secret |
| Taint analysis (security rules that follow data across functions) | no | yes |

With Community Build, the gate can only judge the main branch after a merge, never a pull request
before it. Before a merge, F1 (CI on the exact commit) and our own gates carry the decision alone.

Taint analysis is missing in Community Build. In the reference build a Semgrep security gate covers
the security rules within our own flow. Where the work edition lacks a security check, that gate is
the place to fill it.
