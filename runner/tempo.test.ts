import { describe, expect, it } from 'vitest';
import type { Observation } from './observations.ts';
import {
  buildRecord,
  idleShare,
  inFlight,
  maxCloudBuilds,
  mergesOf,
  pace,
  sharedFiles,
  sizeOf,
  spread,
  tempoStats,
  tempoTarget,
  ticketFiles,
  ticketOfBranch,
  type Merge,
} from './tempo.ts';

const MIN = 60_000;
const base = { run: 'r', project: 'workflow', ticket: '', role: '' };
const t = (minute: number) => new Date(Date.UTC(2026, 9, 5, 0, minute)).toISOString();
const fire = (branch: string, minute: number, size?: 'S' | 'M' | 'L'): Observation => ({ ...base, at: t(minute), kind: 'fire', branch, ...(size ? { size } : {}) });
const build = (branch: string, from: number, to: number, size?: 'S' | 'M' | 'L'): Observation => ({
  ...base,
  at: t(to + 30),
  kind: 'build',
  branch,
  ...(size ? { size } : {}),
  firedAt: t(from),
  resultAt: t(to),
  ms: (to - from) * MIN,
});
const stage = (ticket: string, minute: number, gate: string, ms: number, placement?: 'cloud'): Observation => ({
  ...base,
  ticket,
  at: t(minute),
  kind: 'gate',
  gate,
  sha: 's',
  verdict: 'pass',
  reasons: [],
  ms,
  ...(placement ? { placement } : {}),
});
const prep = (branch: string, minute: number, ms: number): Observation => ({ ...base, at: t(minute), kind: 'merge-prep', branch, steps: [{ step: 'install', ms, ok: true }], ms });

describe('ticketOfBranch: the ticket a build branch is for', () => {
  it.each([
    ['ticket/53-tempo-stats', { id: '53', file: '53-tempo-stats.md' }],
    ['origin/ticket/15b-gate-metrics', { id: '15b', file: '15b-gate-metrics.md' }],
    ['refs/remotes/origin/ticket/7-x', { id: '7', file: '7-x.md' }],
  ])('%s', (branch, ticket) => expect(ticketOfBranch(branch)).toEqual(ticket));

  it.each(['integration/2026-10-04', 'ticket/abc', 'xticket/53-a', 'ticket/53-a/b', 'ticket/53-'])('is none for %s', (branch) => expect(ticketOfBranch(branch)).toBeUndefined());
});

describe('sizeOf: the ticket file’s Size line', () => {
  it.each([
    ['# 53 x\n\nStatus: ready\nSize: S\n', 'S'],
    ['Size: M  \n', 'M'],
    ['Size:L', 'L'],
  ])('%j is %s', (text, size) => expect(sizeOf(text)).toBe(size));

  it.each([undefined, 'Size: XL\n', 'Size: S or M\n', 'The Size: S line', 'Size: s\n'])('none for %j', (text) => expect(sizeOf(text)).toBeUndefined());
});

describe('buildRecord: from the fire to the Result push', () => {
  const now = { ...base, at: t(100) };

  it('takes the latest fire of the branch before the Result push', () => {
    const records = [fire('ticket/1-a', 0, 'M'), fire('ticket/2-b', 5), fire('ticket/1-a', 10, 'M'), fire('ticket/1-a', 90)];
    expect(buildRecord(now, 'origin/ticket/1-a', records, t(50), undefined)).toEqual({
      record: { ...now, kind: 'build', branch: 'ticket/1-a', size: 'M', firedAt: t(10), resultAt: t(50), ms: 40 * MIN },
    });
  });

  it('counts a fire at the very time of the push, compares times not text, and the ticket file’s size wins', () => {
    const records = [fire('ticket/1-a', 50, 'S')];
    const plusTwo = '2026-10-05T02:50:00+02:00';
    expect(buildRecord(now, 'ticket/1-a', records, plusTwo, 'L')).toEqual({ record: { ...now, kind: 'build', branch: 'ticket/1-a', size: 'L', firedAt: t(50), resultAt: t(50), ms: 0 } });
  });

  it('leaves the size out when neither knows it', () => {
    expect(buildRecord(now, 'ticket/1-a', [fire('ticket/1-a', 0)], t(40), undefined)).toStrictEqual({ record: { ...now, kind: 'build', branch: 'ticket/1-a', firedAt: t(0), resultAt: t(40), ms: 40 * MIN } });
  });

  it('takes the fire, not an earlier build record of the branch', () => {
    expect(buildRecord(now, 'ticket/1-a', [fire('ticket/1-a', 0), build('ticket/1-a', 0, 5)], t(50), undefined)).toMatchObject({ record: { firedAt: t(0), ms: 50 * MIN } });
  });

  it('says why when no fire of the branch is recorded before the push', () => {
    expect(buildRecord(now, 'ticket/1-a', [fire('ticket/2-b', 0), fire('ticket/1-a', 60), build('ticket/1-a', 60, 70)], t(50), undefined)).toEqual({
      reason: 'no fire of ticket/1-a is recorded before its Result push at 2026-10-05T00:50:00.000Z',
    });
  });

  it('records a build once', () => {
    expect(buildRecord(now, 'ticket/1-a', [fire('ticket/1-a', 0), build('ticket/1-a', 0, 40)], t(40), undefined)).toEqual({ reason: 'the build of ticket/1-a up to 2026-10-05T00:40:00.000Z is recorded already' });
    expect(buildRecord(now, 'ticket/1-a', [fire('ticket/1-a', 0), build('ticket/2-b', 0, 40), build('ticket/1-a', 0, 30)], t(40), undefined)).toHaveProperty('record');
  });
});

