import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseObservations, type Observation } from './observations.ts';
import { functionLedger, percentile, slowHooks, zeroGuard, type Ledger, type LedgerRow } from './function-ledger-core.ts';
import type { WorkflowFunction } from './functions-core.ts';
import type { PriceTable } from './prices-core.ts';

const ROOT = resolve(import.meta.dirname, '..');
const FIXTURE = parseObservations(readFileSync(join(ROOT, 'test', 'fixtures', 'ledger', 'observations.jsonl'), 'utf8'));

// Test rates, not prices: round numbers so every expected figure can be checked by hand.
const PRICES: PriceTable = {
  date: '2026-10-04',
  source: 'test rates',
  placeholder: false,
  models: { sonnet: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }, opus: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 } },
};

const ids = [
  'gate:test',
  'gate:lint',
  'gate:onkel',
  'gate:secret-scan',
  'gate:red-check',
  'hook:pre-tool',
  'hook:observe',
  'hook:stop-gate',
  'hook:loop-guard',
  'role:coder',
  'role:specifier',
  'role:hardener',
  'role:reviewer',
  'role:skeptic',
  'role:planner',
  'substream:affaan-m/ECC',
  'skill:coder',
  'skill:no-ai-slop',
  'skill:review',
  'skill:skeptic',
  'skill:controller',
];
const REGISTRY = ids.map((id): WorkflowFunction => {
  const [kind, name] = id.split(/:(.*)/);
  return { id, kind: kind as WorkflowFunction['kind'], name, source: 'x' };
});

const OPTS = { since: '2026-09-30T00:00:00.000Z', now: '2026-10-04T12:00:00.000Z', prices: PRICES, registry: REGISTRY, zeroRuns: 3, hookP95Ms: { default: 1000, 'stop-gate': 60_000 } };

const NO_COST = { usd: 0, unpriced: [], minutes: 0, tokens: 0, unknown: 0, calls: 0 };
const row = (id: string, value: Record<string, number>, cost: Partial<LedgerRow['cost']> = {}, slow = false): LedgerRow => {
  const [kind, name] = id.split(/:(.*)/);
  return { id, kind: kind as LedgerRow['kind'], name, value, cost: { ...NO_COST, ...cost }, slow };
};
const gate = (runs: number, catches: number) => ({ runs, catches, escapes: 0, falseAlarms: 0, couldNotRun: 0 });
const role = (tickets: number, firstTry: number, fixRounds: number, sessions: number) => ({ tickets, firstTry, escalations: 0, fixRounds, sessions });

