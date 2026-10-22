// What `node scripts/full-run.ts` does (ticket 56), with git, the steps, files and the clock injected;
// scripts/full-run.ts only wires in the real ones. The whole suite, unit and integration, as the
// safety net under the fast merge gate's test selection. Decided in the grill (2026-10-05): it runs
// when the integration branch is promoted to main (`--why promote`) and once a night when the PC is
// idle (`--why idle`: skipped while a run holds config/runner.json's busyLock in the state folder, or
// a merge is in progress, which is when a merge gate runs). It records the run, and each failing test file no merge since its
// last run selected as a selection miss (dispatcher/selection.ts), which the briefing shows.
// Exit 0 when every test passes or an idle run is skipped, 1 when a test fails, 2 when a step
// could not run or the arguments are wrong.

import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { appendObservations, baseOf, OBSERVATIONS, parseObservations, type Observation } from './observations.ts';
import type { FullRunWhy } from './selection-records.ts';
import { missLine, selectionMisses } from './selection.ts';
import { binCommand } from '../gates/lib/node-bin.ts';
import { parseRunnerConfig, RUNNER_CONFIG, type RunnerConfig } from './runner-config.ts';
import { objectOf } from './self-gate-core.ts';
import { stepStatus, timedLine, worstExit, type Step } from './self-gate-run.ts';

type Env = Record<string, string | undefined>;

export interface FullRunIo {
  root: string;
  /** git in the root; never throws. */
  git(args: string[]): { status: number | null; stdout: string };
  /** Runs a step with its output shown; its exit status (null when it died). */
  run(step: Step): number | null;
  read(path: string): string | undefined;
  append(path: string, text: string): void;
  exists(path: string): boolean;
  /** A new empty folder for the run's reports. */
  tempDir(): string;
  clock(): number;
  now(): string;
  out(text: string): void;
  err(text: string): void;
}

const USAGE = 'usage: node scripts/full-run.ts --why promote|idle\n';
const WHYS: readonly string[] = ['promote', 'idle'] satisfies FullRunWhy[];

/** --why's value; none when it is missing or not one of WHYS (unknown flags are let through, not thrown). */
function whyOf(argv: string[]): FullRunWhy | undefined {
  const why = parseArgs({ args: argv, options: { why: { type: 'string' } }, strict: false }).values.why;
  return WHYS.includes(why as string) ? (why as FullRunWhy) : undefined;
}

/** Why the PC is not idle: a run holds the busy lock, or a merge (and so its gate) is under way. */
function busy(stateDir: string, c: RunnerConfig, io: FullRunIo): string | undefined {
  if (io.exists(join(stateDir, c.busyLock))) return `a run is active (${c.stateDir}/${c.busyLock})`;
  return io.git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']).status === 0 ? 'a merge is in progress, so its gate may be running' : undefined;
}

const forward = (p: string) => p.replaceAll('\\', '/');

/** The test files vitest's JSON report marks failed, by repo path. */
export function failedFiles(json: string | undefined, root: string): string[] {
  const results = Object.values(Object(objectOf(json).testResults)) as { name?: unknown; status?: unknown }[];
  return results.filter((r) => r.status === 'failed').map((r) => forward(String(r.name)).replace(`${forward(root)}/`, ''));
}

const suite = (root: string, id: 'unit' | 'integration', json: string, config: string[]): Step => {
  const [command, args] = binCommand(root, 'vitest', ['run', ...config, '--reporter=default', '--reporter=json', `--outputFile.json=${json}`]);
  return { id, name: `${id} tests (all)`, command, args };
};

type Ran = { step: Step; json: string; status: 0 | 1 | 2; ms: number };

function runSuites(c: RunnerConfig, io: FullRunIo): Ran[] {
  const tmp = io.tempDir();
  const plan: ['unit' | 'integration', string[]][] = [
    ['unit', []],
    ['integration', ['--config', c.integrationTests.config]],
  ];
  return plan.map(([id, config]) => {
    const json = join(tmp, `${id}.json`);
    const step = suite(io.root, id, json, config);
    const start = io.clock();
    const status = stepStatus(io.run(step));
    return { step, json, status, ms: io.clock() - start };
  });
}

function record(why: FullRunWhy, ran: Ran[], failing: string[], env: Env, io: FullRunIo, stateDir: string): string[] {
  const path = join(stateDir, OBSERVATIONS);
  const misses = selectionMisses(parseObservations(io.read(path)), failing);
  const base = baseOf(env, io.now());
  const sha = io.git(['rev-parse', 'HEAD']).stdout.trim();
  const ms = ran.reduce((sum, r) => sum + r.ms, 0);
  const records: Observation[] = [{ ...base, kind: 'full-run', sha, why, failing, ms }, ...misses.map((m): Observation => ({ ...base, kind: 'selection-miss', sha, ...m }))];
  appendObservations(path, records, io);
  return misses.map((m) => `  SELECTION MISS  ${missLine(m)}`);
}

/** config/runner.json over its defaults, or why it cannot be read. */
function configOf(io: FullRunIo): RunnerConfig | string {
  try {
    return parseRunnerConfig(io.read(join(io.root, RUNNER_CONFIG)));
  } catch (e) {
    return (e as Error).message;
  }
}

export function fullRun(argv: string[], env: Env, io: FullRunIo): number {
  const why = whyOf(argv);
  if (why === undefined) return (io.err(USAGE), 2);
  const c = configOf(io);
  if (typeof c === 'string') return (io.err(`${c}\n`), 2);
  const stateDir = env.WORKFLOW_STATE_DIR ?? join(io.root, c.stateDir);
  const reason = why === 'idle' ? busy(stateDir, c, io) : undefined;
  if (reason !== undefined) return (io.out(`full run skipped: ${reason}\n`), 0);
  const ran = runSuites(c, io);
  const failing = ran.flatMap((r) => failedFiles(io.read(r.json), io.root));
  const misses = record(why, ran, failing, env, io, stateDir);
  const lines = ['', `Full run (${why}):`, ...ran.map((r) => timedLine({ name: r.step.name, status: r.status, ms: r.ms })), `  ${failing.length} test file(s) failed`, ...misses, ''];
  io.out(lines.join('\n'));
  return worstExit(ran.map((r) => r.status));
}
