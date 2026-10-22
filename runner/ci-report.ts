// The CI report (ticket 31; named so since ticket 83, it was the cloud gate report). The run that
// builds a branch (a CI job, a cloud session) writes what its onkel run found to
// <report.dir>/<report.name> (config/runner.json; by default <branch>.gate.json), and commits it on the branch. The merge gate
// (`--merge <branch>`) reads it from the branch tip and trusts the lines the merge left identical to
// that tip only when the config trusts mutation results from a CI report and the report proves the
// CI gate graded them: it names the tip (no code changed since the gated commit, only the report
// folder and the configured ungraded paths), the work tree was clean when it ran, the base it graded
// from is on the branch being merged into, and it is green, with no surviving mutant. Anything else
// falls back to mutating every changed line, and the summary says why.

import type { MachineReport } from '../gates/onkel/machine.ts';
import { matchesAny, type RunnerConfig } from './runner-config.ts';

type Env = Record<string, string | undefined>;

export type CloudGateReport = Omit<MachineReport, 'verdict'> & {
  branch: string;
  /** The commit the cloud gate graded the change from, and the one it graded. */
  base: string;
  head: string;
  /** Whether the work tree held no change but ungraded paths (ungradedPaths) when the gate ran. */
  clean: boolean;
  /** The whole gate's verdict: every stage passed, onkel included. */
  verdict: 'pass' | 'fail';
};

export type Trust = { trusted: true; tip: string; report: CloudGateReport; path: string } | { trusted: false; reason: string };

/**
 * What git says about the report: the tip it is merged at, what changed since the gated commit
 * (undefined: git cannot say), whether its base is on the branch merged into; and the paths that
 * may change after it (ungradedPaths).
 */
export type TrustFacts = { tip: string; changedSinceGate: string[] | undefined; baseOnBranch: boolean; ungraded: string[] };

/** Paths that may change after the gate without making it stale: the report folder and the configured ungraded paths hold no graded line. */
export const ungradedPaths = (c: RunnerConfig) => [`${c.report.dir}/`, ...c.report.ungraded];

/** The branch as the run that built it named it: a ref's refs/heads/, or a remote's prefix (origin/, refs/remotes/<remote>/), dropped. */
export const sessionBranch = (ref: string) => ref.replace(/^(refs\/heads\/|refs\/remotes\/[^/]+\/|origin\/)/, '');

/**
 * Where a branch's CI report is: one file per branch in the configured folder, named by report.name
 * with {branch} as the branch, its slashes as dashes. The writer and the merge name the branch alike
 * (sessionBranch), so refs/heads/x from a pipeline and origin/x at the merge find the same file.
 */
export const reportPath = (c: RunnerConfig, branch: string) => `${c.report.dir}/${c.report.name.replaceAll('{branch}', sessionBranch(branch).replaceAll('/', '-'))}`;

const short = (sha: string) => sha.slice(0, 8);

const SHAPE: [keyof CloudGateReport, (v: unknown) => boolean][] = [
  ['base', (v) => typeof v === 'string'],
  ['head', (v) => typeof v === 'string'],
  ['clean', (v) => typeof v === 'boolean'],
  ['verdict', (v) => typeof v === 'string'],
  ['survivors', Array.isArray],
  ['mutants', (v) => ['killed', 'total'].every((k) => typeof Object(v)[k] === 'number')],
];

function objectOf(text: string): Record<string, unknown> {
  try {
    return Object(JSON.parse(text)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** The report at `path` on the branch, or why it cannot be read. */
export function parseCloudReport(text: string | undefined, path: string): CloudGateReport | { reason: string } {
  if (text === undefined) return { reason: `no ${path} on the branch` };
  const r = objectOf(text);
  return SHAPE.every(([k, ok]) => ok(r[k])) ? (r as CloudGateReport) : { reason: `${path} is not a gate report` };
}

function staleness(r: CloudGateReport, f: TrustFacts): string | undefined {
  if (f.changedSinceGate === undefined) return `stale: git cannot compare its gated commit ${short(r.head)} with the tip ${short(f.tip)}`;
  const code = f.changedSinceGate.filter((p) => !matchesAny(p, f.ungraded));
  return code.length > 0 ? `stale: it gated ${short(r.head)}, and the tip ${short(f.tip)} changed ${code.join(', ')} since` : undefined;
}

type Check = (r: CloudGateReport, f: TrustFacts) => string | undefined;

/** Each reason not to trust a report, in the order they are told; undefined when it does not apply. */
const CHECKS: Check[] = [
  (r) => (r.clean ? undefined : 'the CI gate ran on uncommitted changes'),
  staleness,
  (r, f) => (f.baseOnBranch ? undefined : `it graded the change since ${short(r.base)}, which is not on the branch being merged into`),
  (r) => (r.verdict === 'pass' ? undefined : 'red: the CI gate failed'),
  (r) => (r.survivors.length === 0 ? undefined : `red: ${r.survivors.length} surviving mutant(s)`),
  (r) => (r.mutants.killed < r.mutants.total ? `red: ${r.mutants.killed} of ${r.mutants.total} mutants killed` : undefined),
];

/** Why the report cannot be trusted, or null when it can. */
export function judgeCloudReport(r: CloudGateReport, f: TrustFacts): string | null {
  for (const check of CHECKS) {
    const reason = check(r, f);
    if (reason !== undefined) return reason;
  }
  return null;
}

export function trustLine(t: Trust): string {
  if (!t.trusted) return `mutation: every changed line (no trusted CI report: ${t.reason})`;
  const { head, mutants } = t.report;
  return `mutation: only the lines that differ from ${short(t.tip)}; the rest is trusted from ${t.path} (gated ${short(head)}, ${mutants.killed}/${mutants.total} mutants killed)`;
}

/**
 * The branch a run writes its CI report for: --report, else in a CI run (the configured variable,
 * report.env, is 'true') the checked-out branch; none on a detached head.
 */
export function reportBranch(flag: string | undefined, env: Env, currentBranch: string, ciVariable: string): string | undefined {
  if (flag !== undefined) return flag;
  const branch = currentBranch.trim();
  return env[ciVariable] === 'true' && branch !== '' && branch !== 'HEAD' ? branch : undefined;
}

const NOTHING_GRADED: Omit<MachineReport, 'verdict'> = { files: [], mutants: { killed: 0, total: 0 }, survivors: [], suppressions: [], timeouts: { count: 0, waitMs: 0 }, highestCrap: 0, mutationSkipped: false };

/** `git status --porcelain` with nothing but ungraded paths changed. */
const isClean = (status: string, ungraded: string[]) => status.split('\n').every((line) => line === '' || matchesAny(line.slice(3), ungraded));

/** The report a gate run writes: onkel's result (none: nothing to grade) with what it graded and the whole gate's exit. */
export function cloudGateReport(run: { branch: string; base: string; head: string; status: string }, onkel: MachineReport | undefined, exit: number, ungraded: string[]): CloudGateReport {
  return { ...NOTHING_GRADED, ...onkel, branch: run.branch, base: run.base, head: run.head, clean: isClean(run.status, ungraded), verdict: exit === 0 ? 'pass' : 'fail' };
}
