import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseObservations, type Observation } from './observations.ts';
import { gateEvents, gateMetrics, median, type GateRow } from './gate-metrics-core.ts';

const ROOT = resolve(import.meta.dirname, '..');
const FIXTURE = parseObservations(readFileSync(join(ROOT, 'test', 'fixtures', 'observations', 'gates.jsonl'), 'utf8'));
const NOW = '2026-10-04T12:00:00.000Z';

const base = (at: string, project = 'sample', ticket = 'sample-01-coder', role = 'coder') => ({ at, run: 'r1', project, ticket, role });
const gate = (at: string, name: string, verdict: 'pass' | 'fail' | 'could-not-run', over: Partial<Observation> = {}, project = 'sample', ticket = 'sample-01-coder') =>
  ({ ...base(at, project, ticket), kind: 'gate', gate: name, sha: 'a1', verdict, reasons: [], ms: 100, ...over }) as Observation;
const override = (at: string, name: string, ticket = '', project = 'sample') =>
  ({ ...base(at, project, ticket, 'owner'), kind: 'choice', item: 'plan/x/y.md', itemKind: 'plan', choice: 'override', note: '', gate: name }) as Observation;
const suppression = (at: string, name: string, ticket = 'sample-01-coder') => ({ ...base(at, 'sample', ticket), kind: 'suppression', gate: name, file: 'a.ts', reason: 'fixture' }) as Observation;
const finding = (at: string, over: Record<string, unknown> = {}) =>
  ({ ...base(at, 'sample', '01', 'review'), kind: 'finding', source: 'spec', id: 'f1', severity: 'HIGH', axis: 'correctness', file: 'a.ts', summary: 'wrong', fate: 'fix', reason: '', ...over }) as Observation;

const ZERO = { catches: 0, escapes: 0, falseAlarms: 0, couldNotRun: 0 };

describe('Pass when: a fixture observation log with known events gives the exact counts for each gate', () => {
  const m = () => gateMetrics(FIXTURE, { window: 3, now: NOW });

  it('counts runs, fails, catches, escapes, false alarms, could-not-run, dead gates and cost per gate over every project', () => {
    expect(m().gates).toEqual<GateRow[]>([
      {
        gate: 'lint',
        project: '',
        runs: 3,
        fails: 0,
        catches: 0,
        escapes: 0,
        falseAlarms: 0,
        couldNotRun: 0,
        couldNotRunRate: 0,
        falseAlarmRate: 0,
        dead: true,
        ms: { median: 1000, total: 3000 },
        week: ZERO,
        weekBefore: ZERO,
      },
      {
        gate: 'secret-scan',
        project: '',
        runs: 2,
        fails: 1,
        catches: 0,
        escapes: 0,
        falseAlarms: 1,
        couldNotRun: 0,
        couldNotRunRate: 0,
        falseAlarmRate: 1,
        dead: false,
        ms: { median: 200, total: 400 },
        week: ZERO,
        weekBefore: { ...ZERO, falseAlarms: 1 },
      },
      {
        gate: 'skeptic',
        project: '',
        runs: 2,
        fails: 0,
        catches: 0,
        escapes: 0,
        falseAlarms: 0,
        couldNotRun: 0,
        couldNotRunRate: 0,
        falseAlarmRate: 0,
        dead: false,
        ms: { median: 25000, total: 50000 },
        tokens: { median: 2000, total: 4000 },
        week: ZERO,
        weekBefore: ZERO,
      },
      {
        gate: 'test',
        project: '',
        runs: 8,
        fails: 3,
        catches: 2,
        escapes: 1,
        falseAlarms: 1,
        couldNotRun: 1,
        couldNotRunRate: 1 / 8,
        falseAlarmRate: 1 / 3,
        dead: false,
        lastCatch: '2026-10-02T09:00:00.000Z',
        ms: { median: 4250, total: 31500 },
        week: { catches: 1, escapes: 1, falseAlarms: 1, couldNotRun: 1 },
        weekBefore: { ...ZERO, catches: 1 },
      },
    ]);
  });

  it('gives the same counts per gate and project', () => {
    const test = m().perProject.filter((r) => r.gate === 'test');
    expect(test.map((r) => [r.project, r.runs, r.fails, r.catches, r.escapes, r.falseAlarms, r.couldNotRun, r.lastCatch])).toEqual([
      ['other', 2, 1, 1, 0, 0, 0, '2026-10-02T09:00:00.000Z'],
      ['sample', 6, 2, 1, 1, 1, 1, '2026-09-22T10:00:00.000Z'],
    ]);
    expect(m().perProject.map((r) => `${r.gate}/${r.project}`)).toEqual(['lint/sample', 'secret-scan/sample', 'skeptic/sample', 'test/other', 'test/sample']);
  });

  it('lists every escape with the gate that should have caught it when one fits, and the commit the gates passed', () => {
    expect(m().escapes).toEqual([
      { at: '2026-10-03T20:00:00.000Z', project: 'sample', ticket: '02', source: 'spec', summary: 'tabs are not trimmed', gate: 'test', sha: 'b2' },
      { at: '2026-10-03T20:00:00.000Z', project: 'sample', ticket: '03', source: 'standards', summary: 'an API key is logged', sha: 'c3' },
    ]);
  });
});

