// The run as data (ticket 31): what `--json <path>` writes, for the self-gate summary and for the
// cloud gate report a merge trusts (scripts/self-gate-core.ts), and what Stryker's timeouts cost.
// Stryker's timeoutMS and timeoutFactor come from the self-gate's config (config/self-gate.json),
// not from code, so the evaluation can tune them.

import type { CrapScore } from './crap.ts';
import { CONCLUSIVE_KILLS, CRAP_CEILING, killCount, type MutantReport, type Verdict } from './policy.ts';

export type StrykerTimeouts = { timeoutMS?: number; timeoutFactor?: number };
export type TimeoutWait = { count: number; waitMs: number };

/** Stryker's own defaults, which apply when none were configured. */
const DEFAULT_MS = 5000;
const DEFAULT_FACTOR = 1.5;

function positive(flag: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!(n > 0)) throw new Error(`${flag} must be a positive number, not "${value}"`);
  return n;
}

/** Stryker's timeout options from --timeout-ms and --timeout-factor; an unset one keeps Stryker's default. */
export function timeoutOptions(ms: string | undefined, factor: string | undefined): StrykerTimeouts {
  const timeoutMS = positive('--timeout-ms', ms);
  const timeoutFactor = positive('--timeout-factor', factor);
  return { ...(timeoutMS === undefined ? {} : { timeoutMS }), ...(timeoutFactor === undefined ? {} : { timeoutFactor }) };
}

/** Stryker's dry-run line: `Ran N tests in X (net <ms> ms, overhead <ms> ms).` */
const DRY_RUN = /net (\d+) ms, overhead (\d+) ms/;
/** No dry-run line: no net or overhead time known. */
const NO_DRY_RUN = [0, 0, 0];

/**
 * How many mutants timed out, and how long the run waited on them: each waited Stryker's
 * timeout, `timeoutFactor x net + timeoutMS + overhead` (mutant-test-planner.js), with the whole
 * dry run's net time, so the wait is an upper bound.
 */
export function timeoutWait(mutants: MutantReport[], log: string, options: StrykerTimeouts): TimeoutWait {
  const count = killCount(mutants).timeout;
  const [, net, overhead] = (DRY_RUN.exec(log) ?? NO_DRY_RUN).map(Number);
  const each = (options.timeoutFactor ?? DEFAULT_FACTOR) * net + (options.timeoutMS ?? DEFAULT_MS) + overhead;
  return { count, waitMs: count * each };
}

export const timeoutLine = (t: TimeoutWait) => `Stryker timeouts: ${t.count} mutant(s) timed out, waiting at most ${(t.waitMs / 1000).toFixed(1)} s in all`;

export type MachineReport = {
  verdict: Verdict['verdict'];
  files: string[];
  /** Killed (timeouts and compile errors count, as the verdict counts them) over every mutant not suppressed. */
  mutants: { killed: number; total: number };
  survivors: { file: string; line: number; mutator: string; status: string }[];
  suppressions: { file: string; line: number; mutator: string; reason: string }[];
  timeouts: TimeoutWait;
  highestCrap: number;
  /**
   * Each graded function over the CRAP ceiling, with the complexity and coverage behind its score
   * (ticket 39): complexity alone over the ceiling is the cleaner's to split, the rest the hardener's
   * to cover. Absent from a report written before it.
   */
  overCeiling?: CrapScore[];
  mutationSkipped: boolean;
};

export function machineReport(files: string[], crap: CrapScore[], mutants: MutantReport[], verdict: Verdict, timeouts: TimeoutWait): MachineReport {
  const counted = mutants.filter((m) => m.status !== 'Ignored');
  return {
    verdict: verdict.verdict,
    files,
    mutants: { killed: killCount(mutants).total, total: counted.length },
    survivors: counted.filter((m) => !CONCLUSIVE_KILLS.has(m.status)).map(({ file, line, mutator, status }) => ({ file, line, mutator, status })),
    suppressions: mutants.filter((m) => m.status === 'Ignored').map(({ file, line, mutator, ignoreReason }) => ({ file, line, mutator, reason: ignoreReason ?? '' })),
    timeouts,
    highestCrap: Math.max(0, ...crap.map((c) => c.crap)),
    overCeiling: crap.filter((c) => c.crap > CRAP_CEILING),
    mutationSkipped: verdict.mutationSkipped === true,
  };
}
