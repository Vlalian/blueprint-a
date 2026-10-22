// What `node scripts/self-gate.ts` does, with every outside thing (git, the steps it spawns, files,
// the clock) injected, so it is tested with fakes; scripts/self-gate.ts only wires in the real ones.
//
// Normal mode (`--base <ref> [--integration]`, what a cloud session runs): typecheck, the unit
// tests, the integration tests when asked, then onkel (CRAP and mutation) on the source files
// changed since <ref>. Merge mode (`--merge <cloud branch>`, ticket 31, the gate a merge into an
// integration branch runs on this PC): the unit tests run once, with coverage that onkel grades
// CRAP from; since ticket 56 only the unit and integration tests the change can reach run (all of
// them when that cannot be told, and every integration test with --integration), a changed file
// no test reaches fails the gate, and the selection is logged; and Stryker mutates only the lines that differ from the cloud
// branch's tip when its gate report proves its own gate mutated the rest (self-gate-cloud.ts).
// Every run appends one gate observation per stage with its ms, the unit stage naming the ten
// slowest test files, and prints the stage times. A run in a cloud session (or with --report
// <branch>) writes its gate report, which cloud-export.ts commits with the carry-back file; a
// merge-mode run writes none, since it mutated only what it did not trust.
// Merge mode also runs the sast gate (ticket 60): Semgrep's pinned security rules on the files
// changed since the base; a new ERROR finding fails the merge, and each finding is logged as an
// observation with source sast (dispatcher/sast-records.ts).
// Merge mode also asks the repo's own merge check when config/runner.json names one (ticket 83,
// merge-check.ts; this repo's asks whether the owner chose the change, ticket 64): its lines are
// printed first, a refusal fails the merge, and a merge that passes logs its records.
// What is tied to a repo (the folders it grades and walks, the shells, the CI report's folder, the
// CRAP limit, the state folder) is config/runner.json's (ticket 83, runner-config.ts).
// Exit 0 when every stage passes, 1 when one fails, 2 when one could not run.

import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { baseOf, observationLine, OBSERVATIONS, type SlowTestFile } from './observations.ts';
import { timeoutLine, type MachineReport } from '../gates/onkel/machine.ts';
import { cloudGateReport, judgeCloudReport, parseCloudReport, reportBranch, reportPath, trustLine, ungradedPaths, type CloudGateReport, type Trust, type TrustFacts } from './ci-report.ts';
import { changedPaths, gradableFiles, objectOf, onkelArgs, seconds, slowestTestFiles, slowLines, stageObservations, timeoutArgs } from './self-gate-core.ts';
import { emitsCode } from './affected-deps.ts';
import { sastObservations } from './sast-records.ts';
import { sastLines, type SastResult } from '../gates/sast/gate.ts';
import { cruiseArgs, CRUISER, LS_FILES, moduleGraph, selectionExit, selectionLines, selectionRecord, selectTests, type Selection } from './self-gate-select.ts';
import type { MergeCheck, MergeVerdict } from './merge-check.ts';
import { parseRunnerConfig, RUNNER_CONFIG, type RunnerConfig } from './runner-config.ts';
import { checkSteps, sastStep, stepStatus, timedLine, worstExit, type Stage, type Step, type StepOptions } from './self-gate-run.ts';
import { SHELLS } from './self-gate-shells.ts';
import { LS_SOURCES, shellsIn } from './shells.ts';

type Env = Record<string, string | undefined>;

export interface SelfGateIo {
  /** This repo's root; the steps run there. */
  root: string;
  /** git in the root; never throws. */
  git(args: string[]): { status: number | null; stdout: string; stderr: string };
  /** Runs a step with its output shown; its exit status (null when it died). */
  run(step: Step): number | null;
  /** Runs a command in the root with its output captured (dependency-cruiser, ticket 56); never throws. */
  capture(command: string, args: string[]): { status: number | null; stdout: string };
  /** A file's text by absolute path; undefined when it does not exist. */
  read(path: string): string | undefined;
  write(path: string, text: string): void;
  append(path: string, text: string): void;
  exists(path: string): boolean;
  /** A new empty folder for this run's reports. */
  tempDir(): string;
  /** Milliseconds, for stage times. */
  clock(): number;
  /** The time as ISO text, for the observations. */
  now(): string;
  out(text: string): void;
  err(text: string): void;
  /** The repo's merge check (config/runner.json mergeCheck), as the shell loaded it: none, or why it could not. */
  mergeCheck?: MergeCheck | Error;
}