describe('Pass when: a fixture log with known sessions, hook calls and gate verdicts gives the exact cost and value per function', () => {
  const ledger = () => functionLedger(FIXTURE, OPTS);

  it('gives every function its value and its cost over the window, priced by the table it is given', () => {
    const rows = ledger().rows;
    expect(rows.map((r) => r.id)).toEqual(ids);
    expect(rows).toEqual<LedgerRow[]>([
      row('gate:test', gate(2, 1), { minutes: 7000 / 60_000, calls: 2 }),
      row('gate:lint', gate(3, 0), { minutes: 3000 / 60_000, calls: 3 }),
      row('gate:onkel', gate(3, 0), { minutes: 30, calls: 3 }),
      row('gate:secret-scan', gate(3, 0), { calls: 3 }),
      row('gate:red-check', gate(1, 0), { minutes: 2000 / 60_000, calls: 1 }),
      row('hook:pre-tool', { calls: 5, blocks: 1 }, { minutes: 2960 / 60_000, calls: 5, p50Ms: 120, p95Ms: 2500 }, true),
      row('hook:observe', { calls: 2, blocks: 0 }, { minutes: 110 / 60_000, calls: 2, p50Ms: 50, p95Ms: 60 }),
      row('hook:stop-gate', { calls: 1, blocks: 0 }, { minutes: 0.5, calls: 1, p50Ms: 30_000, p95Ms: 30_000 }),
      row('hook:loop-guard', { calls: 0, blocks: 0 }),
      // 1M in and 100k out at 2 and 10, then 500k, 50k, 200k cache read and 100k cache write.
      row('role:coder', role(3, 2, 1, 2), { usd: 3 + 1 + 0.5 + 0.04 + 0.25, minutes: 15, tokens: 1_950_000, calls: 2 }),
      row('role:specifier', role(1, 1, 1, 0)),
      row('role:hardener', role(0, 0, 0, 0)),
      row('role:reviewer', { raw: 4, unique: 3, confirmed: 1, fixed: 1, refuted: 1, sessions: 1 }, { usd: 0.6, minutes: 2, tokens: 220_000, calls: 1 }),
      row('role:skeptic', { checked: 3, refuted: 1, sessions: 1 }, { usd: 1.5, minutes: 1, tokens: 110_000, calls: 1 }),
      row('role:planner', role(0, 0, 0, 1), { unpriced: ['gpt-x'], minutes: 5000 / 60_000, tokens: 1000, calls: 1 }),
      row('substream:affaan-m/ECC', { items: 12, ideas: 2, accepted: 1 }),
      row('skill:coder', { loaded: 2, ok: 2, failed: 0 }),
      row('skill:no-ai-slop', { loaded: 2, ok: 2, failed: 0 }),
      row('skill:review', { loaded: 1, ok: 1, failed: 0 }),
      row('skill:skeptic', { loaded: 1, ok: 1, failed: 0 }),
      row('skill:controller', { loaded: 1, ok: 0, failed: 1 }),
    ]);
    expect(rows.find((r) => r.id === 'role:coder')!.cost.usd).toBeCloseTo(4.79, 10);
  });

  it('flags a hook whose p95 is above its threshold, the default or its own', () => {
    expect(ledger().rows.filter((r) => r.slow).map((r) => r.id)).toEqual(['hook:pre-tool']);
    const strict = functionLedger(FIXTURE, { ...OPTS, hookP95Ms: { default: 1000 } });
    expect(strict.rows.filter((r) => r.slow).map((r) => r.id)).toEqual(['hook:pre-tool', 'hook:stop-gate']);
    const exact = functionLedger(FIXTURE, { ...OPTS, hookP95Ms: { default: 2500, 'stop-gate': 30_000 } });
    expect(exact.rows.filter((r) => r.slow)).toEqual([]);
  });

  it('puts in Needs you each function that ran in its last N runs and recorded only zeros or nothing', () => {
    expect(ledger().needs).toEqual<Ledger['needs']>([
      { id: 'gate:secret-scan', runs: 3, metric: 'wall time' },
      { id: 'hook:loop-guard', runs: 3, metric: 'wall time' },
      { id: 'role:hardener', runs: 3, metric: 'tokens' },
    ]);
  });

  it('carries the window and the price table it used', () => {
    const l = ledger();
    expect([l.since, l.now, l.prices]).toEqual([OPTS.since, OPTS.now, { date: '2026-10-04', source: 'test rates', placeholder: false }]);
  });

  it('counts nothing outside the window: before since, or after now', () => {
    const late = functionLedger(FIXTURE, { ...OPTS, now: '2026-10-01T10:01:30.000Z' });
    expect(late.rows.find((r) => r.id === 'gate:red-check')!.value.runs).toBe(1);
    expect(late.rows.find((r) => r.id === 'gate:test')!.value.runs).toBe(0);
    const early = functionLedger(FIXTURE, { ...OPTS, since: '2026-09-01T00:00:00.000Z' });
    expect(early.rows.find((r) => r.id === 'role:coder')!.cost.tokens).toBe(10_950_000);
    const edge = functionLedger(FIXTURE, { ...OPTS, since: '2026-10-01T10:01:00.000Z', now: '2026-10-01T10:02:00.000Z' });
    expect(edge.rows.find((r) => r.id === 'gate:red-check')!.value.runs).toBe(0);
    expect(edge.rows.find((r) => r.id === 'gate:test')!.value.runs).toBe(1);
  });

  it('names each function the window\'s records name that the registry does not, once, and gives it no row', () => {
    expect(ledger().unregistered).toEqual([]);
    const extra: Observation = { at: '2026-10-02T00:00:00.000Z', run: 'r2', project: 'p', ticket: 't', role: 'coder', kind: 'gate', gate: 'new-gate', sha: 's', verdict: 'pass', reasons: [], ms: 5 };
    const l = functionLedger([...FIXTURE, extra, { ...extra, run: 'r3' }], { ...OPTS, registry: REGISTRY.slice(1) });
    expect(l.unregistered).toEqual(['gate:test', 'gate:new-gate']);
    expect(l.rows.map((r) => r.id)).toEqual(ids.slice(1));
  });
});

