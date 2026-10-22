import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fail, fakeCli, memFs, ok, ROOT } from '../test/helpers/flow-fakes.ts';
import { baseIntoLines, baseIntoOpen, type BaseIntoIo } from './base-into.ts';
import { DEFAULTS } from './config.ts';

const c = { ...DEFAULTS, integrationBranch: 'dev', typecheck: 'make types' };
const OBS = join(ROOT, 'state', 'flow', 'observations.jsonl');
const FLIGHTS = join(ROOT, 'state', 'flow', 'in-flight.json');
const wt = (ticket: string) => join(ROOT, '.worktrees', `base-into-${ticket}-run`);
const AT = '2026-10-21T21:00:00.000Z';
const RESULT = '## Result\n';

/** The remote has 70 (merged), 71 (just merged), 72 and 73 (open, with Results), 74 (running: no Result). */
function setup(o: { git?: Parameters<typeof fakeCli>[0]; typecheck?: (cwd: string) => number | null; flights?: object[] } = {}) {
  const fs = memFs(o.flights === undefined ? {} : { [FLIGHTS]: JSON.stringify(o.flights) });
  const git = fakeCli({
    'for-each-ref': ok('origin/ticket/70-a\norigin/ticket/71-b\norigin/ticket/72-c\norigin/ticket/73-d\norigin/ticket/74-e\n'),
    'merge-base --is-ancestor': fail(''),
    'merge-base --is-ancestor origin/ticket/70-a origin/dev': ok(),
    'rev-parse origin/dev': ok('b9aaaaaaaaa\n'),
    'show origin/ticket/71-b:docs/tickets/71-b.md': ok(RESULT),
    'show origin/ticket/72-c:docs/tickets/72-c.md': ok(RESULT),
    'show origin/ticket/73-d:docs/tickets/73-d.md': ok(RESULT),
    'show origin/ticket/74-e:docs/tickets/74-e.md': ok('# 74\n'),
    ...o.git,
  });
  const checked: string[][] = [];
  const io: BaseIntoIo = {
    root: ROOT,
    worktreeId: () => 'run',
    ...fs,
    git: git.run,
    run: (command, cwd) => (checked.push([command, cwd]), (o.typecheck ?? (() => 0))(cwd)),
    now: () => AT,
    out: () => undefined,
  };
  const observations = () => (fs.read(OBS) ?? '').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>);
  return { io, fs, git, checked, observations, inWt: (ticket: string) => git.calls.filter((x) => x.cwd === wt(ticket)).map((x) => x.args.join(' ')) };
}

const run = (s: ReturnType<typeof setup>) => baseIntoOpen('ticket/71-b', c, s.io);

