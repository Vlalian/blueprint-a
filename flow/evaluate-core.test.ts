import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseObservations, type Observation } from '../runner/observations.ts';
import type { EvaluationConfig } from './evaluation-config.ts';
import {
  evaluate,
  evaluationReport,
  fileSuggestionLessons,
  mergeTargets,
  evaluationBefore,
  previousEvaluation,
  sinceTime,
  SUMMARY_END,
  SUMMARY_START,
  trendOf,
  type EvaluatedRow,
  type EvaluationInput,
} from './evaluate-core.ts';
import type { LedgerRow } from '../runner/function-ledger-core.ts';
import { registryOf, registryText, type WorkflowFunction } from '../runner/functions-core.ts';
import type { PriceTable } from '../runner/prices-core.ts';

const ROOT = resolve(import.meta.dirname, '..');
const LOG = readFileSync(join(ROOT, 'test', 'fixtures', 'ledger', 'observations.jsonl'), 'utf8');
const FIXTURE = parseObservations(LOG);

// Test rates, not prices.
const PRICES: PriceTable = {
  date: '2026-10-04',
  source: 'test rates',
  placeholder: false,
  models: { sonnet: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }, opus: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 } },
};
const CONFIG: EvaluationConfig = {
  zeroGuardRuns: 3,
  hookP95Ms: { default: 1000, 'stop-gate': 60_000 },
  gateRemoveAtMinutes: 20,
  gateRemoveAtUsd: 5,
  gateTuneAboveFalseAlarmRate: 0.3,
  gateTuneAboveCouldNotRunRate: 0.1,
  roleTuneBelowFirstTryRate: 0.5,
  reviewerTuneBelowConfirmedRate: 0.3,
  substreamRemoveAtItems: 10,
  skillTuneAboveFailedRate: 0.5,
};
const fns = (...ids: string[]) =>
  ids.map((id): WorkflowFunction => {
    const [kind, name] = id.split(/:(.*)/);
    return { id, kind: kind as WorkflowFunction['kind'], name, source: 'x' };
  });
const REGISTRY = fns(
  'gate:test',
  'gate:lint',
  'gate:onkel',
  'gate:secret-scan',
  'hook:pre-tool',
  'hook:observe',
  'hook:loop-guard',
  'role:coder',
  'role:hardener',
  'role:reviewer',
  'role:skeptic',
  'role:planner',
  'role:evaluator',
  'substream:affaan-m/ECC',
  'skill:coder',
  'skill:controller',
);
const INPUT: EvaluationInput = { records: FIXTURE, registry: REGISTRY, prices: PRICES, config: CONFIG, since: '2026-09-30T00:00:00.000Z', sinceLabel: 'abc1234', now: '2026-10-04T12:00:00.000Z' };
const said = (rows: EvaluatedRow[]) => rows.map((r) => [r.id, r.suggestion, r.reason]);