describe('spread: mean and range', () => {
  it('is none for no times', () => expect(spread([])).toBeUndefined());
  it('gives the count, mean, lowest and highest', () => expect(spread([30, 10, 20, 60])).toEqual({ count: 4, meanMs: 30, minMs: 10, maxMs: 60 }));
});

describe('mergesOf: one merge per local self-gate run on a branch, with its preparation', () => {
  it('sums the stages of one run, adds the latest preparation of the branch before it, and orders by time', () => {
    const records = [
      prep('ticket/1-a', 1, 1 * MIN),
      prep('ticket/1-a', 9, 2 * MIN),
      prep('ticket/2-b', 9, 7 * MIN),
      stage('origin/ticket/1-a', 20, 'self-gate-typecheck', 1 * MIN),
      stage('origin/ticket/1-a', 20, 'self-gate-unit', 5 * MIN),
      stage('ticket/3-c', 10, 'self-gate-unit', 3 * MIN),
      prep('ticket/1-a', 25, 9 * MIN),
      build('ticket/1-a', 0, 5, 'S'),
    ];
    expect(mergesOf(records)).toStrictEqual<Merge[]>([
      { branch: 'ticket/3-c', at: t(10), gateMs: 3 * MIN, prepMs: 0, ms: 3 * MIN },
      { branch: 'ticket/1-a', at: t(20), gateMs: 6 * MIN, prepMs: 2 * MIN, ms: 8 * MIN, size: 'S' },
    ]);
  });

  it('counts a preparation logged at the very time of the gate', () => {
    expect(mergesOf([prep('ticket/1-a', 20, MIN), stage('ticket/1-a', 20, 'self-gate-unit', MIN)])[0]).toMatchObject({ prepMs: MIN, ms: 2 * MIN });
  });

  it('leaves out cloud runs, runs with no branch, other gates, and keeps two runs of a branch apart', () => {
    const records = [
      stage('ticket/1-a', 5, 'self-gate-unit', MIN, 'cloud'),
      stage('', 5, 'self-gate-unit', MIN),
      stage('ticket/1-a', 5, 'four-checks', MIN),
      stage('ticket/1-a', 6, 'self-gate-unit', 2 * MIN),
      stage('ticket/1-a', 7, 'self-gate-unit', 3 * MIN),
    ];
    expect(mergesOf(records).map((m) => m.ms)).toEqual([2 * MIN, 3 * MIN]);
  });
});

