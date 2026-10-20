# Pinned Semgrep rules (ticket 60)

The sast gate (`gates/sast`) runs only the rules in this folder, so a run never needs the network.
`SNAPSHOT.json` names the Semgrep version they were recorded with, the commit of
[semgrep/semgrep-rules](https://github.com/semgrep/semgrep-rules) they were copied from, and every file
and rule; `gates/sast/snapshot.test.ts` proves the list matches the folder.

## Licence

The rule files are Semgrep's, under the **Semgrep Rules License v1.0**
(<https://semgrep.dev/legal/rules-license>): use for internal business purposes is allowed; the rules
may not be redistributed, offered to others as a service, or used in a competing product, and their
notices must be kept. They are copied here unchanged into a private repository for that internal use.
For the same reason the Blueprint A export carries `SNAPSHOT.json` and this README, not the rule files:
a team that adopts it copies the rules itself, below.

## What is in the snapshot

Every rule file under `javascript/`, `typescript/` and `csharp/` of semgrep-rules whose rules are all
`metadata.category: security` and run only on JavaScript, TypeScript or C#. That is the security part of
the registry packs `p/typescript`, `p/javascript`, `p/csharp`, `p/owasp-top-ten` and `p/security-audit`
for those languages (the packs are built from these folders' security rules). Left out: the rule repo's
test files, non-security rules (best practice, correctness, performance), and files that also target
HTML templates, YAML or `web.config` (the gate scans source files only). The registry itself
(semgrep.dev) could not be reached from the build session, so pack membership was not compared rule by
rule (unverified).

## Rebuilding it

1. `pip install semgrep==<version>` (Python 3.10 or later; Linux, macOS, or Windows 11 natively).
2. `git clone https://github.com/semgrep/semgrep-rules` and check out the commit to pin.
3. Copy the files the selection above keeps into this folder at the same paths (to restore this
   snapshot exactly, copy the files `SNAPSHOT.json` lists from the commit it names).
4. Rewrite `SNAPSHOT.json` (version, commit, date, files, rules) and `PINNED_SEMGREP` in
   `gates/sast/core.ts`.
5. Re-record the Semgrep output in `test/fixtures/sast/` (each case's `head/` and `base/`, run in that
   folder with
   `semgrep scan --config <rules> --json --metrics=off --disable-version-check --disable-nosem -- <files>`,
   the `time` and `profiling_results` fields dropped) and run the gate's tests. The TypeScript
   sources there are stored as `.ts.txt` (Stryker's sandbox would put a line on top of a `.ts`
   file); name them `.ts` while recording.