describe('Pass when: the report suggests remove for a gate with no catches and high cost, keep for one with catches', () => {
  it('suggests per function by the rules, first rule that holds', () => {
    expect(said(evaluate(INPUT).rows)).toEqual([
      ['gate:test', 'keep', 'caught 1'],
      ['gate:lint', 'keep', 'no catch in 3 runs, but cheap: 0.1 min and $0.00 over the window'],
      ['gate:onkel', 'remove', 'no catch in 3 runs, at 30.0 min and $0.00 over the window (remove at 20 min or $5.00)'],
      ['gate:secret-scan', 'tune', 'recorded only zeros or nothing in its last 3 runs; fix its recording first'],
      ['hook:pre-tool', 'tune', 'p95 2500 ms is above its threshold'],
      ['hook:observe', 'keep', 'p95 60 ms'],
      ['hook:loop-guard', 'tune', 'recorded only zeros or nothing in its last 3 runs; fix its recording first'],
      ['role:coder', 'keep', 'passed first try on 2 of 3 tickets, 0 escalated, 1 fix rounds'],
      ['role:hardener', 'tune', 'recorded only zeros or nothing in its last 3 runs; fix its recording first'],
      ['role:reviewer', 'keep', 'confirmed 1 of 3 unique findings (4 raw, 1 fixed, 1 refuted)'],
      ['role:skeptic', 'keep', 'refuted 1 of 3 HIGH findings'],
      ['role:planner', 'keep', '1 sessions, no ticket to judge'],
      ['role:evaluator', 'keep', 'did not run in this window'],
      ['substream:affaan-m/ECC', 'keep', '1 of 2 ideas accepted from 12 items read'],
      ['skill:coder', 'keep', '0 of 2 sessions that loaded it failed'],
      ['skill:controller', 'tune', '1 of 1 sessions that loaded it failed, above 0.5'],
    ]);
  });

  it('removes a gate by its USD too, and keeps an expensive gate that catches', () => {
    const priced = { ...CONFIG, gateRemoveAtMinutes: 1000, gateRemoveAtUsd: 0 };
    const rows = evaluate({ ...INPUT, config: priced }).rows;
    expect(said(rows).slice(0, 3)).toEqual([
      ['gate:test', 'keep', 'caught 1'],
      ['gate:lint', 'remove', 'no catch in 3 runs, at 0.1 min and $0.00 over the window (remove at 1000 min or $0.00)'],
      ['gate:onkel', 'remove', 'no catch in 3 runs, at 30.0 min and $0.00 over the window (remove at 1000 min or $0.00)'],
    ]);
    const exactly = evaluate({ ...INPUT, config: { ...CONFIG, gateRemoveAtMinutes: 30 } }).rows;
    expect(exactly.find((r) => r.id === 'gate:onkel')!.suggestion).toBe('remove');
    const below = evaluate({ ...INPUT, config: { ...CONFIG, gateRemoveAtMinutes: 30.01 } }).rows;
    expect(below.find((r) => r.id === 'gate:onkel')!.suggestion).toBe('keep');
  });

  it("marks the evaluator's own row as self-assessment, and only that one", () => {
    const rows = evaluate(INPUT).rows;
    expect(rows.filter((r) => r.selfAssessment).map((r) => r.id)).toEqual(['role:evaluator']);
    expect(evaluate(INPUT).markdown).toContain('| role:evaluator (self-assessment) |');
  });
});