describe('tempoStats: the last 10 builds and merges, and per size', () => {
  it('averages the last ten by time and each size’s own last ten', () => {
    const builds = Array.from({ length: 12 }, (_, i) => build(`ticket/${i}-x`, 0, 10 + i, i < 3 ? 'L' : 'S'));
    const s = tempoStats([...builds].reverse());
    expect(s.build.all).toEqual({ count: 10, meanMs: 16.5 * MIN, minMs: 12 * MIN, maxMs: 21 * MIN });
    expect(s.build.bySize).toEqual({ L: { count: 3, meanMs: 11 * MIN, minMs: 10 * MIN, maxMs: 12 * MIN }, S: { count: 9, meanMs: 17 * MIN, minMs: 13 * MIN, maxMs: 21 * MIN } });
    expect(s.merge).toStrictEqual({ all: undefined, bySize: {} });
  });

  it('keeps only the last ten of a size', () => {
    const builds = Array.from({ length: 11 }, (_, i) => build(`ticket/${i}-x`, 0, 10 + i, 'M'));
    expect(tempoStats(builds).build.bySize.M).toEqual({ count: 10, meanMs: 15.5 * MIN, minMs: 11 * MIN, maxMs: 20 * MIN });
  });

  it('averages merges by their own size, known from the branch’s build', () => {
    const records = [build('ticket/1-a', 0, 40, 'M'), stage('ticket/1-a', 50, 'self-gate-unit', 8 * MIN), stage('ticket/2-b', 60, 'self-gate-unit', 4 * MIN)];
    expect(tempoStats(records).merge).toEqual({
      all: { count: 2, meanMs: 6 * MIN, minMs: 4 * MIN, maxMs: 8 * MIN },
      bySize: { M: { count: 1, meanMs: 8 * MIN, minMs: 8 * MIN, maxMs: 8 * MIN } },
    });
  });
});

describe('tempoTarget: builds in flight', () => {
  const s = (minutes: number) => ({ count: 1, meanMs: minutes * MIN, minMs: 0, maxMs: 0 });

  it('a 40-minute build and a 10-minute merge: 4, capped at 3, starts 10 minutes apart', () => {
    expect(tempoTarget(s(40), s(10), 3)).toEqual({ target: 3, staggerMs: 10 * MIN });
  });

  it.each([
    [40, 10, 5, 4],
    [41, 10, 5, 5],
    [5, 10, 5, 1],
  ])('build %i min, merge %i min, cap %i: %i', (b, m, cap, target) => expect(tempoTarget(s(b), s(m), cap).target).toBe(target));

  it('one at a time, unstaggered, until both averages are known', () => {
    expect(tempoTarget(undefined, s(10), 3)).toEqual({ target: 1, staggerMs: 0 });
    expect(tempoTarget(s(40), undefined, 3)).toEqual({ target: 1, staggerMs: 0 });
  });
});

describe('maxCloudBuilds: config/tempo.json', () => {
  it.each([
    [undefined, 3],
    ['not json', 3],
    ['{}', 3],
    ['{"maxCloudBuilds": 5}', 5],
    ['{"maxCloudBuilds": 0}', 3],
    ['{"maxCloudBuilds": 2.5}', 3],
    ['{"maxCloudBuilds": "4"}', 3],
    ['{"maxCloudBuilds": 1}', 1],
  ])('%j caps at %i', (text, cap) => expect(maxCloudBuilds(text)).toBe(cap));
});

describe('inFlight: fired builds not yet ended', () => {
  it('a fire with no later build or merge of its branch, newest fire per branch', () => {
    const records = [
      fire('ticket/1-a', 0),
      build('ticket/1-a', 0, 30),
      fire('ticket/2-b', 5),
      fire('ticket/3-c', 10),
      stage('origin/ticket/3-c', 40, 'self-gate-unit', MIN),
      fire('ticket/4-d', 20),
      fire('ticket/4-d', 50),
      fire('ticket/5-e', 60),
      build('ticket/5-e', 0, 20),
      stage('ticket/5-e', 50, 'self-gate-unit', MIN),
    ];
    expect(inFlight(records)).toEqual([
      { branch: 'ticket/2-b', firedAt: t(5) },
      { branch: 'ticket/4-d', firedAt: t(50) },
      { branch: 'ticket/5-e', firedAt: t(60) },
    ]);
  });

  it('a build or merge at the very time of the fire ends it', () => {
    expect(inFlight([fire('ticket/1-a', 40), build('ticket/1-a', 0, 10)])).toEqual([]);
  });
});

describe('ticketFiles: the files a ticket names', () => {
  it('backticked paths with a folder, line numbers dropped, docs left out, sorted once each', () => {
    const text = 'Change `dispatcher/workflow-tracker.ts:40-43` and `scripts/self-gate*`, `gates/x.ts:4,12-15`, `skills/tdd/SKILL.md`, see `docs/analysis/x.md`, `npm ci`, `a.ts`, `dispatcher/workflow-tracker.ts`, `briefing/*`.';
    expect(ticketFiles(text)).toEqual(['briefing/*', 'dispatcher/workflow-tracker.ts', 'gates/x.ts', 'scripts/self-gate*', 'skills/tdd/SKILL.md']);
  });
});