type Args = { base: string; integration: boolean; merge?: string; report?: string };
type Result = { id: Stage; name: string; status: 0 | 1 | 2; ms: number };
type Paths = { testJson: string; coverageDir: string; onkelJson: string; sastJson: string };

const USAGE = 'usage: node scripts/self-gate.ts [--base <ref>] [--integration] [--merge <branch>] [--report <branch>]\n';
const OPTIONS = { base: { type: 'string' }, integration: { type: 'boolean', default: false }, merge: { type: 'string' }, report: { type: 'string' } } as const;

const refuse = (io: SelfGateIo, text: string) => (io.err(text), 2);

/** git's output, or undefined when the command failed. */
const gitOut = (io: SelfGateIo, args: string[]) => {
  const r = io.git(args);
  return r.status === 0 ? r.stdout : undefined;
};

/** git's output, or nothing when the command failed. */
const gitText = (io: SelfGateIo, args: string[]) => gitOut(io, args) ?? '';

const headOf = (io: SelfGateIo) => gitText(io, ['rev-parse', 'HEAD']).trim();

function factsOf(report: CloudGateReport, tip: string, c: RunnerConfig, io: SelfGateIo): TrustFacts {
  return {
    tip,
    changedSinceGate: gitOut(io, ['diff', '--name-only', report.head, tip])?.split('\n').filter(Boolean),
    baseOnBranch: io.git(['merge-base', '--is-ancestor', report.base, 'HEAD']).status === 0,
    ungraded: ungradedPaths(c),
  };
}

/** Whether the branch's CI report lets the merge trust the lines it left identical to the tip. */
function cloudTrust(merge: string, c: RunnerConfig, io: SelfGateIo): Trust {
  if (!c.report.trusted.includes('mutation')) return { trusted: false, reason: `${RUNNER_CONFIG} trusts no mutation result from a CI report` };
  const tip = gitOut(io, ['rev-parse', '--verify', `${merge}^{commit}`])?.trim();
  if (tip === undefined) return { trusted: false, reason: `git cannot find the branch ${merge}` };
  const path = reportPath(c, merge);
  const report = parseCloudReport(gitOut(io, ['show', `${tip}:${path}`]), path);
  if ('reason' in report) return { trusted: false, reason: report.reason };
  const reason = judgeCloudReport(report, factsOf(report, tip, c, io));
  return reason === null ? { trusted: true, tip, report, path } : { trusted: false, reason };
}

/**
 * Merge mode's tests (ticket 56): those the change can reach, or all of them when the selection
 * fails closed; --integration still runs every integration test.
 */
function stepOptions(args: Args, selection: Selection | undefined, p: Paths, c: RunnerConfig): StepOptions {
  const o = { integration: args.integration, testJson: p.testJson, merge: args.merge, integrationConfig: c.integrationTests.config };
  if (selection === undefined) return o;
  // A selection that fails closed has no lists, and no list runs every test file. The integration
  // stage runs over the selected files, none of them being no stage at all.
  const chosen = selection as { unit?: string[]; integration?: string[] };
  return { ...o, integration: true, coverageDir: p.coverageDir, unitTests: chosen.unit, integrationTests: args.integration ? undefined : chosen.integration };
}

/** The tests the change can reach, from dependency-cruiser's graph of the root and the files git lists. */
function select(changed: string[], graded: string[], shells: string[], c: RunnerConfig, io: SelfGateIo): Selection {
  const cruise = io.capture(process.execPath, [join(io.root, ...CRUISER), ...cruiseArgs(c.graphDirs)]);
  const files = gitText(io, LS_FILES).split(/\r?\n/);
  const graph = moduleGraph(cruise.stdout, files, (p) => io.read(join(io.root, p)));
  // A file of types only has nothing a test could run; an unreadable one stays graded.
  const runs = (f: string) => {
    const text = io.read(join(io.root, f));
    return text === undefined || emitsCode(text);
  };
  return selectTests(changed, graph, graded.filter(runs), [...c.exempt, ...shells], { wholeSuite: c.wholeSuite, integrationSuffix: c.integrationTests.suffix });
}

/** Merge mode's onkel flags: the unit run's coverage, and the trusted tip when there is one. */
/** Without a unit run (no unit test selected) there is no coverage, and onkel measures its own. */
const mergeFlags = (p: Paths, trust: Trust | undefined, covered: boolean) =>
  trust === undefined ? [] : [...(covered ? ['--coverage', join(p.coverageDir, 'coverage-final.json')] : []), ...(trust.trusted ? ['--trust', trust.tip] : [])];

type Grading = { files: string[]; shells: string[]; trust: Trust | undefined; covered: boolean };

