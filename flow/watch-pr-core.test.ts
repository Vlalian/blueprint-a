import { describe, expect, it } from 'vitest';
import { githubHost } from '../adapters/host/github.ts';
import type { ProcessResult } from '../adapters/host/process-result.ts';
import { runWatch, WATCH_EXIT, watchPr, type WatchIo } from './watch-pr-core.ts';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

type Ci = { runs: Array<{ name: string; status: string; conclusion: string | null }>; statuses?: Array<{ context: string; state: string }> };
type Pr = { headRefOid: string; state: string };

const green: Ci = { runs: [{ name: 'test', status: 'completed', conclusion: 'success' }] };
const red: Ci = { runs: [{ name: 'test', status: 'completed', conclusion: 'failure' }] };
const running: Ci = { runs: [{ name: 'test', status: 'in_progress', conclusion: null }] };

const ok = (body: unknown): ProcessResult => ({ status: 0, stdout: JSON.stringify(body), stderr: '' });

/** The GitHub host on a scripted gh: each poll takes the next PR and CI answer (the last one repeats); a clock that sleep advances. */
function script(steps: Array<{ pr?: Pr; ci?: Ci; fail?: string }>) {
  let i = 0;
  let clock = 0;
  const calls: string[][] = [];
  const logs: string[] = [];
  const sleeps: number[] = [];
  const step = () => steps[Math.min(i, steps.length - 1)]!;
  const io: WatchIo = {
    host: githubHost((args) => {
      calls.push(args);
      const s = step();
      if (s.fail) return { status: 1, stdout: '', stderr: s.fail };
      if (args[0] === 'pr') return ok(s.pr ?? { headRefOid: SHA, state: 'OPEN' });
      const ci = s.ci ?? green;
      return args[3]!.endsWith('check-runs') ? ok({ total_count: ci.runs.length, check_runs: ci.runs }) : ok({ total_count: (ci.statuses ?? []).length, statuses: ci.statuses ?? [] });
    }),
    now: () => clock,
    sleep: (ms) => {
      sleeps.push(ms);
      clock += ms;
      i += 1;
    },
    log: (line) => logs.push(line),
  };
  return { io, calls, logs, sleeps, clock: () => clock };
}

const input = { pr: '12', timeoutMs: 10_000, intervalMs: 1_000, maxQueryErrors: 3 };

describe('watchPr', () => {
  it('returns green (exit 0) when CI passed on the head SHA', () => {
    const s = script([{ ci: green }]);
    expect(watchPr(input, s.io)).toEqual({ pr: '12', sha: SHA, outcome: 'green', exitCode: 0, ci: { sha: SHA, state: 'green', passed: ['test'], failing: [], pending: [] } });
    expect(s.calls[0]).toEqual(['pr', 'view', '12', '--json', 'number,url,state,isDraft,headRefOid']);
    expect(s.calls[1]![3]).toBe(`repos/{owner}/{repo}/commits/${SHA}/check-runs`);
    expect(s.sleeps).toEqual([]);
  });

  it('returns failing (exit 4) when CI failed on the head SHA', () => {
    expect(watchPr(input, script([{ ci: red }]).io)).toMatchObject({ outcome: 'failing', exitCode: 4, ci: { failing: ['test'] } });
  });

  it('polls while CI is pending, every interval, until it settles', () => {
    const s = script([{ ci: running }, { ci: running }, { ci: green }]);
    expect(watchPr(input, s.io)).toMatchObject({ outcome: 'green', exitCode: 0 });
    expect(s.sleeps).toEqual([1_000, 1_000]);
    expect(s.logs).toEqual([`12 @ ${SHA.slice(0, 10)}: CI pending (test)`, `12 @ ${SHA.slice(0, 10)}: CI pending (test)`]);
  });

  it('names every check still running', () => {
    const both: Ci = { runs: [{ name: 'test', status: 'queued', conclusion: null }, { name: 'e2e', status: 'in_progress', conclusion: null }] };
    const s = script([{ ci: both }, { ci: green }]);
    watchPr(input, s.io);
    expect(s.logs).toEqual([`12 @ ${SHA.slice(0, 10)}: CI pending (test, e2e)`]);
  });

  it('says so while nothing has reported on the SHA yet', () => {
    const s = script([{ ci: { runs: [] } }, { ci: green }]);
    watchPr(input, s.io);
    expect(s.logs).toEqual([`12 @ ${SHA.slice(0, 10)}: CI pending (nothing reported yet)`]);
  });

  it('times out (exit 5) when CI is still pending at the deadline, with what is still running', () => {
    const s = script([{ ci: running }]);
    expect(watchPr({ ...input, timeoutMs: 3_000 }, s.io)).toMatchObject({ outcome: 'timeout', exitCode: 5, ci: { pending: ['test'] } });
    expect(s.clock()).toBe(3_000);
  });

  it('polls once and times out at once with a zero timeout', () => {
    const s = script([{ ci: running }]);
    expect(watchPr({ ...input, timeoutMs: 0 }, s.io)).toMatchObject({ outcome: 'timeout', exitCode: 5 });
    expect(s.sleeps).toEqual([]);
  });

  it('watches the SHA it was given, and stops (exit 6) when the PR head is another commit', () => {
    const s = script([{ pr: { headRefOid: OTHER, state: 'OPEN' } }]);
    expect(watchPr({ ...input, sha: SHA }, s.io)).toEqual({ pr: '12', sha: SHA, outcome: 'moved', exitCode: 6, head: OTHER });
    expect(s.calls).toHaveLength(1);
  });

  it('stops (exit 6) when the head moves while it waits: CI on the old SHA no longer ships', () => {
    const s = script([{ ci: running }, { pr: { headRefOid: OTHER, state: 'OPEN' }, ci: green }]);
    expect(watchPr(input, s.io)).toMatchObject({ sha: SHA, outcome: 'moved', exitCode: 6, head: OTHER });
  });

  it.each(['CLOSED', 'MERGED'])('stops (exit 3) when the PR is %s', (state) => {
    expect(watchPr(input, script([{ pr: { headRefOid: SHA, state } }]).io)).toEqual({ pr: '12', sha: SHA, outcome: 'closed', exitCode: 3, state });
  });

  it('retries a failed gh query, then reads the answer', () => {
    const s = script([{ fail: 'HTTP 502' }, { fail: 'HTTP 502' }, { ci: green }]);
    expect(watchPr(input, s.io)).toMatchObject({ outcome: 'green', exitCode: 0 });
    expect(s.logs).toEqual(['12: gh pr view failed: HTTP 502 (query error 1 of 3)', '12: gh pr view failed: HTTP 502 (query error 2 of 3)']);
  });

  it('gives up (exit 7) after maxQueryErrors failed queries in a row', () => {
    const s = script([{ fail: 'HTTP 401: Bad credentials' }]);
    expect(watchPr(input, s.io)).toEqual({ pr: '12', outcome: 'error', exitCode: 7, error: 'gh pr view failed: HTTP 401: Bad credentials' });
    expect(s.sleeps).toEqual([1_000, 1_000]);
  });

  it('counts only errors in a row: a good answer resets the count', () => {
    const s = script([{ fail: 'x' }, { fail: 'x' }, { ci: running }, { fail: 'x' }, { fail: 'x' }, { ci: green }]);
    expect(watchPr(input, s.io)).toMatchObject({ outcome: 'green' });
  });

  it('gives up at the deadline even while queries fail', () => {
    const s = script([{ fail: 'x' }]);
    expect(watchPr({ ...input, timeoutMs: 0, maxQueryErrors: 5 }, s.io)).toMatchObject({ outcome: 'error', exitCode: 7 });
  });
});