describe('the other rules', () => {
  const g = (at: string, gate: string, verdict: 'pass' | 'fail' | 'could-not-run', ticket = 't1', run = 'r1'): Observation => ({
    at,
    run,
    project: 'p',
    ticket,
    role: 'coder',
    kind: 'gate',
    gate,
    sha: 's',
    verdict,
    reasons: [],
    ms: 1000,
  });
  const run = (records: Observation[], registry: WorkflowFunction[], config: Partial<EvaluationConfig> = {}) =>
    evaluate({ ...INPUT, records, registry, config: { ...CONFIG, zeroGuardRuns: 99, ...config } }).rows;

  it('merges a gate whose every catch another gate also caught: into the one with more catches, or the first by name', () => {
    const records = [
      g('2026-10-01T00:00:00.000Z', 'a', 'fail'),
      g('2026-10-01T00:00:00.000Z', 'b', 'fail'),
      g('2026-10-01T00:00:00.000Z', 'c', 'fail'),
      g('2026-10-01T00:01:00.000Z', 'a', 'pass'),
      g('2026-10-01T00:01:00.000Z', 'b', 'pass'),
      g('2026-10-01T00:01:00.000Z', 'c', 'pass'),
      g('2026-10-01T00:02:00.000Z', 'c', 'fail', 't2'),
      g('2026-10-01T00:03:00.000Z', 'c', 'pass', 't2'),
    ];
    expect(said(run(records, fns('gate:a', 'gate:b', 'gate:c')))).toEqual([
      ['gate:a', 'merge', 'every catch (1) was also caught by gate:c'],
      ['gate:b', 'merge', 'every catch (1) was also caught by gate:a'],
      ['gate:c', 'keep', 'caught 2'],
    ]);
    expect([...mergeTargets(records)]).toEqual([
      ['gate:a', 'gate:c'],
      ['gate:b', 'gate:a'],
    ]);
  });

  it('tunes a gate with too many false alarms or could-not-run, above (not at) the rate', () => {
    const fa = (gate: string, at: string): Observation => ({ at, run: 'r1', project: 'p', ticket: '', role: 'owner', kind: 'suppression', gate, file: 'a', reason: 'x' }) as Observation;
    const records = [
      g('2026-10-01T00:00:00.000Z', 'loud', 'pass'),
      g('2026-10-01T00:00:01.000Z', 'loud', 'pass'),
      g('2026-10-01T00:00:02.000Z', 'loud', 'pass'),
      fa('loud', '2026-10-01T00:00:03.000Z'),
      g('2026-10-01T00:00:00.000Z', 'broken', 'could-not-run'),
      g('2026-10-01T00:00:01.000Z', 'broken', 'pass'),
    ];
    expect(said(run(records, fns('gate:loud', 'gate:broken'), { gateRemoveAtMinutes: 1000 }))).toEqual([
      ['gate:loud', 'tune', '1 of 3 runs were false alarms (above 0.3)'],
      ['gate:broken', 'tune', '1 of 2 runs could not run (above 0.1)'],
    ]);
    expect(said(run(records, fns('gate:loud', 'gate:broken'), { gateRemoveAtMinutes: 1000, gateTuneAboveFalseAlarmRate: 1 / 3, gateTuneAboveCouldNotRunRate: 0.5 })).map((s) => s[1])).toEqual(['keep', 'keep']);
  });

  it('tunes a role that passed first try on too few tickets, and reviewers that confirmed too few findings', () => {
    const records = [g('2026-10-01T00:00:00.000Z', 'test', 'fail', 'p-1-coder'), g('2026-10-01T00:00:01.000Z', 'test', 'pass', 'p-2-coder')];
    expect(said(run(records, fns('role:coder'), { roleTuneBelowFirstTryRate: 0.6 }))).toEqual([['role:coder', 'tune', 'passed first try on 1 of 2 tickets, 1 escalated, 0 fix rounds, below 0.6']]);
    expect(run(records, fns('role:coder'), { roleTuneBelowFirstTryRate: 0.5 })[0].suggestion).toBe('keep');
    const rows = evaluate({ ...INPUT, registry: fns('role:reviewer'), config: { ...CONFIG, reviewerTuneBelowConfirmedRate: 0.34 } }).rows;
    expect(said(rows)).toEqual([['role:reviewer', 'tune', 'confirmed 1 of 3 unique findings (4 raw, 1 fixed, 1 refuted), below 0.34']]);
    const at = evaluate({ ...INPUT, registry: fns('role:reviewer'), config: { ...CONFIG, reviewerTuneBelowConfirmedRate: 1 / 3 } }).rows;
    expect(at[0].suggestion).toBe('keep');
    const quiet = FIXTURE.filter((r) => r.kind === 'session' && r.fn === 'role:reviewer');
    expect(said(run(quiet, fns('role:reviewer')))).toEqual([['role:reviewer', 'keep', 'confirmed 0 of 0 unique findings (0 raw, 0 fixed, 0 refuted)']]);
  });

  it('removes a substream that read many items and had no idea accepted', () => {
    const stream = (items: number): Observation => ({ at: '2026-10-01T00:00:00.000Z', run: 'r1', project: '', ticket: '', role: '', kind: 'stream', stream: 'a/b', items, ideas: 1 });
    expect(said(run([stream(10)], fns('substream:a/b')))).toEqual([['substream:a/b', 'remove', '0 of 1 ideas accepted from 10 items read']]);
    expect(run([stream(9)], fns('substream:a/b'))[0].suggestion).toBe('keep');
  });

  it('keeps a skill whose failed share is at, not above, the rate', () => {
    const s = (outcome: 'ok' | 'error', at: string): Observation =>
      ({ at, run: 'r1', project: '', ticket: '', role: '', kind: 'session', fn: 'role:x', model: 'm', tokensIn: 1, tokensOut: 0, cacheRead: 0, cacheWrite: 0, ms: 1, outcome, skills: ['k'] }) as Observation;
    expect(run([s('ok', '2026-10-01T00:00:00.000Z'), s('error', '2026-10-01T00:00:01.000Z')], fns('skill:k'))[0].suggestion).toBe('keep');
  });
});

