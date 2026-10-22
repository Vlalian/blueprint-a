// Watches CI on a pull request's exact head SHA until it settles, and says how it ended in an
// exit code a controller can branch on (pstack's watch-pr, cut down to CI). The SHA is fixed when
// the watch starts (or given): if the PR's head moves, CI on the old commit no longer ships, so
// the watch stops rather than follow it. The PR and CI are read through the host adapter
// (adapters/host, ticket 54), so the same watch runs on GitHub and Azure DevOps. scripts/watch-pr.ts
// only wires in the host, the clock and sleep.

import { parseArgs } from 'node:util';
import { isFullSha, type CiSnapshot, type HostAdapter } from '../adapters/host/host.ts';

/** 0 green, 2 usage, 3 PR closed or merged, 4 CI failing, 5 still pending at the timeout, 6 head moved, 7 the host kept failing. */
export const WATCH_EXIT = { green: 0, usage: 2, closed: 3, failing: 4, timeout: 5, moved: 6, error: 7 } as const;
export type WatchOutcome = keyof typeof WATCH_EXIT;

export interface WatchIo {
  host: Pick<HostAdapter, 'prStatus' | 'checksForCommit'>;
  /** Milliseconds, from any fixed point. */
  now(): number;
  sleep(ms: number): void;
  /** Progress, one line at a time (stderr in the CLI). */
  log(line: string): void;
}

export interface WatchInput {
  /** A PR number (any host), or a URL or branch as gh pr view takes it (GitHub). */
  pr: string;
  /** The commit to watch; the PR's head when the watch starts if absent. */
  sha?: string;
  timeoutMs: number;
  intervalMs: number;
  /** Failed host queries in a row before giving up. */
  maxQueryErrors: number;
}

export interface WatchResult {
  pr: string;
  sha?: string;
  outcome: WatchOutcome;
  exitCode: number;
  ci?: CiSnapshot;
  /** The PR's head when it moved off the watched SHA. */
  head?: string;
  /** The PR's state when it is no longer open. */
  state?: string;
  error?: string;
}

type Poll = { done: WatchResult } | { sha: string; ci: CiSnapshot } | { error: string };

const result = (input: WatchInput, outcome: WatchOutcome, rest: Partial<WatchResult>): WatchResult => ({ pr: input.pr, ...rest, outcome, exitCode: WATCH_EXIT[outcome] });

/** One look: the PR's state and head, then CI on the watched SHA. Throws when the host fails. */
function poll(input: WatchInput, watched: string | undefined, io: WatchIo): Poll {
  const view = io.host.prStatus(input.pr);
  const sha = watched ?? view.head;
  if (view.state !== 'OPEN') return { done: result(input, 'closed', { sha, state: view.state }) };
  if (view.head !== sha) return { done: result(input, 'moved', { sha, head: view.head }) };
  const ci = io.host.checksForCommit(sha);
  return ci.state === 'pending' ? { sha, ci } : { done: result(input, ci.state, { sha, ci }) };
}

function tryPoll(input: WatchInput, watched: string | undefined, io: WatchIo): Poll {
  try {
    return poll(input, watched, io);
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Why the watch ends after a pending or failed look, or undefined to look again. */
function stopAfter(input: WatchInput, p: Exclude<Poll, { done: WatchResult }>, errors: number, late: boolean): WatchResult | undefined {
  if ('error' in p) return errors >= input.maxQueryErrors || late ? result(input, 'error', { error: p.error }) : undefined;
  return late ? result(input, 'timeout', { sha: p.sha, ci: p.ci }) : undefined;
}

function progress(input: WatchInput, p: Exclude<Poll, { done: WatchResult }>, errors: number): string {
  if ('error' in p) return `${input.pr}: ${p.error} (query error ${errors} of ${input.maxQueryErrors})`;
  return `${input.pr} @ ${p.sha.slice(0, 10)}: CI pending (${p.ci.pending.join(', ') || 'nothing reported yet'})`;
}

export function watchPr(input: WatchInput, io: WatchIo): WatchResult {
  const deadline = io.now() + input.timeoutMs;
  let watched = input.sha;
  let errors = 0;
  for (;;) {
    const p = tryPoll(input, watched, io);
    if ('done' in p) return p.done;
    errors = 'error' in p ? errors + 1 : 0;
    watched = 'sha' in p ? p.sha : watched;
    // Every look is logged before deciding, so a timeout always shows what the last look saw.
    io.log(progress(input, p, errors));
    const stop = stopAfter(input, p, errors, io.now() >= deadline);
    if (stop) return stop;
    io.sleep(input.intervalMs);
  }
}

const OPTIONS = {
  pr: { type: 'string' },
  sha: { type: 'string' },
  timeout: { type: 'string', default: '1800' },
  interval: { type: 'string', default: '30' },
  'max-query-errors': { type: 'string', default: '3' },
  cwd: { type: 'string', default: '.' },
} as const;

function whole(value: string, least: number, problem: string): number {
  if (!/^\d+$/.test(value) || Number(value) < least) throw new Error(`${problem}, not ${JSON.stringify(value)}`);
  return Number(value);
}

const seconds = (value: string, flag: string) => whole(value, 0, `${flag} must be a whole number of seconds`) * 1000;

function inputOf(argv: string[]): WatchInput & { cwd: string } {
  const { values: o } = parseArgs({ args: argv, options: OPTIONS });
  if (!o.pr) throw new Error('--pr is required. usage: node scripts/watch-pr.ts --pr <number|url|branch> [--sha <sha>] [--timeout 1800] [--interval 30] [--max-query-errors 3] [--cwd <repo>]');
  if (o.sha !== undefined && !isFullSha(o.sha)) throw new Error(`--sha must be a full 40-character SHA, not ${JSON.stringify(o.sha)}`);
  return { pr: o.pr, sha: o.sha, timeoutMs: seconds(o.timeout, '--timeout'), intervalMs: seconds(o.interval, '--interval'), maxQueryErrors: whole(o['max-query-errors'], 1, '--max-query-errors must be at least 1'), cwd: o.cwd };
}

/** One CLI call; `ioIn` gives the I/O for the repo at --cwd. A usage error is exit 2 and asks the host nothing. */
export function runWatch(argv: string[], ioIn: (cwd: string) => WatchIo): { json: WatchResult | { outcome: 'usage'; exitCode: 2; error: string }; exitCode: number } {
  let input: ReturnType<typeof inputOf>;
  try {
    input = inputOf(argv);
  } catch (e) {
    return { json: { outcome: 'usage', exitCode: 2, error: (e as Error).message }, exitCode: 2 };
  }
  const r = watchPr(input, ioIn(input.cwd));
  return { json: r, exitCode: r.exitCode };
}
