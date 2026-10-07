import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binCommand } from '../lib/node-bin.ts';
import { measureCognitive } from './cognitive.ts';
import { measureComplexity } from './complexity.ts';
import { scoreCrap, type FileCoverage } from './crap.ts';
import { machineReport, timeoutLine, timeoutOptions, timeoutWait, type StrykerTimeouts } from './machine.ts';
import { judge, skipsMutation, CRAP_CEILING, type MutantReport } from './policy.ts';
import { coverageArgs, PROPERTY_TESTS } from './property-tests.ts';
import { report } from './report.ts';
import { key, selectFiles, unexplainedMissing } from './select.ts';
import { broadDirectives, classifySuppressions, suppressionsOf, withSourceReasons } from './suppressions.ts';
import {
  changedRanges,
  emptyMeansMissed,
  mutateEntries,
  mutatedFiles as handedToStryker,
  parseArgs,
  splitByChange,
  strykerMissedFiles,
  untouchedFiles,
  untrackedChange,
  untrustedLines,
  widenToFunctions,
  type ChangedFile,
} from './scope.ts';

/**
 * `npm run quality -- <paths…>` — `/onkel` Mode A, the forward gate.
 *
 * The only module here that touches the filesystem or spawns a process.
 * Everything it decides is decided by the pure modules beside it, which are
 * specified by their own tests; this wires them to real coverage and a real
 * Stryker run.
 *
 * Scope is **the files one ticket touched**, and within them **the lines the
 * change touched** (`.scratch/onkel/GATE-SCOPE.md`; code-health/28): Stryker
 * mutates each function a changed line touched, whole, and a changed line
 * outside any function on its own; only functions overlapping a changed line
 * can fail the run. The rest are measured and reported as left standing. `--whole-file`
 * grades every function, for the post-test sweep; `--base <ref>` sets what the
 * change is measured against (default: the merge-base with `origin/main`).
 *
 * `.tsx` is excluded. Every `{cond && <X/>}` is a decision point, so a ceiling
 * of 6 would flag most components while saying nothing about them; mutation
 * testing reached the same scoping conclusion independently.
 *
 * Exit code 0 means pass, 1 means escalate. `/build-afk` treats escalate the
 * way it treats a red check: stop that task, leave the work, report.
 */

const CEILING_NOTE = `CRAP ceiling ${CRAP_CEILING} (a fully covered function scores its complexity)`;

// No shell on any platform: git is git.exe on Windows, and vitest and Stryker are started as
// `node <entry>` (gates/lib/node-bin.ts). The shell this used on Windows, for npx.cmd, joined the
// arguments unquoted, so a temp path with a space broke the run.
function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Istanbul coverage from a coverage-final.json, keyed by repo-relative path. */
function readCoverage(path: string): Record<string, FileCoverage> {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, FileCoverage & { path?: string }>;
  return Object.fromEntries(Object.entries(raw).map(([file, cov]) => [key(file), cov]));
}

/**
 * Istanbul coverage for the whole run: from the file `--coverage` names (a unit run already made
 * it, ticket 31: the suite runs once), else from a run of the suite made here.
 */