describe('slowHooks: the hooks above their p95 threshold, on their own', () => {
  it('flags each slow hook with its p95, against its own threshold or the default', () => {
    expect(slowHooks(FIXTURE, REGISTRY, { default: 1000 })).toEqual([
      { id: 'hook:pre-tool', p95Ms: 2500 },
      { id: 'hook:stop-gate', p95Ms: 30_000 },
    ]);
    expect(slowHooks(FIXTURE, REGISTRY, { default: 1000, 'stop-gate': 30_000 })).toEqual([{ id: 'hook:pre-tool', p95Ms: 2500 }]);
    expect(slowHooks(FIXTURE, REGISTRY, { default: 0, 'pre-tool': 2500, 'stop-gate': 30_000 })).toEqual([{ id: 'hook:observe', p95Ms: 60 }]);
  });

  it('reads only hook records, so a gate or session of the same name is not timed as one', () => {
    const named = [{ id: 'hook:lint', kind: 'hook', name: 'lint', source: 'x' }] as WorkflowFunction[];
    const gateRun: Observation = { at: '2026-10-01T00:00:00.000Z', run: 'r', project: 'p', ticket: 't', role: 'coder', kind: 'gate', gate: 'lint', sha: 's', verdict: 'pass', reasons: [], ms: 9000 };
    expect(slowHooks([gateRun], named, { default: 1 })).toEqual([]);
  });
});

describe('role value', () => {
  const g = (at: string, ticket: string, verdict: 'pass' | 'fail', roleName = 'coder', run = 'r'): Observation =>
    ({ at, run, project: 'p', ticket, role: roleName, kind: 'gate', gate: 'test', sha: 's', verdict, reasons: [], ms: 1 }) as Observation;
  const registry = [{ id: 'role:coder', kind: 'role', name: 'coder', source: 'x' }] as WorkflowFunction[];
  const opts = { ...OPTS, registry, since: '2026-01-01T00:00:00.000Z' };

  it('counts a ticket the role ended red as an escalation, and leaves review fix rounds out of its tickets', () => {
    const records = [
      g('2026-10-01T00:00:00.000Z', 'p-01-coder', 'fail'),
      g('2026-10-01T00:01:00.000Z', 'p-01-coder', 'fail'),
      g('2026-10-01T00:02:00.000Z', 'p-02-coder', 'pass'),
      g('2026-10-01T00:02:00.000Z', 'p-02-coder', 'fail'),
      g('2026-10-01T00:03:00.000Z', 'p-02-review-fix-1', 'pass'),
      g('2026-10-01T00:04:00.000Z', 'p-03-specifier', 'fail', 'specifier'),
    ];
    expect(functionLedger(records, opts).rows[0].value).toEqual({ tickets: 2, firstTry: 0, escalations: 2, fixRounds: 0, sessions: 0 });
  });
});

describe('value and cost, case by case', () => {
  const at = '2026-10-02T00:00:00.000Z';
  const b = (role: string, ticket = '01') => ({ at, run: 'r2', project: 'sample', ticket, role });
  const finding = (over: Record<string, unknown>): Observation =>
    ({ ...b('review'), kind: 'finding', source: 'spec', id: 'x', severity: 'HIGH', axis: 'a', file: 'z.ts', summary: 's', fate: 'fix', reason: 'fixed in round 1', ...over }) as Observation;
  const one = (id: string, records: Observation[]) => functionLedger([...FIXTURE, ...records], { ...OPTS, registry: REGISTRY.filter((f) => f.id === id) }).rows[0];

  it('gives a hook with no call no p50 or p95 at all', () => {
    expect(Object.keys(one('hook:loop-guard', []).cost)).toEqual(['usd', 'unpriced', 'tokens', 'unknown', 'minutes', 'calls']);
  });

  it('gives a gate with no run in the window zeros', () => {
    const rows = functionLedger(FIXTURE, { ...OPTS, registry: [{ id: 'gate:quiet', kind: 'gate', name: 'quiet', source: 'x' }] }).rows;
    expect(rows[0].value).toEqual({ runs: 0, catches: 0, escapes: 0, falseAlarms: 0, couldNotRun: 0 });
  });

  it('counts only fixed findings as fix rounds a role caused', () => {
    expect(one('role:coder', [finding({ ticket: '02', fate: 'decline', reason: 'style', file: 'q.ts' })]).value.fixRounds).toBe(1);
    expect(one('role:coder', [finding({ ticket: '02', file: 'q.ts' })]).value.fixRounds).toBe(2);
  });

  it("counts in the reviewer's funnel only the review's findings, a claim told apart by its exact words in any case, a group by any of its findings", () => {
    const owner = finding({ role: 'owner', source: 'owner', file: 'o.ts' });
    const words = [finding({ file: 'w.ts', summary: 'Straße' }), finding({ file: 'w.ts', summary: 'STRASSE' })];
    const mixed = [finding({ file: 'm.ts', fate: 'fix', reason: 'fixed in round 1' }), finding({ file: 'm.ts', fate: 'decline', reason: 'refuted by the skeptic: m.ts:1' })];
    expect(one('role:reviewer', [owner]).value).toMatchObject({ raw: 4, unique: 3 });
    expect(one('role:reviewer', words).value).toMatchObject({ raw: 6, unique: 5 });
    expect(one('role:reviewer', mixed).value).toMatchObject({ raw: 6, unique: 4, confirmed: 2, fixed: 2, refuted: 2 });
    expect(one('role:skeptic', [owner]).value).toMatchObject({ checked: 3 });
  });

  it("counts a substream's own items, and only the owner's acceptances of its own proposals", () => {
    const stream = (name: string): Observation => ({ ...b(''), kind: 'stream', stream: name, items: 100, ideas: 7 });
    const choice = (item: string, itemKind: string, choice: string): Observation => ({ ...b('owner'), kind: 'choice', item, itemKind, choice, note: '' }) as Observation;
    const records = [
      stream('a/other'),
      choice('proposal/a-other-abc-hooks.json', 'proposal', 'accept'),
      choice('proposal/affaan-m-ECC-def-ci.json', 'proposal', 'reject'),
      choice('proposal/affaan-m-ECC-def-x.json', 'lesson', 'accept'),
    ];
    expect(one('substream:affaan-m/ECC', records).value).toEqual({ items: 12, ideas: 2, accepted: 1 });
  });
});