function onkelSteps(args: Args, g: Grading, p: Paths, c: RunnerConfig, io: SelfGateIo): Step[] {
  if (g.files.length === 0) return [];
  const timeouts = timeoutArgs(io.read(join(io.root, c.strykerConfig)));
  const shells = g.shells.flatMap((s) => ['--exempt', s]);
  const args_ = ['gates/onkel/run.ts', ...onkelArgs(args.base, g.files, c), ...shells, ...timeouts, '--json', p.onkelJson, ...mergeFlags(p, g.trust, g.covered)];
  return [{ id: 'onkel', name: `onkel on ${g.files.length} file(s)`, command: process.execPath, args: args_ }];
}

function timed(step: Step, io: SelfGateIo): Result {
  const start = io.clock();
  const status = stepStatus(io.run(step));
  return { id: step.id, name: step.name, status, ms: io.clock() - start };
}

/** onkel's --json result; none when it wrote none. */
function machineOf(text: string | undefined): MachineReport | undefined {
  const parsed = objectOf(text);
  return 'mutants' in parsed ? (parsed as MachineReport) : undefined;
}

const onkelLines = (o: MachineReport | undefined) =>
  o === undefined ? [] : [`onkel: ${o.mutants.killed}/${o.mutants.total} mutants killed, highest CRAP ${o.highestCrap}`, timeoutLine(o.timeouts)];

type Run = { results: Result[]; onkel: MachineReport | undefined; slowest: SlowTestFile[]; trust: Trust | undefined; selection: Selection | undefined; sast: SastResult | undefined };

/** The sast stage's --json result; none when it wrote none or wrote something else. */
function sastOf(text: string | undefined): SastResult | undefined {
  const parsed = objectOf(text);
  return parsed.gate === 'sast' ? (parsed as SastResult) : undefined;
}

/** Merge mode's sast stage (ticket 60); none in normal mode. */
const sastSteps = (args: Args, p: Paths) => (args.merge === undefined ? [] : [sastStep(args.base, p.sastJson)]);

/** What the sast stage wrote, when it ran. */
const sastRead = (results: Result[], p: Paths, io: SelfGateIo) => (results.some((r) => r.id === 'sast') ? sastOf(io.read(p.sastJson)) : undefined);

const sastSummary = (r: SastResult | undefined) => (r === undefined ? [] : sastLines(r).map((l) => `sast: ${l}`));

function summarize(r: Run, io: SelfGateIo): void {
  const total = r.results.reduce((sum, x) => sum + x.ms, 0);
  const trusted = r.trust === undefined ? [] : [trustLine(r.trust)];
  const selected = r.selection === undefined ? [] : selectionLines(r.selection);
  io.out(['', 'Self-gate:', ...r.results.map(timedLine), `  total  ${seconds(total)}`, ...selected, ...trusted, ...sastSummary(r.sast), ...onkelLines(r.onkel), ...slowLines(r.slowest), ''].join('\n'));
}

/** The run's state folder: WORKFLOW_STATE_DIR, else the configured one in the root. */
const stateDir = (env: Env, c: RunnerConfig, io: SelfGateIo) => env.WORKFLOW_STATE_DIR ?? join(io.root, c.stateDir);

/** One gate observation per stage, in the run's state folder. */
function observe(r: Run, changed: string[], args: Args, env: Env, c: RunnerConfig, io: SelfGateIo): void {
  const now = baseOf(env, io.now());
  const base = { ...now, ticket: now.ticket || (args.merge ?? '') };
  const head = headOf(io);
  const selected = r.selection === undefined ? [] : [selectionRecord(base, head, changed, r.selection)];
  const sast = r.sast === undefined ? [] : sastObservations(base, head, r.sast);
  const records = [...stageObservations(base, head, r.results, r.slowest), ...selected, ...sast];
  io.append(join(stateDir(env, c, io), OBSERVATIONS), records.map(observationLine).join(''));
}

/** The CI report, for --report's branch or a CI run's own. */
function writeReport(args: Args, env: Env, onkel: MachineReport | undefined, exit: number, c: RunnerConfig, io: SelfGateIo): void {
  const branch = reportBranch(args.report, env, gitText(io, ['rev-parse', '--abbrev-ref', 'HEAD']), c.report.env);
  if (branch === undefined) return;
  const path = reportPath(c, branch);
  const base = gitOut(io, ['rev-parse', '--verify', `${args.base}^{commit}`])?.trim() ?? args.base;
  // When git cannot say, the tree reads as changed, so the report is never trusted on a guess.
  const status = gitOut(io, ['status', '--porcelain']) ?? '?? git status failed';
  io.write(join(io.root, path), `${JSON.stringify(cloudGateReport({ branch, base, head: headOf(io), status }, onkel, exit, ungradedPaths(c)), null, 2)}\n`);
  io.out(`gate report: ${path}\n`);
}