function collectCoverage(given: string | undefined): Record<string, FileCoverage> {
  if (given !== undefined) return readCoverage(given);
  const dir = mkdtempSync(join(tmpdir(), 'onkel-cov-'));
  try {
    run(...binCommand(process.cwd(), 'vitest', coverageArgs(dir)));
    return readCoverage(join(dir, 'coverage-final.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Modules mutation-tested only as far as their logic, not their plumbing.
 *
 * A scoping decision, taken openly, the way `.tsx` was — not a way past a
 * failure. This module is the one place that spawns `vitest` and `stryker`,
 * and killing every mutant in it means asserting the exact flags handed to a
 * subprocess. That is implementation detail: `/tdd` in this repo asks for
 * tests that survive an internal refactor, and a test pinning `--coverage.provider=v8`
 * fails the moment someone changes how coverage is collected without changing
 * what the tool decides.
 *
 * The bar is not lowered, it is aimed. **CRAP still applies here in full** —
 * this file is graded like any other and sits under the ceiling — and the
 * decisions that matter (which files are graded, which verdict is reported,
 * which exit code `/build-afk` sees) live in `select.ts`, `report.ts` and
 * `policy.ts`, all of which are mutation-tested — and since code-health/28, which
 * lines and functions count as the change, in `scope.ts`. What is exempt is
 * the wiring between them, git, and two child processes. (`report` and
 * `selectFiles` sat in this file until review #22, behind the exemption.)
 *
 * Anything added here that *decides* something belongs in a pure module beside
 * this one, not behind this exemption.
 */
// Projects add their own with `--exempt` (a pilot project: `src/db/schema.ts`, which
// declares tables and decides nothing a mutant could test). In the Workflow repo this file
// is exempt through its own project config, not through this list.
export const MUTATION_EXEMPT: string[] = [];

/**
 * Paths Stryker must not copy into its sandbox.
 *
 * The first five are Windows **junctions**. `New-Session.ps1` creates them so
 * every worktree shares the one canonical tracker instead of forking it — the
 * failure that cost four divergent copies of `.scratch`. Stryker builds its
 * sandbox with `copyfile`, and `copyfile` on a junction fails `EPERM`, so the
 * run dies before a single mutant is tested. Not a slow gate: no gate at all,
 * in every worktree that script creates.
 *
 * This did not surface when the gate was built because that session ran in a
 * `.claude/worktrees/` checkout — the one shape on this machine that has no
 * `.scratch` to trip over. The gate had therefore never run against the
 * documented topology.
 *
 * `.next` is not a junction, just build output the four checks leave behind.
 * Nothing here is ever mutated, so copying it is pure cost.
 */
// Generic defaults; a project adds its junctions with `--sandbox-ignore` (a pilot project:
// `.scratch`, `.agents`, `poc`, `docs/agents`).
// Property tests are left out too, so no mutant counts as killed by one (property-tests.ts).
export const SANDBOX_IGNORE = ['.claude', '.next', PROPERTY_TESTS];

/**
 * One Stryker run over exactly the `mutate` entries it is handed: its mutants,
 * and its log, which says how many files those entries resolved to.
 */
function collectMutants(
  mutate: string[],
  sandboxIgnore: string[],
  incrementalFile: string | undefined,
  timeouts: StrykerTimeouts,
): { mutants: MutantReport[]; log: string; untested?: boolean } {
  const dir = mkdtempSync(join(tmpdir(), 'onkel-mut-'));
  const configPath = join(dir, 'stryker.json');
  const reportPath = join(dir, 'mutation.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      $schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',
      packageManager: 'npm',
      testRunner: 'vitest',
      // Only what the change touched, which is the whole affordability
      // argument — see `mutateEntries` in `scope.ts`.
      mutate,
      reporters: ['json'],
      jsonReporter: { fileName: reportPath },
      tempDirName: join(dir, 'stryker-tmp'),
      coverageAnalysis: 'perTest',
      ignorePatterns: [...SANDBOX_IGNORE, ...sandboxIgnore],
      // Incremental: re-test only mutants whose code or tests changed since the last run.
      // Uncovered code needs no flag: with perTest coverage it reports NoCoverage without
      // running tests, and the verdict fails it as "no test reaches this".
      ...(incrementalFile ? { incremental: true, incrementalFile } : {}),
      // From the self-gate's config (ticket 31), so the evaluation can tune them; unset keeps Stryker's.
      ...timeouts,
    }),
    'utf8',
  );

  try {
    let log = '';
    try {
      log = run(...binCommand(process.cwd(), 'stryker', ['run', configPath]));
    } catch (error) {
      // A non-zero exit is how Stryker reports surviving mutants. That is a
      // verdict for `judge`, not a crash — read the report and let the policy
      // decide. A genuinely broken run shows up as a missing report below.
      log = String((error as { stdout?: unknown }).stdout ?? '');
    }

    if (!existsSync(reportPath)) {
      // Stryker stops before mutating when no test runs the files at all. That is a verdict
      // (write tests first), not a broken run.
      if (/No tests were executed/.test(log)) return { mutants: [], log, untested: true };
      throw new Error(`Stryker produced no report at ${reportPath}`);
    }
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      files: Record<
        string,
        {
          mutants: {
            location: { start: { line: number } };
            mutatorName: string;
            status: string;
            statusReason?: string;
          }[];
        }
      >;
    };

    const mutants = Object.entries(report.files).flatMap(([file, { mutants }]) =>
      mutants.map((m) => ({
        file: key(file),
        line: m.location.start.line,
        mutator: m.mutatorName,
        status: m.status,
        ignoreReason: m.statusReason,
      })),
    );
    return { mutants, log };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The lines of `files` this change added or modified, or null to grade whole
 * files. Null is also the answer when git cannot say — no merge-base with
 * `origin/main`, or a `--base` it cannot read — because grading more than the
 * change is the safe direction to be wrong in.
 */
function readChange(
  graded: { file: string; source: string }[],
  base: string | undefined,
): ChangedFile[] | null {
  const files = graded.map(({ file }) => file);
  try {
    const ref = base ?? run('git', ['merge-base', 'HEAD', 'origin/main']).trim();
    const diff = run('git', [
      '-c',
      'core.quotePath=false',
      'diff',
      '-U0',
      // A user's `diff.noprefix` or `diff.mnemonicPrefix` would change the
      // `b/` that `changedRanges` cuts off, and every path would miss.
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--relative',
      '--no-color',
      '--no-ext-diff',
      ref,
      '--',
      ...files,
    ]);
    const untracked = run('git', ['ls-files', '--others', '--exclude-standard', '--', ...files])
      .split('\n')
      .map(key);
    console.log(`Scope: the lines changed since ${ref} (--whole-file grades every function)\n`);
    return [
      ...changedRanges(diff),
      ...graded
        .filter(({ file }) => untracked.includes(file))
        .map(({ file, source }) => untrackedChange(file, source)),
    ];
  } catch {
    console.log(
      `git could not diff against ${base ?? 'the merge-base with origin/main'} — grading whole files instead.\n`,
    );
    return null;
  }
}

/**
 * The named paths among `missing` the change deleted since `base` (or the merge-base with
 * `origin/main`). A rename counts as deleting its old path. When git cannot say, none: a path
 * that is not there stays unexplained, and the run cannot go on (decision #37).
 */
function deletedFiles(missing: string[], base: string | undefined): string[] {
  try {
    const ref = base ?? run('git', ['merge-base', 'HEAD', 'origin/main']).trim();
    const names = run('git', ['-c', 'core.quotePath=false', 'diff', '--name-only', '--no-renames', '--diff-filter=D', '--relative', ref, '--', ...missing]);
    return names.split('\n').filter(Boolean).map(key);
  } catch {
    return [];
  }
}

/** The named source paths that do not exist and that the change did not delete. */
function absentPaths(missing: string[], argv: string[]): string[] {
  return missing.length === 0 ? [] : unexplainedMissing(missing, deletedFiles(missing, parseArgs(argv).base));
}

function announceSkipped(skipped: string[]): void {
  if (skipped.length > 0) console.log(`Not graded (.tsx, tests, or deleted): ${skipped.join(', ')}`);
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const { files, skipped, missing } = selectFiles(argv);
  if (files.length === 0 && skipped.length === 0) {
    console.error(
      'usage: node gates/onkel/run.ts [--whole-file] [--base <ref>] <path…>   (the files this ticket touched)',
    );
    return 2;
  }
  const absent = absentPaths(missing, argv);
  if (absent.length > 0) {
    console.error(`onkel could not run: ${absent.join(', ')} does not exist and the diff does not delete it`);
    return 2;
  }
  announceSkipped(skipped);
  if (files.length === 0) {
    console.log('Nothing to grade — no source .ts files in this ticket.');
    return 0;
  }

  console.log(`Grading ${files.length} file(s) — ${CEILING_NOTE}\n`);
  return grade(files, argv);
}

/** Says which named files this change left alone; they are not graded. */
function announceUntouched(files: string[], untouched: string[]): void {
  if (untouched.length === files.length)
    console.log(
      'No line of these files changed — nothing of this change to grade. ' +
        'Pass --whole-file, or a --base from before the change.\n',
    );
  else if (untouched.length > 0) console.log(`Unchanged, not graded: ${untouched.join(', ')}\n`);
}

/** The files mutation testing runs on: all but the built-in and the project's exemptions. */
function notExempt(files: string[], exempt: string[]): string[] {
  return files.filter((f) => !MUTATION_EXEMPT.includes(f) && !exempt.includes(f));
}

/** The Stryker run, or none: nothing to mutate, or CRAP already failed (decision #40). */
function mutationRun(mutate: string[], skipped: boolean, collect: () => ReturnType<typeof collectMutants>): ReturnType<typeof collectMutants> {
  return mutate.length > 0 && !skipped ? collect() : { mutants: [], log: '' };
}

/**
 * The changed lines Stryker may mutate: all of them, or with `--trust <tip>` only those that also
 * differ from that tip, whose own gate mutated the rest (ticket 31). CRAP still grades every one.
 */
function mutationScope(graded: { file: string; source: string }[], changed: ChangedFile[] | null, trust: string | undefined): ChangedFile[] | null {
  if (changed === null || trust === undefined) return changed;
  console.log(`Mutation scope: only the lines that differ from ${trust}; the rest is trusted from its gate\n`);
  return untrustedLines(changed, readChange(graded, trust));
}

/** Writes the run as data where `--json` says, when it says. */
function writeMachine(path: string | undefined, data: ReturnType<typeof machineReport>): void {
  if (path !== undefined) writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/** Measure everything, then let the change decide what is judged. */
function grade(files: string[], argv: string[]): number {
  const { wholeFile, base, exempt, sandboxIgnore, incrementalFile, trust, coverage: coverageFile, json, timeoutMs, timeoutFactor } = parseArgs(argv);
  const timeouts = timeoutOptions(timeoutMs, timeoutFactor);
  // Read once, scored twice: both metrics parse the same text, and a second
  // read would let them disagree about a file edited mid-run.
  const graded = files.map((file) => ({
    file,
    source: readFileSync(file, 'utf8'),
  }));
  const changed = wholeFile ? null : readChange(graded, base);
  announceUntouched(files, untouchedFiles(files, changed));

  const complexity = graded.map(({ file, source }) => measureComplexity(file, source));
  const coverage = collectCoverage(coverageFile);
  const { touched: crap, standing } = splitByChange(
    complexity.flatMap((fns, i) => scoreCrap(fns, coverage[files[i]])),
    changed,
  );
  const { touched: cognitive } = splitByChange(
    graded.flatMap(({ file, source }) => measureCognitive(file, source)),
    changed,
  );
  // The exemption is applied here rather than by dropping the file from
  // `files`, so it still gets a CRAP score and still appears in the report.
  // Stryker is handed each touched function whole, never bare changed lines:
  // it drops any mutant whose node reaches outside a range (`widenToFunctions`).
  const mutatedFiles = notExempt(files, exempt);
  const scope = mutationScope(graded, changed, trust);
  const mutate = mutateEntries(
    mutatedFiles,
    scope && widenToFunctions(scope, complexity.flat()),
  );
  const sourceOf = (file: string) => graded.find((g) => g.file === file)?.source;
  const mutationSkipped = skipsMutation(crap);
  const run = mutationRun(mutate, mutationSkipped, () => collectMutants(mutate, sandboxIgnore, incrementalFile, timeouts));
  const { log } = run;
  // code-health/33: judge each suppression on the reason its author wrote in the source.
  const mutants = withSourceReasons(run.mutants, sourceOf);

  // Whether an empty result means the run missed the change, or only that
  // there was nothing to mutate — see `emptyMeansMissed`.
  const verdict = judge({
    crap,
    mutants,
    ranMutation: emptyMeansMissed(files, mutate, changed, log),
    untested: run.untested ? handedToStryker(mutatedFiles, mutate) : [],
    missedFiles: strykerMissedFiles(mutate, log),
    mutationSkipped,
    broadDirectives: broadDirectives(graded, changed),
  });
  const exitCode = report(
    crap,
    cognitive,
    mutants,
    verdict,
    standing,
    // The reasons come from the source, not Stryker: it drops an em-dash reason.
    classifySuppressions(
      suppressionsOf(mutants, sourceOf),
      changed,
    ),
  );
  const waited = timeoutWait(mutants, log, timeouts);
  console.log(timeoutLine(waited));
  writeMachine(json, machineReport(files, crap, mutants, verdict, waited));
  return exitCode;
}