describe('trend since the last evaluation', () => {
  const row = { id: 'gate:a', kind: 'gate', name: 'a', value: { runs: 3, catches: 1 }, cost: { usd: 1.5, unpriced: [], minutes: 2, tokens: 0, unknown: 0, calls: 3 }, slow: false } as LedgerRow;

  it('says new for a function the last one did not have, no change when nothing moved, else each move', () => {
    expect(trendOf(row, undefined)).toBe('new');
    expect(trendOf(row, { id: 'gate:a', value: { runs: 3, catches: 1 }, usd: 1.5, minutes: 2 })).toBe('no change');
    expect(trendOf(row, { id: 'gate:a', value: { runs: 1 }, usd: 0.5, minutes: 1.04 })).toBe('runs 1 → 3, catches 0 → 1, USD $0.50 → $1.50, minutes 1.0 → 2.0');
  });

  it('reads the previous evaluation JSON, and treats a broken one as none', () => {
    const first = evaluate(INPUT);
    const again = evaluate({ ...INPUT, previous: first.json });
    expect(again.rows.every((r) => r.trend === 'no change')).toBe(true);
    expect(evaluate({ ...INPUT, previous: '{' }).rows.every((r) => r.trend === 'new')).toBe(true);
    expect(evaluate({ ...INPUT, previous: '{"rows": 3}' }).rows.every((r) => r.trend === 'new')).toBe(true);
  });

  it('takes --since as a commit time when git names one, else as given', () => {
    expect(sinceTime('abc', { status: 0, stdout: '2026-10-01T12:00:00+02:00\n' })).toBe('2026-10-01T10:00:00.000Z');
    expect(sinceTime('2026-09-01', { status: 128, stdout: '' })).toBe('2026-09-01');
    expect(sinceTime('2026-09-01', { status: 0, stdout: '\n' })).toBe('2026-09-01');
    expect(sinceTime('2026-09-01', { status: 1, stdout: '2026-10-01T12:00:00+02:00' })).toBe('2026-09-01');
  });

  it('finds the newest earlier evaluation by its file name', () => {
    expect(previousEvaluation(['2026-09-20.json', '2026-09-01.json', '2026-08-01.json', '2026-09-20.md', '2026-10-04.json', 'x.json', '2026-09-2x0000-01-01.json', '2026-09-22.jsonx'], '2026-10-04')).toBe('2026-09-20.json');
    expect(previousEvaluation(['2026-10-04.json'], '2026-10-04')).toBeUndefined();
    const read = (name: string) => `text of ${name}`;
    expect(evaluationBefore(['2026-09-01.json', '2026-10-04.json', '2026-10-04.md'], read)).toBe('text of 2026-10-04.json');
    expect(evaluationBefore(['2026-09-01.json', '2026-10-04.json'], read, '2026-10-04')).toBe('text of 2026-09-01.json');
    expect(evaluationBefore(['2026-10-04.md'], read)).toBeUndefined();
  });
});