describe('WATCH_EXIT', () => {
  it('documents one exit code per outcome', () => {
    expect(WATCH_EXIT).toEqual({ green: 0, usage: 2, closed: 3, failing: 4, timeout: 5, moved: 6, error: 7 });
  });
});

describe('runWatch (the CLI core)', () => {
  it('reads --pr and --sha, turns seconds into milliseconds and watches', () => {
    const s = script([{ ci: running }, { ci: green }]);
    const seen: string[] = [];
    const r = runWatch(['--pr', '12', '--sha', SHA, '--timeout', '60', '--interval', '7', '--cwd', 'work'], (cwd) => (seen.push(cwd), s.io));
    expect(r).toMatchObject({ exitCode: 0, json: { outcome: 'green', sha: SHA } });
    expect(s.sleeps).toEqual([7_000]);
    expect(seen).toEqual(['work']);
  });

  it('defaults to a 30 minute timeout, a 30 s interval, 3 query errors and the current folder', () => {
    const s = script([{ ci: running }]);
    const seen: string[] = [];
    const r = runWatch(['--pr', '12'], (cwd) => (seen.push(cwd), s.io));
    expect(r.exitCode).toBe(5);
    expect(s.clock()).toBe(30 * 60 * 1000);
    expect(new Set(s.sleeps)).toEqual(new Set([30_000]));
    expect(seen).toEqual(['.']);
    const f = script([{ fail: 'x' }]);
    runWatch(['--pr', '12'], () => f.io);
    expect(f.sleeps).toHaveLength(2);
  });

  it('takes --max-query-errors', () => {
    const f = script([{ fail: 'x' }]);
    expect(runWatch(['--pr', '12', '--max-query-errors', '1'], () => f.io).exitCode).toBe(7);
    expect(f.sleeps).toEqual([]);
  });

  it.each([
    ['no --pr', [], /^--pr is required/],
    ['an unknown option', ['--pr', '1', '--merge'], /merge/],
    ['a timeout that is not a number', ['--pr', '1', '--timeout', 'soon'], /--timeout must be a whole number of seconds/],
    ['a negative interval', ['--pr', '1', '--interval=-1'], /--interval must be a whole number of seconds/],
    ['a fractional interval', ['--pr', '1', '--interval', '1.5'], /--interval/],
    ['zero query errors', ['--pr', '1', '--max-query-errors', '0'], /^--max-query-errors must be at least 1, not "0"$/],
    ['query errors that are not a number', ['--pr', '1', '--max-query-errors', 'x'], /^--max-query-errors must be at least 1, not "x"$/],
    ['a short SHA', ['--pr', '1', '--sha', 'abc123'], /--sha must be a full 40-character SHA/],
  ])('exits 2 on %s, asking gh nothing', (_label, argv, error) => {
    const s = script([{ ci: green }]);
    const r = runWatch(argv, () => s.io);
    expect(r).toEqual({ exitCode: 2, json: { outcome: 'usage', exitCode: 2, error: expect.stringMatching(error) } });
    expect(s.calls).toEqual([]);
  });
});
