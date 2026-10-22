// Which of the repo's own files the gates grade, and how onkel is called on them.
// The owner's rule (2026-10-03): the workflow's gates run on the workflow's own code for every ticket.
// Ticket 31 adds the merge gate's rules: Stryker's timeouts from a config file, the slowest test
// files, and one gate observation per stage. Since ticket 83 the source folders, the I/O shells
// exempt from mutation (they spawn processes and touch the file system; the deciding logic lives in
// pure modules beside them, which are graded), the folders kept out of Stryker's sandbox (runtime
// and fixture folders hold junctions and throwaway repos) and the CRAP limit are config/runner.json's.

import type { GateVerdict, Observation, ObservationBase, SlowTestFile } from './observations.ts';
import type { RunnerConfig } from './runner-config.ts';
import type { Stage } from './self-gate-run.ts';

/** The paths a change touched: what `git diff --name-only` printed plus the untracked files. */
export function changedPaths(diffNames: string, untracked: string): string[] {
  return [...new Set(`${diffNames}\n${untracked}`.split('\n').filter(Boolean))];
}

/** The changed TypeScript sources, tests left out, under one of the configured source folders and still there. */
export function gradableFiles(changed: string[], exists: (path: string) => boolean, sourceDirs: string[]): string[] {
  return changed.filter((p) => sourceDirs.some((d) => p.startsWith(`${d}/`)) && p.endsWith('.ts') && !p.endsWith('.test.ts') && exists(p));
}

/** The I/O shells exempted, the runtime folders kept out of the Stryker sandbox and the CRAP limit, as onkel flags. */
const selfExclusions = (c: RunnerConfig) => [...c.exempt.flatMap((f) => ['--exempt', f]), ...c.sandboxIgnore.flatMap((d) => ['--sandbox-ignore', d]), '--crap-ceiling', String(c.crapLimit)];

export function onkelArgs(base: string, files: string[], c: RunnerConfig): string[] {
  return ['--base', base, ...selfExclusions(c), ...files];
}

/**
 * The self-gate's onkel flags without the base and the files: the exclusions, the process shells'
 * exemptions and the Stryker timeouts of the config's strykerConfig file (its text). The workflow
 * project's hardener check (`gates/hardener/cli.ts --self`, ticket 41) grades its worktree with
 * them, as the self-gate would.
 */
export function selfOnkelFlags(shells: string[], stryker: string | undefined, c: RunnerConfig): string[] {
  return [...selfExclusions(c), ...shells.flatMap((s) => ['--exempt', s]), ...timeoutArgs(stryker)];
}

/** A JSON object's fields; none for no text, text that is not JSON, or a JSON value that is not an object. */
export function objectOf(text: string | undefined): Record<string, unknown> {
  try {
    return Object(JSON.parse(text as string)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** onkel's timeout flags from the strykerConfig file's `stryker`; an unset value keeps Stryker's default. */
export function timeoutArgs(config: string | undefined): string[] {
  const stryker = Object(objectOf(config).stryker) as Record<string, unknown>;
  const flags: [string, unknown][] = [
    ['--timeout-ms', stryker.timeoutMS],
    ['--timeout-factor', stryker.timeoutFactor],
    ['--dry-run-timeout-minutes', stryker.dryRunTimeoutMinutes],
  ];
  return flags.flatMap(([flag, value]) => (value === undefined ? [] : [flag, String(value)]));
}

const SLOWEST = 10;
const forward = (p: string) => p.replaceAll('\\', '/');

/** The ten slowest test files in vitest's JSON report, slowest first, by repo path; none without a report. */
export function slowestTestFiles(json: string | undefined, root: string): SlowTestFile[] {
  const results = objectOf(json).testResults;
  const prefix = `${forward(root)}/`;
  // Object.values: an array's items, and none for anything else.
  const files = (Object.values(Object(results)) as { name?: unknown; startTime?: unknown; endTime?: unknown }[]).map((r) => ({
    file: forward(String(r.name)).replace(prefix, ''),
    ms: Number(r.endTime) - Number(r.startTime),
  }));
  return files
    .filter((f) => Number.isFinite(f.ms))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, SLOWEST);
}

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export const slowLines = (slowest: SlowTestFile[]) => (slowest.length === 0 ? [] : ['Slowest test files:', ...slowest.map((s) => `  ${seconds(s.ms)}  ${s.file}`)]);

const VERDICTS: GateVerdict[] = ['pass', 'fail', 'could-not-run'];

/** One gate observation per stage (gate `self-gate-<stage>`, its verdict and ms); the unit stage names the slowest test files. */
export function stageObservations(base: ObservationBase, sha: string, results: { id: Stage; status: 0 | 1 | 2; ms: number }[], slowest: SlowTestFile[]): Observation[] {
  return results.map((r) => ({
    ...base,
    kind: 'gate',
    gate: `self-gate-${r.id}`,
    sha,
    verdict: VERDICTS[r.status],
    reasons: [],
    ms: r.ms,
    ...(r.id === 'unit' ? { slowest } : {}),
  }));
}