function gate(args: Args, changed: string[], env: Env, c: RunnerConfig, io: SelfGateIo): number {
  const tmp = io.tempDir();
  const paths: Paths = { testJson: join(tmp, 'tests.json'), coverageDir: join(tmp, 'coverage'), onkelJson: join(tmp, 'onkel.json'), sastJson: join(tmp, 'sast.json') };
  const trust = args.merge === undefined ? undefined : cloudTrust(args.merge, c, io);
  const files = gradableFiles(changed, (p) => io.exists(join(io.root, p)), c.sourceDirs);
  const shells = shellsIn(SHELLS, gitText(io, LS_SOURCES), (p) => io.read(join(io.root, p)));
  const selection = args.merge === undefined ? undefined : select(changed, files, shells, c, io);
  const checks = checkSteps(io.root, stepOptions(args, selection, paths, c));
  const steps = [...checks, ...sastSteps(args, paths), ...onkelSteps(args, { files, shells, trust, covered: checks.some((s) => s.id === 'unit') }, paths, c, io)];
  const results = steps.map((s) => timed(s, io));
  const exit = worstExit([...results.map((r) => r.status), selection === undefined ? 0 : selectionExit(selection)]);
  const onkel = results.some((r) => r.id === 'onkel') ? machineOf(io.read(paths.onkelJson)) : undefined;
  const run: Run = { results, onkel, slowest: slowestTestFiles(io.read(paths.testJson), io.root), trust, selection, sast: sastRead(results, paths, io) };
  summarize(run, io);
  observe(run, changed, args, env, c, io);
  if (args.merge === undefined) writeReport(args, env, onkel, exit, c, io);
  return exit;
}

/** The flags; undefined for a flag it does not know, so the usage is shown. */
function argsOf(argv: string[]): Partial<Args> | undefined {
  try {
    return parseArgs({ args: argv, options: OPTIONS }).values;
  } catch {
    // An unknown flag: fall through to no flags.
  }
  return undefined;
}

/** Merge mode's repo check, asked before the gate so a refusal is the first thing shown; none outside merge mode or without one. */
function verdictOf(merge: string | undefined, base: string, io: SelfGateIo): MergeVerdict | undefined {
  const check = io.mergeCheck as MergeCheck | undefined;
  if (merge === undefined || check === undefined) return undefined;
  const verdict = check(merge, base, (args) => gitOut(io, args));
  io.err(verdict.lines.join('\n'));
  return verdict;
}

/** The gate's exit with the check's: a refused merge fails; the records of one that passed are logged. */
function settle(verdict: MergeVerdict | undefined, exit: number, env: Env, c: RunnerConfig, io: SelfGateIo): number {
  if (verdict === undefined) return exit;
  if (verdict.refused) return worstExit([exit, 1]);
  const records = exit === 0 ? verdict.records(baseOf(env, io.now())) : [];
  for (const r of records) io.append(join(stateDir(env, c, io), OBSERVATIONS), observationLine(r));
  return exit;
}

/** config/runner.json over its defaults; or why it cannot be read, and the merge check's load error. */
function configOf(io: SelfGateIo): RunnerConfig | string {
  if (io.mergeCheck instanceof Error) return io.mergeCheck.message;
  try {
    return parseRunnerConfig(io.read(join(io.root, RUNNER_CONFIG)));
  } catch (e) {
    return (e as Error).message;
  }
}

/** Without --base the change is graded since the configured integration branch. */
export function selfGate(argv: string[], env: Env, io: SelfGateIo): number {
  const flags = argsOf(argv);
  if (flags === undefined) return refuse(io, USAGE);
  const c = configOf(io);
  if (typeof c === 'string') return refuse(io, `${c}\n`);
  const { base = c.integrationBranch, ...rest } = flags;
  const diff = io.git(['diff', '--name-only', base, '--']);
  if (diff.status !== 0) return refuse(io, `git diff against ${base} failed:\n${diff.stderr}`);
  // New files a ticket has not staged yet are changes too; without them onkel would skip them.
  const changed = changedPaths(diff.stdout, io.git(['ls-files', '--others', '--exclude-standard']).stdout);
  const verdict = verdictOf(rest.merge, base, io);
  return settle(verdict, gate({ ...rest, integration: rest.integration === true, base }, changed, env, c, io), env, c, io);
}