describe('zeroGuard', () => {
  const g = (run: string, ms: number): Observation => ({ at: '2026-10-01T00:00:00.000Z', run, project: 'p', ticket: 't', role: 'coder', kind: 'gate', gate: 'lint', sha: 's', verdict: 'pass', reasons: [], ms });
  const registry = [{ id: 'gate:lint', kind: 'gate', name: 'lint', source: 'x' }] as WorkflowFunction[];

  it('needs N runs: fewer runs of zeros are not flagged yet', () => {
    expect(zeroGuard([g('a', 0), g('b', 0)], registry, 3)).toEqual([]);
    expect(zeroGuard([g('a', 0), g('b', 0), g('c', 0)], registry, 3)).toEqual([{ id: 'gate:lint', runs: 3, metric: 'wall time' }]);
  });

  it('looks at the last N runs only: an old nonzero run does not hide recent zeros, a recent one clears them', () => {
    expect(zeroGuard([g('a', 5), g('b', 0), g('c', 0), g('d', 0)], registry, 3)).toEqual([{ id: 'gate:lint', runs: 3, metric: 'wall time' }]);
    expect(zeroGuard([g('a', 0), g('b', 0), g('c', 0), g('d', 5)], registry, 3)).toEqual([]);
  });

  it("counts only a gate's own runs, so other gates running later do not make it look idle", () => {
    const other = (run: string) => ({ ...g(run, 5), gate: 'x' }) as Observation;
    expect(zeroGuard([g('a', 5), g('b', 5), g('c', 5), other('d'), other('e'), other('f')], registry, 3)).toEqual([]);
  });

  it('counts the runs with tool calls as runs a hook should have timed', () => {
    const hooks = [{ id: 'hook:observe', kind: 'hook', name: 'observe', source: 'x' }] as WorkflowFunction[];
    const tool = (run: string): Observation => ({ at: '2026-10-01T00:00:00.000Z', run, project: 'p', ticket: 't', role: 'coder', kind: 'tool', tool: 'Read', target: 'a', result: 'ok' });
    const timed = (run: string): Observation => ({ at: '2026-10-01T00:00:00.000Z', run, project: 'p', ticket: 't', role: 'coder', kind: 'hook', hook: 'observe', ms: 9, outcome: 'allow' });
    const records = ['a', 'b', 'c'].flatMap((run) => [tool(run), timed(run)]);
    expect(zeroGuard([...records, g('d', 5), g('e', 5), g('f', 5)], hooks, 3)).toEqual([]);
    expect(zeroGuard([...records, tool('d'), g('d', 5), tool('e'), tool('f')], hooks, 3)).toEqual([{ id: 'hook:observe', runs: 3, metric: 'wall time' }]);
  });

  it("counts a role's runs by its tool calls, its gate runs or its sessions, and only its own sessions' tokens", () => {
    const roles = [
      { id: 'role:hardener', kind: 'role', name: 'hardener', source: 'x' },
      { id: 'role:planner', kind: 'role', name: 'planner', source: 'x' },
    ] as WorkflowFunction[];
    const gated = (run: string): Observation => ({ ...g(run, 5), role: 'hardener' });
    const session = (run: string, tokensIn: number, fn = 'role:planner'): Observation =>
      ({ at: '2026-10-01T00:00:00.000Z', run, project: 'p', ticket: 't', role: 'x', kind: 'session', fn, model: 'm', tokensIn, tokensOut: 0, cacheRead: 0, cacheWrite: 0, ms: 1, outcome: 'ok', skills: [] }) as Observation;
    expect(zeroGuard([gated('a'), gated('b'), gated('c')], roles, 3)).toEqual([{ id: 'role:hardener', runs: 3, metric: 'tokens' }]);
    expect(zeroGuard([session('a', 0), session('b', 0), session('c', 0)], roles, 3)).toEqual([{ id: 'role:planner', runs: 3, metric: 'tokens' }]);
    expect(zeroGuard([session('a', 5), session('b', 5), session('c', 5), g('d', 1), g('e', 1), g('f', 1)], roles, 3)).toEqual([]);
    // A hook's record carries the session's role, but a hook call is not the role running.
    const hooked = (run: string): Observation => ({ at: '2026-10-01T00:00:00.000Z', run, project: 'p', ticket: 't', role: 'hardener', kind: 'hook', hook: 'observe', ms: 5, outcome: 'allow' });
    expect(zeroGuard([hooked('a'), hooked('b'), hooked('c')], roles, 3)).toEqual([]);
    // The planner's tokens in the same runs are not the hardener's.
    const busy = ['a', 'b', 'c'].flatMap((run) => [gated(run), session(run, 5)]);
    expect(zeroGuard(busy, roles.slice(0, 1), 3)).toEqual([{ id: 'role:hardener', runs: 3, metric: 'tokens' }]);
    expect(zeroGuard([...busy, session('c', 5, 'role:hardener')], roles.slice(0, 1), 3)).toEqual([]);
  });

  it('does not guard skills or substreams, whose zeros are real (a quiet repo, an unused skill)', () => {
    const fns = [
      { id: 'skill:coder', kind: 'skill', name: 'coder', source: 'x' },
      { id: 'substream:a/b', kind: 'substream', name: 'a/b', source: 'x' },
    ] as WorkflowFunction[];
    const stream: Observation = { at: '2026-10-01T00:00:00.000Z', run: 'a', project: '', ticket: '', role: '', kind: 'stream', stream: 'a/b', items: 0, ideas: 0 };
    expect(zeroGuard([stream, { ...stream, run: 'b' }, { ...stream, run: 'c' }], fns, 1)).toEqual([]);
  });
});