describe('the base into the open ticket branches', () => {
  it('merges the base into each open branch in a worktree of its own, typechecks it with the configured command, pushes it and removes the worktree', () => {
    const s = setup();
    expect(run(s)).toEqual([
      { ticket: '72', branch: 'ticket/72-c', outcome: 'pushed', files: [] },
      { ticket: '73', branch: 'ticket/73-d', outcome: 'pushed', files: [] },
      { ticket: '74', branch: 'ticket/74-e', outcome: 'skipped', files: [] },
    ]);
    expect(s.inWt('72')).toEqual(['merge --no-ff -m Merge dev into ticket/72-c origin/dev', 'push origin HEAD:refs/heads/ticket/72-c']);
    expect(s.git.lines()).toContain(`worktree add --detach ${wt('72')} origin/ticket/72-c`);
    expect(s.git.lines().filter((l) => l === `worktree remove ${wt('72')}`)).toHaveLength(1);
    expect(s.checked).toEqual([
      ['make types', wt('72')],
      ['make types', wt('73')],
    ]);
    expect(s.git.lines().some((l) => l.includes('--force'))).toBe(false);
  });

  it('records each push and skip, with the base it merged', () => {
    const s = setup();
    run(s);
    const base = { at: AT, run: 'flow', project: '', role: 'flow-merge', kind: 'base-into', base: 'b9aaaaaaaaa', files: [] };
    expect(s.observations()).toEqual([
      { ...base, ticket: '72', branch: 'ticket/72-c', outcome: 'pushed' },
      { ...base, ticket: '73', branch: 'ticket/73-d', outcome: 'pushed' },
      { ...base, ticket: '74', branch: 'ticket/74-e', outcome: 'skipped' },
    ]);
  });

  it('leaves a conflicting branch as it was, with its conflicting files', () => {
    const s = setup({ git: { 'merge --no-ff -m Merge dev into ticket/72-c origin/dev': fail('CONFLICT'), 'diff --name-only --diff-filter=U': ok('a.ts\r\nb.ts\n') } });
    expect(run(s)[0]).toEqual({ ticket: '72', branch: 'ticket/72-c', outcome: 'conflict', files: ['a.ts', 'b.ts'] });
    expect(s.inWt('72')).toEqual(['merge --no-ff -m Merge dev into ticket/72-c origin/dev', 'diff --name-only --diff-filter=U', 'merge --abort']);
    expect(s.checked.map(([, cwd]) => cwd)).toEqual([wt('73')]);
  });

  it('pushes nothing that fails typecheck, and names a rejected push', () => {
    const s = setup({ typecheck: (cwd) => (cwd === wt('72') ? 2 : 0), git: { 'push origin HEAD:refs/heads/ticket/73-d': fail('rejected\nnon-fast-forward\n') } });
    expect(run(s).slice(0, 2)).toEqual([
      { ticket: '72', branch: 'ticket/72-c', outcome: 'typecheck', files: [] },
      { ticket: '73', branch: 'ticket/73-d', outcome: 'push-failed', files: [], detail: 'rejected non-fast-forward' },
    ]);
    expect(s.inWt('72')).not.toContain('push origin HEAD:refs/heads/ticket/72-c');
    expect(s.observations()[1]).toMatchObject({ outcome: 'push-failed', detail: 'rejected non-fast-forward' });
  });

  it('names a worktree it could not make or remove', () => {
    const add = setup({ git: { [`worktree add --detach ${wt('72')}`]: { status: 1, stdout: 'busy\n', stderr: '' } } });
    expect(run(add)[0]).toEqual({ ticket: '72', branch: 'ticket/72-c', outcome: 'worktree', files: [], detail: 'busy' });
    const left = setup({ git: { 'worktree remove': fail('contains modified files'), 'push origin HEAD:refs/heads/ticket/72-c': fail('rejected') } });
    expect(run(left).slice(0, 2).map((r) => r.detail)).toEqual([`rejected; worktree left at ${wt('72')}: contains modified files`, `worktree left at ${wt('73')}: contains modified files`]);
  });

  it('skips a branch recorded in flight and one that holds the base already', () => {
    const s = setup({ flights: [{ branch: 'ticket/73-d', family: 'local', at: 'x' }], git: { 'merge-base --is-ancestor origin/dev origin/ticket/72-c': ok() } });
    expect(run(s)).toEqual([
      { ticket: '72', branch: 'ticket/72-c', outcome: 'current', files: [] },
      { ticket: '73', branch: 'ticket/73-d', outcome: 'skipped', files: [] },
      { ticket: '74', branch: 'ticket/74-e', outcome: 'skipped', files: [] },
    ]);
    expect(s.observations().map((o) => o.ticket)).toEqual(['73', '74']);
  });

  it('writes no record when no branch is open', () => {
    const s = setup({ git: { 'for-each-ref': ok('origin/ticket/71-b\n') } });
    expect(run(s)).toEqual([]);
    expect(s.fs.writes).toEqual([]);
  });
});

describe('what the merge prints of it', () => {
  it('says each outcome, with any detail', () => {
    expect(baseIntoLines('dev', [])).toEqual(['No open ticket branch to merge dev into.']);
    const r = (outcome: Parameters<typeof baseIntoLines>[1][number]['outcome'], files: string[] = [], detail?: string) => ({ ticket: '1', branch: `b-${outcome}`, outcome, files, detail });
    expect(baseIntoLines('dev', [r('pushed'), r('conflict', ['a.ts', 'b.ts']), r('skipped'), r('typecheck'), r('current'), r('push-failed', [], 'rejected'), r('worktree', [], 'busy')])).toEqual([
      'dev into the open ticket branches:',
      '  b-pushed: merged and pushed',
      '  b-conflict: conflicts, left as it was for the next round: a.ts, b.ts',
      '  b-skipped: skipped, a build is writing to it and merges the base itself',
      '  b-typecheck: fails typecheck after the merge, left as it was for the next round',
      '  b-current: already holds the base',
      '  b-push-failed: not pushed, left as it was (rejected)',
      '  b-worktree: no worktree, left as it was (busy)',
    ]);
  });
});