describe('gateEvents: catches, false alarms and escapes from the log', () => {
  it('counts a fail that the agent then fixed (a pass on the same project, ticket and gate) as one catch, dated at the fail', () => {
    const events = gateEvents([gate('t1', 'test', 'fail'), gate('t2', 'test', 'fail'), gate('t3', 'test', 'pass'), gate('t4', 'test', 'pass')]);
    expect(events.filter((e) => e.type === 'catch')).toEqual([{ type: 'catch', gate: 'test', project: 'sample', at: 't1' }]);
  });

  it('does not count a pass on another ticket, gate or project as fixing the fail', () => {
    const events = gateEvents([
      gate('t1', 'test', 'fail'),
      gate('t2', 'test', 'pass', {}, 'sample', 'sample-02-coder'),
      gate('t3', 'lint', 'pass'),
      gate('t4', 'test', 'pass', {}, 'other'),
    ]);
    expect(events.filter((e) => e.type === 'catch')).toEqual([]);
  });

  it('does not count a could-not-run as a fail nor a pass', () => {
    const events = gateEvents([gate('t1', 'test', 'could-not-run'), gate('t2', 'test', 'pass'), gate('t3', 'test', 'fail'), gate('t4', 'test', 'could-not-run')]);
    expect(events.filter((e) => e.type === 'catch')).toEqual([]);
  });

  it('counts an override by the owner as a false alarm, and the fail it overrode as no catch', () => {
    const events = gateEvents([gate('t1', 'test', 'fail'), override('t2', 'test'), gate('t3', 'test', 'pass')]);
    expect(events.filter((e) => e.type !== 'run')).toEqual([{ type: 'false-alarm', gate: 'test', project: 'sample', at: 't2', source: 'override' }]);
  });

  it('counts a new suppression as a false alarm', () => {
    const events = gateEvents([gate('t1', 'onkel', 'fail'), suppression('t2', 'onkel'), gate('t3', 'onkel', 'pass')]);
    expect(events.filter((e) => e.type !== 'run')).toEqual([{ type: 'false-alarm', gate: 'onkel', project: 'sample', at: 't2', source: 'suppression' }]);
  });

  it('marks only the open fail of the same project and gate, and of the same ticket when the false alarm names one', () => {
    const events = gateEvents([
      gate('t1', 'test', 'fail', {}, 'sample', 'sample-01-coder'),
      gate('t2', 'test', 'fail', {}, 'sample', 'sample-02-coder'),
      gate('t3', 'test', 'fail', {}, 'other', 'other-01-coder'),
      gate('t4', 'lint', 'fail', {}, 'sample', 'sample-02-coder'),
      suppression('t5', 'test', 'sample-01-coder'),
      gate('t6', 'test', 'pass', {}, 'sample', 'sample-01-coder'),
      gate('t7', 'test', 'pass', {}, 'sample', 'sample-02-coder'),
      gate('t8', 'test', 'pass', {}, 'other', 'other-01-coder'),
      gate('t9', 'lint', 'pass', {}, 'sample', 'sample-02-coder'),
    ]);
    expect(events.filter((e) => e.type === 'catch').map((e) => e.at)).toEqual(['t2', 't3', 't4']);
  });

  it('marks the latest open fail of its own project and gate when an override names no ticket, not a later one of another project or gate', () => {
    const events = gateEvents([
      gate('t1', 'test', 'fail', {}, 'sample'),
      gate('t2', 'lint', 'fail', {}, 'sample'),
      gate('t3', 'test', 'fail', {}, 'other'),
      override('t4', 'test'),
      gate('t5', 'test', 'pass', {}, 'sample'),
      gate('t6', 'lint', 'pass', {}, 'sample'),
      gate('t7', 'test', 'pass', {}, 'other'),
    ]);
    expect(events.filter((e) => e.type === 'catch').map((e) => e.at)).toEqual(['t2', 't3']);
  });

  it('marks the latest open fail when an override names no ticket', () => {
    const events = gateEvents([
      gate('t1', 'test', 'fail', {}, 'sample', 'sample-01-coder'),
      gate('t2', 'test', 'fail', {}, 'sample', 'sample-02-coder'),
      override('t3', 'test'),
      gate('t4', 'test', 'pass', {}, 'sample', 'sample-01-coder'),
      gate('t5', 'test', 'pass', {}, 'sample', 'sample-02-coder'),
    ]);
    expect(events.filter((e) => e.type === 'catch').map((e) => e.at)).toEqual(['t1']);
  });

  it('still counts a false alarm with no open fail, and a fail closed before it stays a catch', () => {
    const events = gateEvents([gate('t1', 'test', 'fail'), gate('t2', 'test', 'pass'), override('t3', 'test')]);
    expect(events.filter((e) => e.type !== 'run').map((e) => e.type)).toEqual(['catch', 'false-alarm']);
  });

  it('ignores an accept or reject, and an override that names no gate', () => {
    const accept = { ...override('t2', 'test'), choice: 'accept' } as Observation;
    const { gate: _, ...nameless } = override('t3', 'test') as Observation & { gate: string };
    const events = gateEvents([gate('t1', 'test', 'fail'), accept, nameless as Observation, gate('t4', 'test', 'pass')]);
    expect(events.filter((e) => e.type !== 'run').map((e) => e.type)).toEqual(['catch']);
  });

  it('counts a later finding as an escape, with its gate and commit when it has them; a declined finding is not a defect', () => {
    const events = gateEvents([finding('t1', { gate: 'test', sha: 'abc', fate: 'escalate' }), finding('t2', { source: 'revert', summary: 'reverted' }), finding('t3', { fate: 'decline' })]);
    expect(events).toEqual([
      { type: 'escape', at: 't1', project: 'sample', ticket: '01', source: 'spec', summary: 'wrong', gate: 'test', sha: 'abc' },
      { type: 'escape', at: 't2', project: 'sample', ticket: '01', source: 'revert', summary: 'reverted' },
    ]);
  });

  it('records every gate run with its verdict, time and tokens, and nothing for tool calls', () => {
    const tool = { ...base('t0'), kind: 'tool', tool: 'Edit', target: 'a', result: 'ok' } as Observation;
    expect(gateEvents([tool, gate('t1', 'skeptic', 'pass', { ms: 7, tokens: 9 } as Partial<Observation>), gate('t2', 'test', 'could-not-run', { ms: 0 })])).toEqual([
      { type: 'run', gate: 'skeptic', project: 'sample', at: 't1', verdict: 'pass', ms: 7, tokens: 9 },
      { type: 'run', gate: 'test', project: 'sample', at: 't2', verdict: 'could-not-run', ms: 0 },
    ]);
  });
});