describe('the report', () => {
  it('writes every number with the window, the prices and an empty summary for the evaluator to word', () => {
    const e = evaluate({ ...INPUT, registry: fns('gate:test', 'hook:pre-tool', 'role:planner', 'role:evaluator'), previous: JSON.stringify({ rows: [{ id: 'gate:test', value: { runs: 1 }, usd: 0, minutes: 0 }] }) });
    expect(e.date).toBe('2026-10-04');
    expect(e.markdown).toBe(
      [
        '# Evaluation 2026-10-04',
        '',
        'Window: after 2026-09-30T00:00:00.000Z (--since abc1234) up to 2026-10-04T12:00:00.000Z. Every number below is from `node scripts/evaluate.ts`; the summary is worded by the evaluator agent and holds no number of its own.',
        '',
        'Prices: config/prices.json, 2026-10-04, test rates.',
        '',
        '## Summary',
        '',
        SUMMARY_START,
        'No summary yet: the evaluator agent writes it.',
        SUMMARY_END,
        '',
        '## Needs you',
        '',
        '- **gate:red-check**, **gate:lint**, **gate:onkel** and 7 more ran but config/functions.json does not list them: run `node scripts/functions.ts --write`, or they have no row here.',
        '',
        '## Gates',
        '',
        '| Function | Value local | Value cloud | USD local | USD cloud | Minutes local | Minutes cloud | Since last evaluation | Suggestion |',
        '|---|---|---|---|---|---|---|---|---|',
        '| gate:test | runs 2, catches 1, escapes 0, false alarms 0, could not run 0 | - | $0.00 | $0.00 | 0.1 | 0.0 | runs 1 → 2, catches 0 → 1, minutes 0.0 → 0.1 | **keep**: caught 1 |',
        '',
        '## Hooks',
        '',
        '| Function | Value local | Value cloud | USD local | USD cloud | Minutes local | Minutes cloud | Since last evaluation | Suggestion |',
        '|---|---|---|---|---|---|---|---|---|',
        '| hook:pre-tool | calls 5, blocks 1; p50 120 ms, p95 2500 ms (slow) | - | $0.00 | $0.00 | 0.0 | 0.0 | new | **tune**: p95 2500 ms is above its threshold |',
        '',
        '## Roles',
        '',
        '| Function | Value local | Value cloud | USD local | USD cloud | Minutes local | Minutes cloud | Since last evaluation | Suggestion |',
        '|---|---|---|---|---|---|---|---|---|',
        '| role:planner | tickets 0, first try 0, escalations 0, fix rounds 0, sessions 1 | - | $0.00 + unpriced gpt-x | $0.00 | 0.1 | 0.0 | new | **keep**: 1 sessions, no ticket to judge |',
        '| role:evaluator (self-assessment) | - | - | $0.00 | $0.00 | 0.0 | 0.0 | new | **keep**: did not run in this window |',
        '',
      ].join('\n'),
    );
  });

  it('lists Needs you, marks placeholder prices, escapes a pipe, and leaves out a kind with no function', () => {
    const e = evaluate({ ...INPUT, registry: fns('gate:secret-scan', 'hook:observe', 'substream:a|b'), prices: { ...PRICES, placeholder: true, source: 'PLACEHOLDER' } });
    expect(e.markdown).toContain('Prices: config/prices.json, 2026-10-04, PLACEHOLDER. **Placeholder rates: every USD figure here is a placeholder.**\n');
    expect(e.markdown).toContain('## Needs you\n\n- **gate:secret-scan** ran in its last 3 runs and recorded only zeros or nothing (wall time). Fix its recording before trusting its numbers.\n- **gate:red-check**');
    expect(e.markdown).toContain('| substream:a\\|b |');
    const second: Observation = { ...(FIXTURE.find((r) => r.kind === 'session' && r.fn === 'role:planner') as Observation), model: 'gpt-y' } as Observation;
    expect(evaluate({ ...INPUT, records: [...FIXTURE, second], registry: fns('role:planner') }).markdown).toContain('| $0.00 + unpriced gpt-x, gpt-y |');
    expect(e.markdown).toContain('| hook:observe | calls 2, blocks 0; p50 50 ms, p95 60 ms | - | $0.00 | $0.00 | 0.0 | 0.0 | new | **keep**: p95 60 ms |');
    expect(e.markdown).not.toContain('## Roles');
    const quiet = evaluate({ ...INPUT, records: FIXTURE.filter((r) => r.kind === 'session' && r.fn === 'role:planner'), registry: fns('role:planner') });
    expect(quiet.markdown).toContain('## Needs you\n\nNothing needs you.\n\n## Roles');
    expect(e.markdown).not.toContain('## Skills');
  });

  it('lists in Needs you each function the logs name that the registry does not', () => {
    const e = evaluate({ ...INPUT, registry: fns('gate:lint'), config: { ...CONFIG, zeroGuardRuns: 99 } });
    expect(e.markdown).toContain(
      '## Needs you\n\n- **gate:red-check**, **gate:test**, **gate:onkel** and 9 more ran but config/functions.json does not list them: run `node scripts/functions.ts --write`, or they have no row here.\n\n## Gates',
    );
    const two = evaluate({ ...INPUT, registry: fns('gate:lint'), config: { ...CONFIG, zeroGuardRuns: 99 }, records: FIXTURE.filter((r) => r.kind === 'gate') });
    expect(two.markdown).toContain('- **gate:red-check**, **gate:test**, **gate:onkel** and 1 more ran but');
  });

  it('names up to three unregistered functions in full', () => {
    const only = (...gates: string[]) => evaluate({ ...INPUT, registry: fns('gate:lint'), records: FIXTURE.filter((r) => r.kind === 'gate' && gates.includes(r.gate)) }).markdown;
    expect(only('lint', 'test', 'onkel', 'red-check')).toContain('- **gate:red-check**, **gate:test**, **gate:onkel** ran but config/functions.json does not list them');
    expect(only('lint', 'test')).toContain('- **gate:test** ran but config/functions.json does not list them');
  });

  it('heads the substreams and skills tables, and marks the summary for the evaluator', () => {
    const e = evaluate({ ...INPUT, registry: fns('substream:affaan-m/ECC', 'skill:coder') });
    expect(e.markdown).toContain('\n## Input substreams\n\n| Function |');
    expect(e.markdown).toContain('\n## Skills\n\n| Function |');
    expect([SUMMARY_START, SUMMARY_END]).toEqual(['<!-- summary -->', '<!-- /summary -->']);
  });

  it('writes the same numbers as JSON for the next trend and the briefing', () => {
    const e = evaluate({ ...INPUT, registry: fns('hook:pre-tool') });
    expect(JSON.parse(e.json)).toEqual({
      date: '2026-10-04',
      since: INPUT.since,
      sinceLabel: 'abc1234',
      now: INPUT.now,
      prices: { date: '2026-10-04', source: 'test rates', placeholder: false },
      needs: [],
      rows: [
        {
          id: 'hook:pre-tool',
          kind: 'hook',
          value: { calls: 5, blocks: 1 },
          usd: 0,
          unpriced: [],
          minutes: 2960 / 60_000,
          tokens: 0,
          unknown: 0,
          calls: 5,
          p50Ms: 120,
          p95Ms: 2500,
          slow: true,
          suggestion: 'tune',
          reason: 'p95 2500 ms is above its threshold',
          selfAssessment: false,
          trend: 'new',
          local: { value: { calls: 5, blocks: 1 }, usd: 0, unpriced: [], tokens: 0, unknown: 0, minutes: 2960 / 60_000, calls: 5, p50Ms: 120, p95Ms: 2500 },
          cloud: { value: { calls: 0, blocks: 0 }, usd: 0, unpriced: [], tokens: 0, unknown: 0, minutes: 0, calls: 0 },
        },
      ],
    });
    expect(e.json.endsWith('}\n')).toBe(true);
  });

  it('splits value and cost into local and cloud columns, and says the cost of a cloud session with no usage is unknown, never zero', () => {
    const cloud = (over: Record<string, unknown>) =>
      ({ at: '2026-10-02T00:00:00.000Z', run: 'cloud:s1', project: 'p', ticket: 't', role: 'planner', placement: 'cloud', kind: 'session', fn: 'role:planner', model: 'claude-sonnet-5', tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, ms: 0, outcome: 'ok', skills: [], ...over }) as Observation;
    const records = [...FIXTURE, cloud({ tokensIn: 1_000_000, ms: 60_000 }), cloud({ model: 'unknown', tokens: null }), cloud({ model: 'unknown', tokens: null, run: 'cloud:s2' })];
    const e = evaluate({ ...INPUT, records, registry: fns('role:planner') });
    expect(e.markdown).toContain(
      '| role:planner | tickets 0, first try 0, escalations 0, fix rounds 0, sessions 1 | tickets 0, first try 0, escalations 0, fix rounds 0, sessions 3 | $0.00 + unpriced gpt-x | $2.00 + cost unknown for 2 sessions | 0.1 | 1.0 |',
    );
    const row = JSON.parse(e.json).rows[0];
    expect(row.cloud).toMatchObject({ usd: 2, unknown: 2, calls: 3, minutes: 1 });
    expect(row.local).toMatchObject({ usd: 0, unknown: 0, unpriced: ['gpt-x'] });
    expect(row).toMatchObject({ usd: 2, unknown: 2 });
  });

  it('names one session whose cost is unknown in the singular', () => {
    const one = { at: '2026-10-02T00:00:00.000Z', run: 'cloud:s1', project: 'p', ticket: 't', role: 'planner', placement: 'cloud', kind: 'session', fn: 'role:planner', model: 'unknown', tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, tokens: null, ms: 0, outcome: 'ok', skills: [] } as Observation;
    expect(evaluate({ ...INPUT, records: [one], registry: fns('role:planner') }).markdown).toContain('| - | tickets 0, first try 0, escalations 0, fix rounds 0, sessions 1 | $0.00 | $0.00 + cost unknown for 1 session | 0.0 | 0.0 |');
  });
});

