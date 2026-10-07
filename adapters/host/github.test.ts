import { describe, expect, it } from 'vitest';
import { ciQueries, githubHost, queryCi, readCi } from './github.ts';
import type { ProcessResult } from './process-result.ts';

const SHA = 'c'.repeat(40);
const run = (name: string, status: string, conclusion: string | null = null) => ({ name, status, conclusion });
const runs = (...r: ReturnType<typeof run>[]) => ({ total_count: r.length, check_runs: r });
const statuses = (...s: Array<{ context: string; state: string }>) => ({ state: 'pending', statuses: s });

describe('readCi', () => {
  it('is green when every check run and status on the SHA passed', () => {
    const ci = readCi(SHA, runs(run('test', 'completed', 'success'), run('lint', 'completed', 'neutral'), run('docs', 'completed', 'skipped')), statuses({ context: 'vercel', state: 'success' }));
    expect(ci).toEqual({ sha: SHA, state: 'green', passed: ['test', 'lint', 'docs', 'vercel'], failing: [], pending: [] });
  });

  it.each(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale'])('is failing when a check run concluded %s', (conclusion) => {
    const ci = readCi(SHA, runs(run('test', 'completed', 'success'), run('build', 'completed', conclusion)), statuses());
    expect(ci).toMatchObject({ state: 'failing', failing: ['build'], passed: ['test'] });
  });

  it.each(['failure', 'error'])('is failing when a commit status is %s', (state) => {
    expect(readCi(SHA, runs(), statuses({ context: 'ci/legacy', state }))).toMatchObject({ state: 'failing', failing: ['ci/legacy'] });
  });

  it('is failing as soon as one check fails, even while others still run', () => {
    expect(readCi(SHA, runs(run('a', 'in_progress'), run('b', 'completed', 'failure')), statuses())).toMatchObject({ state: 'failing', pending: ['a'], failing: ['b'] });
  });

  it.each(['queued', 'in_progress', 'waiting', 'requested', 'pending'])('is pending while a check run is %s', (status) => {
    expect(readCi(SHA, runs(run('a', 'completed', 'success'), run('b', status)), statuses())).toMatchObject({ state: 'pending', pending: ['b'] });
  });

  it('is pending while a commit status is pending', () => {
    expect(readCi(SHA, runs(run('a', 'completed', 'success')), statuses({ context: 's', state: 'pending' }))).toMatchObject({ state: 'pending', pending: ['s'] });
  });

  it('is pending, never green, when nothing has reported on the SHA yet', () => {
    expect(readCi(SHA, runs(), statuses())).toEqual({ sha: SHA, state: 'pending', passed: [], failing: [], pending: [] });
  });

  it('reads a status state it does not know as failing, never as passed', () => {
    expect(readCi(SHA, runs(), statuses({ context: 's', state: 'weird' }))).toMatchObject({ state: 'failing' });
  });
});

describe('queryCi', () => {
  const ok = (body: unknown): ProcessResult => ({ status: 0, stdout: JSON.stringify(body), stderr: '' });

  it('asks gh for the check runs and the commit statuses of that exact SHA', () => {
    expect(ciQueries(SHA)).toEqual([
      ['api', '-X', 'GET', `repos/{owner}/{repo}/commits/${SHA}/check-runs`, '-f', 'per_page=100'],
      ['api', '-X', 'GET', `repos/{owner}/{repo}/commits/${SHA}/status`, '-f', 'per_page=100'],
    ]);
    const asked: string[][] = [];
    const ci = queryCi(SHA, (args) => (asked.push(args), args[3]!.endsWith('check-runs') ? ok(runs(run('t', 'completed', 'success'))) : ok(statuses())));
    expect(asked).toEqual(ciQueries(SHA));
    expect(ci.state).toBe('green');
  });

  it('throws with gh stderr when gh fails, so a failed query is never read as a state', () => {
    expect(() => queryCi(SHA, () => ({ status: 1, stdout: '', stderr: 'HTTP 404: Not Found\n' }))).toThrow(/^gh api failed: HTTP 404: Not Found$/);
  });

  it('throws with the spawn error or the exit code when gh says nothing', () => {
    expect(() => queryCi(SHA, () => ({ status: null, stdout: '', stderr: '', error: new Error('spawn gh ENOENT') }))).toThrow('gh api failed: spawn gh ENOENT');
    expect(() => queryCi(SHA, () => ({ status: 3, stdout: '', stderr: '' }))).toThrow('gh api failed: exit 3');
  });

  it('refuses a SHA that is not a full commit id: CI is read for an exact SHA only', () => {
    expect(() => queryCi('HEAD', () => ok(runs()))).toThrow(/full 40-character SHA/);
    expect(() => queryCi(`${SHA}0`, () => ok(runs()))).toThrow(/full 40-character SHA/);
    expect(() => queryCi(`x${SHA}`, () => ok(runs()))).toThrow(/full 40-character SHA/);
  });
});