describe('percentile (nearest rank)', () => {
  it('takes the value at the rank ceil(q * n)', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4], 0.95)).toBe(4);
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200], 0.95)).toBe(190);
    expect(percentile([7], 0.95)).toBe(7);
  });
});

describe('a cloud session whose cost is unknown (ticket 27)', () => {
  const planner = [{ id: 'role:planner', kind: 'role', name: 'planner', source: 'x' }] as WorkflowFunction[];
  const session = (run: string, over: Record<string, unknown> = {}): Observation =>
    ({ at: '2026-10-01T00:00:00.000Z', run, project: 'p', ticket: 't', role: 'planner', placement: 'cloud', kind: 'session', fn: 'role:planner', model: 'unknown', tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, tokens: null, ms: 0, outcome: 'ok', skills: [], ...over }) as Observation;

  it('counts it apart as unknown, never as zero tokens or an unpriced model', () => {
    const known = session('b', { model: 'claude-sonnet-5', tokensIn: 1_000_000, tokens: undefined });
    const cost = functionLedger([session('a'), known], { ...OPTS, registry: planner }).rows[0].cost;
    expect(cost).toMatchObject({ usd: 2, unpriced: [], tokens: 1_000_000, unknown: 1, calls: 2 });
  });

  it('is not a zero for the zero guard', () => {
    expect(zeroGuard([session('a'), session('b'), session('c')], planner, 3)).toEqual([]);
    expect(zeroGuard([session('a', { tokens: undefined }), session('b', { tokens: undefined }), session('c', { tokens: undefined })], planner, 3)).toEqual([{ id: 'role:planner', runs: 3, metric: 'tokens' }]);
  });
});