describe('Pass when: nothing changes without an accepted lesson', () => {
  const io = (exists: string[] = [], pending: string[] = []) => {
    const filed: [string, string][] = [];
    return { filed, io: { exists: (id: string) => exists.includes(id), pendingIds: () => pending, fileLesson: (id: string, text: string) => void filed.push([id, text]) } };
  };

  it('files each suggestion other than keep as a waiting lesson, and writes nothing else', () => {
    const { filed, io: lessons } = io();
    const e = evaluate({ ...INPUT, registry: fns('gate:test', 'gate:onkel', 'role:evaluator', 'skill:controller') });
    expect(fileSuggestionLessons(e, 'run-9', lessons)).toEqual(['lesson/eval-gate-onkel-remove-2026-10-04.json', 'lesson/eval-skill-controller-tune-2026-10-04.json']);
    expect(filed.map(([id]) => id)).toEqual(['lesson/eval-gate-onkel-remove-2026-10-04.json', 'lesson/eval-skill-controller-tune-2026-10-04.json']);
    expect(JSON.parse(filed[0][1])).toEqual({
      project: '',
      seen: 'gate:onkel: no catch in 3 runs, at 30.0 min and $0.00 over the window (remove at 20 min or $5.00). Seen 3 times, for example: evaluation 2026-10-04: runs 3, catches 0, escapes 0, false alarms 0, could not run 0; $0.00, 30.0 min.',
      change: 'Remove gate:onkel, as the evaluation of 2026-10-04 suggests (docs/evaluations/2026-10-04.md). Suggested change: remove.',
      destination: 'gate',
      count: 3,
      examples: ['evaluation 2026-10-04: runs 3, catches 0, escapes 0, false alarms 0, could not run 0; $0.00, 30.0 min'],
      run: 'run-9',
    });
    expect(JSON.parse(filed[1][1]).count).toBe(1);
  });

  it("marks a lesson about the evaluator's own row as self-assessment", () => {
    const { filed, io: lessons } = io();
    const self: Observation = { at: '2026-10-01T00:00:00.000Z', run: 'r1', project: '', ticket: '', role: 'evaluator', kind: 'session', fn: 'role:evaluator', model: 'sonnet', tokensIn: 1, tokensOut: 0, cacheRead: 0, cacheWrite: 0, ms: 1, outcome: 'error', skills: ['evaluator'] };
    const g = { at: '2026-10-01T00:00:00.000Z', run: 'r1', project: 'p', ticket: 'p-1-evaluator', role: 'evaluator', kind: 'gate', gate: 'x', sha: 's', verdict: 'fail', reasons: [], ms: 1 } as Observation;
    const e = evaluate({ ...INPUT, records: [self, g], registry: fns('role:evaluator') });
    fileSuggestionLessons(e, 'r', lessons);
    expect(JSON.parse(filed[0][1]).seen).toMatch(/^\(self-assessment\) role:evaluator: passed first try on 0 of 1 tickets/);
  });

  it('files a suggestion once a day, and not while one for the same function and suggestion waits', () => {
    const e = evaluate({ ...INPUT, registry: fns('gate:onkel') });
    expect(fileSuggestionLessons(e, 'r', io(['lesson/eval-gate-onkel-remove-2026-10-04.json']).io)).toEqual([]);
    expect(fileSuggestionLessons(e, 'r', io([], ['lesson/eval-gate-onkel-remove-2026-09-01.json']).io)).toEqual([]);
    expect(fileSuggestionLessons(e, 'r', io([], ['lesson/eval-gate-onkel-tune-2026-09-01.json']).io)).toEqual(['lesson/eval-gate-onkel-remove-2026-10-04.json']);
  });
});