describe('githubHost', () => {
  const ok = (stdout: string): ProcessResult => ({ status: 0, stdout, stderr: '' });
  /** A gh that answers each call by its first two words, and records every call. */
  function gh(answers: Record<string, string>) {
    const calls: string[][] = [];
    const run = (args: string[]) => {
      calls.push(args);
      const key = args[0] === 'api' ? `api ${args[3]!.split('/').at(-1)}` : `${args[0]} ${args[1]}`;
      return key in answers ? ok(answers[key]!) : { status: 1, stdout: '', stderr: `no answer for ${key}` };
    };
    return { calls, host: githubHost(run) };
  }

  it('is the github host', () => {
    expect(gh({}).host.host).toBe('github');
  });

  it('reads checks for a commit from its check runs and commit statuses', () => {
    const { host, calls } = gh({ 'api check-runs': JSON.stringify(runs(run('t', 'completed', 'failure'))), 'api status': JSON.stringify(statuses()) });
    expect(host.checksForCommit(SHA)).toEqual({ sha: SHA, state: 'failing', passed: [], failing: ['t'], pending: [] });
    expect(calls).toEqual(ciQueries(SHA));
  });

  it('opens a draft PR when none is open for the branch, and reads its number from the URL', () => {
    const { host, calls } = gh({ 'pr list': '[]', 'pr create': 'Creating...\nhttps://github.com/o/r/pull/7\n' });
    expect(host.openDraftPr('ticket/01', 'dev', 'T', 'B')).toEqual({ id: 7, url: 'https://github.com/o/r/pull/7', created: true, draft: true });
    expect(calls).toEqual([
      ['pr', 'list', '--head', 'ticket/01', '--base', 'dev', '--state', 'open', '--json', 'number,url,isDraft', '--limit', '1'],
      ['pr', 'create', '--draft', '--base', 'dev', '--head', 'ticket/01', '--title', 'T', '--body', 'B'],
    ]);
  });

  it('reuses the open PR for the branch, as it is', () => {
    const { host, calls } = gh({ 'pr list': JSON.stringify([{ number: 3, url: 'u3', isDraft: false }]) });
    expect(host.openDraftPr('ticket/01', 'dev', 'T', 'B')).toEqual({ id: 3, url: 'u3', created: false, draft: false });
    expect(calls).toHaveLength(1);
  });

  it('fails when gh pr create prints no PR URL, or gh fails', () => {
    expect(() => gh({ 'pr list': '[]', 'pr create': 'https://github.com/o/r/pull/7/files\n' }).host.openDraftPr('b', 'dev', 'T', '')).toThrow('gh pr create printed no PR URL: https://github.com/o/r/pull/7/files');
    expect(() => gh({}).host.openDraftPr('b', 'dev', 'T', '')).toThrow('gh pr list failed: no answer for pr list');
  });

  it('reads a PR status: state, draft, head; GitHub reports its required checks as checks on the head commit', () => {
    const view = { number: 4, url: 'u4', state: 'MERGED', isDraft: true, headRefOid: SHA };
    const { host, calls } = gh({ 'pr view': JSON.stringify(view) });
    expect(host.prStatus('ticket/01')).toEqual({ id: 4, url: 'u4', state: 'MERGED', draft: true, head: SHA, policies: { passed: [], failing: [], pending: [] } });
    expect(calls).toEqual([['pr', 'view', 'ticket/01', '--json', 'number,url,state,isDraft,headRefOid']]);
  });

  it('reads an issue as the work item', () => {
    const { host, calls } = gh({ 'issue view': JSON.stringify({ number: 9, title: 'Thing', state: 'OPEN' }) });
    expect(host.workItem(9)).toEqual({ id: 9, title: 'Thing', state: 'OPEN', type: 'issue' });
    expect(calls).toEqual([['issue', 'view', '9', '--json', 'number,title,state']]);
  });

  it.each([
    ['closed', 'close'],
    ['CLOSED', 'close'],
    ['open', 'reopen'],
    ['Open', 'reopen'],
  ])('sets an issue %s with gh issue %s, then reads it back', (state, verb) => {
    const { host, calls } = gh({ [`issue ${verb}`]: '', 'issue view': JSON.stringify({ number: 9, title: 'Thing', state: state.toUpperCase() }) });
    expect(host.setWorkItemState(9, state)).toEqual({ id: 9, title: 'Thing', state: state.toUpperCase(), type: 'issue' });
    expect(calls[0]).toEqual(['issue', verb, '9']);
  });

  it('refuses a state an issue cannot have, calling nothing', () => {
    const { host, calls } = gh({});
    expect(() => host.setWorkItemState(9, 'Done')).toThrow('a GitHub issue is open or closed, not "Done"');
    expect(calls).toEqual([]);
  });

  it('fails when gh issue close fails', () => {
    expect(() => gh({}).host.setWorkItemState(9, 'closed')).toThrow('gh issue close failed: no answer for issue close');
  });
});