describe('sharedFiles: the files two tickets both touch', () => {
  it.each([
    [['a/b.ts'], ['a/b.ts'], ['a/b.ts']],
    [['a/b.ts', 'c/d.ts'], ['c/d.ts'], ['c/d.ts']],
    [['c/d.ts'], ['a/b.ts', 'c/d.ts'], ['c/d.ts']],
    [['a/b.ts'], ['a/c.ts'], []],
    [['scripts/self-gate*'], ['scripts/self-gate-core.ts'], ['scripts/self-gate*']],
    [['scripts/self-gate-core.ts'], ['scripts/self-gate*'], ['scripts/self-gate-core.ts']],
    [['briefing/*'], ['briefing/x/y.ts'], []],
    [['briefing/**'], ['briefing/x/y.ts'], ['briefing/**']],
    [['a/b.ts'], ['a/bxts'], []],
    [['a/b(c).ts'], ['a/b(c).ts'], ['a/b(c).ts']],
  ])('%j and %j share %j', (a, b, shared) => expect(sharedFiles(a, b)).toEqual(shared));
});

describe('pace: which ready tickets start, and when', () => {
  const now = t(100);

  it('fills the free slots in order, staggered from the latest fire, and never starts two tickets on the same file', () => {
    const plan = pace({
      target: 3,
      staggerMs: 10 * MIN,
      now,
      running: [{ ticket: '47-a.md', files: ['dispatcher/review.ts'], firedAt: t(95) }],
      ready: [
        { ticket: '48-b.md', files: ['dispatcher/review.ts', 'skills/x.md'] },
        { ticket: '49-c.md', files: ['briefing/a.ts'] },
        { ticket: '50-d.md', files: ['briefing/a.ts'] },
        { ticket: '51-e.md', files: ['scripts/e.ts'] },
        { ticket: '52-f.md', files: ['scripts/f.ts'] },
      ],
    });
    expect(plan).toEqual({
      starts: [
        { ticket: '49-c.md', at: t(105) },
        { ticket: '51-e.md', at: t(115) },
      ],
      held: [
        { ticket: '48-b.md', with: '47-a.md', files: ['dispatcher/review.ts'] },
        { ticket: '50-d.md', with: '49-c.md', files: ['briefing/a.ts'] },
      ],
    });
  });

  it('starts now when the latest fire is a stagger or more ago, or nothing runs', () => {
    const ready = [{ ticket: '1-a.md', files: [] }];
    expect(pace({ target: 2, staggerMs: 10 * MIN, now, running: [{ ticket: '0.md', files: [], firedAt: t(90) }], ready }).starts).toEqual([{ ticket: '1-a.md', at: now }]);
    expect(pace({ target: 1, staggerMs: 10 * MIN, now, running: [], ready }).starts).toEqual([{ ticket: '1-a.md', at: now }]);
  });

  it('starts nothing when the target is reached or passed', () => {
    const running = [{ ticket: '0.md', files: [], firedAt: t(0) }];
    expect(pace({ target: 1, staggerMs: 0, now, running, ready: [{ ticket: '1-a.md', files: [] }] })).toEqual({ starts: [], held: [] });
    expect(pace({ target: 0, staggerMs: 0, now, running: [], ready: [{ ticket: '1-a.md', files: [] }] })).toEqual({ starts: [], held: [] });
  });
});

describe('idleShare: the merge gate’s idle share of a window', () => {
  const merge = (end: number, minutes: number): Merge => ({ branch: 'b', at: t(end), gateMs: minutes * MIN, prepMs: 0, ms: minutes * MIN });

  it('busy time is the merges’ union, clipped to the window', () => {
    // Window 0-100: busy 10-30 and 25-40 overlap (30 min), 90-110 clipped to 10, -10-5 clipped to 5.
    const merges = [merge(30, 20), merge(40, 15), merge(110, 20), merge(5, 15), merge(200, 10)];
    expect(idleShare(merges, t(0), t(100))).toBeCloseTo(0.55, 10);
  });

  it('is all idle with no merge, and none for an empty window', () => {
    expect(idleShare([], t(0), t(100))).toBe(1);
    expect(idleShare([merge(30, 20)], t(10), t(10))).toBeUndefined();
    expect(idleShare([], t(10), t(5))).toBeUndefined();
  });

  it('counts a merge that ends at the window’s start as no busy time, and back-to-back merges once', () => {
    expect(idleShare([merge(0, 10), merge(20, 10), merge(30, 10)], t(0), t(100))).toBeCloseTo(0.8, 10);
  });
});