describe('evaluationReport: what scripts/evaluate writes', () => {
  const texts = {
    observations: LOG,
    registry: registryText(registryOf({ gateDirs: ['onkel'], checks: [], hooks: [], skills: [], substreams: [] })),
    prices: JSON.stringify(PRICES),
    config: JSON.stringify(CONFIG),
    previous: undefined,
  };
  const window = { since: INPUT.since, sinceLabel: 'abc1234', now: INPUT.now };

  it('the report and its JSON under docs/evaluations/, named by the date, exit 0', () => {
    const r = evaluationReport(texts, window);
    expect([r.exitCode, r.stdout, r.stderr]).toEqual([0, 'docs/evaluations/2026-10-04.md\ndocs/evaluations/2026-10-04.json\n', '']);
    expect(r.files.map(([path]) => path)).toEqual(['docs/evaluations/2026-10-04.md', 'docs/evaluations/2026-10-04.json']);
    expect(r.files[0][1]).toContain('| gate:onkel |');
    expect(r.files[1][1]).toBe(r.evaluation!.json);
  });

  it.each<[string, Partial<typeof texts>, Partial<typeof window>, string]>([
    ['broken prices', { prices: '{' }, {}, 'config/prices.json is not valid JSON\n'],
    ['no prices', { prices: undefined }, {}, 'config/prices.json is not valid JSON\n'],
    ['broken thresholds', { config: '[]' }, {}, 'config/evaluation.json is not a JSON object\n'],
    ['no thresholds', { config: undefined }, {}, 'config/evaluation.json is not valid JSON\n'],
    ['no registry', { registry: undefined }, {}, 'config/functions.json is not a function registry\n'],
    ['a since that is no time', {}, { since: 'nope', sinceLabel: 'main~99' }, '--since main~99 is neither a time nor a commit\n'],
  ])('exit 2 and nothing written: %s', (_name, over, win, stderr) => {
    const r = evaluationReport({ ...texts, ...over }, { ...window, ...win });
    expect([r.exitCode, r.stdout, r.stderr, r.files, r.evaluation]).toEqual([2, '', stderr, [], undefined]);
  });
});