describe('gateMetrics: rates, dead gates, cost and the week', () => {
  const opts = { window: 2, now: NOW };

  it('counts a gate dead after the window with no fail, and alive once a fail is in its last runs', () => {
    const dead = gateMetrics([gate('t1', 'g', 'fail'), gate('t2', 'g', 'pass'), gate('t3', 'g', 'pass')], opts).gates[0];
    expect(dead).toMatchObject({ dead: true, lastCatch: 't1' });
    expect(gateMetrics([gate('t1', 'g', 'pass'), gate('t2', 'g', 'fail'), gate('t3', 'g', 'pass')], opts).gates[0].dead).toBe(false);
    expect(gateMetrics([gate('t1', 'g', 'pass')], opts).gates[0].dead).toBe(false);
    expect(gateMetrics([gate('t1', 'g', 'pass'), gate('t2', 'g', 'pass')], opts).gates[0].dead).toBe(true);
  });

  it('gives rates of 0 for a gate with no runs or no fails, and a row for a gate seen only in a false alarm or an escape', () => {
    const rows = gateMetrics([override('t1', 'a'), finding('t2', { gate: 'b' })], opts).gates;
    expect(rows.map((r) => [r.gate, r.runs, r.couldNotRunRate, r.falseAlarmRate, r.falseAlarms, r.escapes, r.dead, r.ms])).toEqual([
      ['a', 0, 0, 1, 1, 0, false, { median: 0, total: 0 }],
      ['b', 0, 0, 0, 0, 1, false, { median: 0, total: 0 }],
    ]);
  });

  it('leaves tokens out when no run of the gate used a model', () => {
    expect(gateMetrics([gate('t1', 'g', 'pass')], opts).gates[0]).not.toHaveProperty('tokens');
  });

  it('puts an event exactly a week old in the week before, and one exactly two weeks old in neither', () => {
    const at = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();
    const rows = gateMetrics([override(at(0), 'g'), override(at(7), 'g'), override(at(6.9), 'g'), override(at(14), 'g'), override(at(13.9), 'g'), override(at(-1), 'g')], opts).gates[0];
    expect([rows.week.falseAlarms, rows.weekBefore.falseAlarms]).toEqual([2, 2]);
  });

  it('sorts rows by gate, then project', () => {
    const rows = gateMetrics([gate('t1', 'b', 'pass', {}, 'z'), gate('t2', 'a', 'pass', {}, 'y'), gate('t3', 'b', 'pass', {}, 'x')], opts).perProject;
    expect(rows.map((r) => `${r.gate}/${r.project}`)).toEqual(['a/y', 'b/x', 'b/z']);
  });
});

describe('median', () => {
  it('is the middle value, the mean of the two middle ones for an even count, 0 for none, whatever the order', () => {
    expect([median([3, 1, 2]), median([4, 1, 3, 2]), median([]), median([10, 2])]).toEqual([2, 2.5, 0, 6]);
  });
});
