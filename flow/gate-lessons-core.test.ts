import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLessons } from './learn.ts';
import { parseObservations } from '../runner/observations.ts';
import type { WorkflowConfig } from './workflow-config.ts';
import { lintProse } from '../gates/slop-lint/lint.ts';
import { fileGateLessons, gateLessons, gateLessonsNote, gateReport, runGateLessons, thresholdsOf, weekOf, type GateLesson, type LessonIo } from './gate-lessons-core.ts';
import { gateMetrics, type GateMetrics, type GateRow } from '../runner/gate-metrics-core.ts';

const ROOT = resolve(import.meta.dirname, '..');
const FIXTURE_TEXT = readFileSync(join(ROOT, 'test', 'fixtures', 'observations', 'gates.jsonl'), 'utf8');
const FIXTURE = parseObservations(FIXTURE_TEXT);
const T = { falseAlarmRate: 0.3, couldNotRunRate: 0.1, deadWindow: 30, minRuns: 10, escapes: 2 };
const ZERO = { catches: 0, escapes: 0, falseAlarms: 0, couldNotRun: 0 };

const row = (over: Partial<GateRow> = {}): GateRow => ({
  gate: 'test',
  project: '',
  runs: 10,
  fails: 2,
  ...ZERO,
  couldNotRunRate: 0,
  falseAlarmRate: 0,
  dead: false,
  ms: { median: 1, total: 10 },
  week: ZERO,
  weekBefore: ZERO,
  ...over,
});
const metrics = (gates: GateRow[], escapes: GateMetrics['escapes'] = []): GateMetrics => ({ gates, perProject: [], escapes });
const esc = (gate: string | undefined, summary: string, sha?: string) => ({ at: 't', project: 'sample', ticket: '01', source: 'spec', summary, ...(gate ? { gate } : {}), ...(sha ? { sha } : {}) });

describe('thresholdsOf', () => {
  it('takes every threshold from config/workflow.yaml', () => {
    const config = { gateFalseAlarmRate: 0.4, gateCouldNotRunRate: 0.2, gateDeadWindowRuns: 25, gateMinRuns: 8, gateEscapes: 3 } as WorkflowConfig;
    expect(thresholdsOf(config)).toEqual({ falseAlarmRate: 0.4, couldNotRunRate: 0.2, deadWindow: 25, minRuns: 8, escapes: 3 });
  });
});

describe('Pass when: a crossed threshold produces one lesson', () => {
  it('suggests fixing a gate that could not run too often, as one lesson for a code gate', () => {
    const lessons = gateLessons(metrics([row({ couldNotRun: 2, couldNotRunRate: 0.2 })]), T);
    expect(lessons).toEqual<GateLesson[]>([
      {
        gate: 'test',
        suggestion: 'fix',
        lesson: {
          project: '',
          seen: { summary: 'test could not run (exit 2) in 2 of its 10 runs (20%), above the 10% threshold.', count: 2, examples: ['2 of 10 runs could not run'] },
          change: 'Fix test so it runs: find why it exits 2 and make it pass or fail on its own. Suggested change: fix.',
          destination: 'gate',
        },
      },
    ]);
  });

  it('suggests loosening a gate with too many false alarms', () => {
    const [lesson] = gateLessons(metrics([row({ fails: 4, falseAlarms: 2, falseAlarmRate: 0.5 })]), T);
    expect(lesson).toMatchObject({ gate: 'test', suggestion: 'loosen' });
    expect(lesson.lesson.seen).toEqual({ summary: '2 of the alarms test raised were false (your override or a new suppression), 50%, above the 30% threshold.', count: 2, examples: ['2 of 4 alarms were false'] });
    const [unfailed] = gateLessons(metrics([row({ fails: 0, falseAlarms: 3, falseAlarmRate: 1 })]), T);
    expect(unfailed.lesson.seen.examples).toEqual(['3 of 3 alarms were false']);
    expect(lesson.lesson.change).toBe('Loosen test: narrow what it flags, or add a reviewed exception for what it gets wrong. Suggested change: loosen.');
  });

  it('suggests retiring a dead gate, with the date of its last catch or never', () => {
    const [caught] = gateLessons(metrics([row({ dead: true, lastCatch: '2026-09-01T10:00:00.000Z' })]), T);
    expect(caught).toMatchObject({ gate: 'test', suggestion: 'retire' });
    expect(caught.lesson.seen).toEqual({ summary: 'test has not failed in its last 30 runs; its last catch was on 2026-09-01.', count: 30, examples: ['last catch 2026-09-01'] });
    expect(caught.lesson.change).toBe('Retire test, or tighten it if it should still catch something. Suggested change: retire.');
    expect(gateLessons(metrics([row({ dead: true })]), T)[0].lesson.seen).toMatchObject({ summary: 'test has not failed in its last 30 runs; it has never caught anything.', examples: ['no catch so far'] });
  });

  it('suggests tightening a gate that defects got past, with the escapes as examples', () => {
    const escapes = [esc('test', 'tabs are not trimmed', 'b2'), esc('lint', 'other'), esc('test', 'empty input crashes')];
    const [lesson] = gateLessons(metrics([row({ escapes: 2 })], escapes), T);
    expect(lesson).toMatchObject({ gate: 'test', suggestion: 'tighten' });
    expect(lesson.lesson.seen).toEqual({ summary: '2 defects passed test and were found later.', count: 2, examples: ['tabs are not trimmed (sample 01, commit b2)', 'empty input crashes (sample 01)'] });
    expect(lesson.lesson.change).toBe('Tighten test so it catches defects like these before review. Suggested change: tighten.');
  });

  it('suggests adding a gate when defects that no gate fits reach the threshold', () => {
    const escapes = [esc(undefined, 'an API key is logged', 'c3'), esc('test', 'x'), esc(undefined, 'a secret in a URL')];
    expect(gateLessons(metrics([], escapes), T)).toEqual<GateLesson[]>([
      {
        gate: '',
        suggestion: 'add',
        lesson: {
          project: '',
          seen: { summary: '2 defects were found after every gate passed, and no gate fits them.', count: 2, examples: ['an API key is logged (sample 01, commit c3)', 'a secret in a URL (sample 01)'] },
          change: 'Add a gate for defects like these. Suggested change: add a gate.',
          destination: 'gate',
        },
      },
    ]);
  });

  it('keeps at most five examples', () => {
    const escapes = [1, 2, 3, 4, 5, 6].map((n) => esc(undefined, `d${n}`));
    expect(gateLessons(metrics([], escapes), T)[0].lesson.seen.examples).toEqual(['d1', 'd2', 'd3', 'd4', 'd5'].map((d) => `${d} (sample 01)`));
  });

  it('files nothing for a gate on or under every threshold', () => {
    const quiet = row({ couldNotRun: 1, couldNotRunRate: 0.1, falseAlarms: 3, falseAlarmRate: 0.3, escapes: 1 });
    expect(gateLessons(metrics([quiet], [esc('test', 'x'), esc(undefined, 'y')]), T)).toEqual([]);
  });

  it('judges no rate before the gate has the minimum runs', () => {
    expect(gateLessons(metrics([row({ runs: 9, couldNotRun: 9, couldNotRunRate: 1, falseAlarms: 2, falseAlarmRate: 1 })]), T)).toEqual([]);
  });

  it('gives each crossed threshold of a gate its own lesson, in the order fix, loosen, retire, tighten', () => {
    const all = row({ couldNotRunRate: 0.5, falseAlarmRate: 0.5, dead: true, escapes: 2, couldNotRun: 5, falseAlarms: 1 });
    expect(gateLessons(metrics([all]), T).map((l) => l.suggestion)).toEqual(['fix', 'loosen', 'retire', 'tighten']);
  });

  it('turns the fixture log into lessons the learning loop accepts, each prose passing slop-lint', () => {
    const lessons = gateLessons(gateMetrics(FIXTURE, { window: 3, now: '2026-10-04T12:00:00.000Z' }), { ...T, deadWindow: 3, escapes: 1 });
    expect(lessons.map((l) => [l.gate, l.suggestion])).toEqual([
      ['lint', 'retire'],
      ['test', 'tighten'],
      ['', 'add'],
    ]);
    expect(parseLessons(JSON.stringify({ lessons: lessons.map((l) => l.lesson) }))).toEqual({ lessons: lessons.map((l) => l.lesson) });
    for (const l of lessons) expect(lintProse(`${l.lesson.seen.summary}\n${l.lesson.change}`)).toEqual([]);
  });
});

function memory(existing: string[] = [], pending: string[] = []) {
  const filed: [string, unknown][] = [];
  const io: LessonIo = { exists: (id) => existing.includes(id), pendingIds: () => pending, fileLesson: (id, text) => void filed.push([id, JSON.parse(text)]) };
  return { io, filed };
}

describe('Pass when: a crossed threshold produces one lesson and changes no gate by itself', () => {
  const lesson = () => gateLessons(metrics([row({ couldNotRun: 2, couldNotRunRate: 0.2 })]), T);

  it('files the lesson as one waiting item for the owner and writes nothing else', () => {
    const w = memory();
    expect(fileGateLessons(lesson(), 'r1', '2026-10-04T12:00:00.000Z', w.io)).toEqual(['lesson/gate-test-fix-2026-09-28.json']);
    expect(w.filed).toEqual([
      [
        'lesson/gate-test-fix-2026-09-28.json',
        {
          project: '',
          seen: 'test could not run (exit 2) in 2 of its 10 runs (20%), above the 10% threshold. Seen 2 times, for example: 2 of 10 runs could not run.',
          change: 'Fix test so it runs: find why it exits 2 and make it pass or fail on its own. Suggested change: fix.',
          destination: 'gate',
          count: 2,
          examples: ['2 of 10 runs could not run'],
          run: 'r1',
        },
      ],
    ]);
  });

  it('files it once a week: not again while it waits, nor after it was decided that week', () => {
    expect(fileGateLessons(lesson(), 'r2', '2026-10-04T12:00:00.000Z', memory(['lesson/gate-test-fix-2026-09-28.json']).io)).toEqual([]);
    expect(fileGateLessons(lesson(), 'r2', '2026-10-05T12:00:00.000Z', memory([], ['lesson/gate-test-fix-2026-09-28.json']).io)).toEqual([]);
    expect(fileGateLessons(lesson(), 'r2', '2026-10-05T12:00:00.000Z', memory(['lesson/gate-test-fix-2026-09-28.json'], ['lesson/gate-lint-fix-2026-09-28.json', 'lesson/gate-test-loosen-2026-09-28.json']).io)).toEqual([
      'lesson/gate-test-fix-2026-10-05.json',
    ]);
  });

  it('names a lesson to add a gate gate-new', () => {
    const add = gateLessons(metrics([], [esc(undefined, 'a'), esc(undefined, 'b')]), T);
    expect(fileGateLessons(add, 'r1', '2026-10-04T12:00:00.000Z', memory().io)).toEqual(['lesson/gate-new-add-2026-09-28.json']);
  });
});

describe('weekOf', () => {
  it('is the Monday of the week, in UTC', () => {
    expect(['2026-10-04T23:59:00.000Z', '2026-10-05T00:00:00.000Z', '2026-10-07T12:00:00.000Z', '2026-09-28T00:00:00.000Z'].map(weekOf)).toEqual([
      '2026-09-28',
      '2026-10-05',
      '2026-10-05',
      '2026-09-28',
    ]);
  });
});

describe('gateLessonsNote', () => {
  it('says how many gate lessons wait, or nothing when none was filed', () => {
    expect([gateLessonsNote([]), gateLessonsNote(['a']), gateLessonsNote(['a', 'b'])]).toEqual([
      [],
      ['Gate metrics: 1 gate crossed a threshold; its lesson waits for your approval.'],
      ['Gate metrics: 2 gate thresholds were crossed; their lessons wait for your approval.'],
    ]);
  });
});

describe('runGateLessons: the dispatcher step', () => {
  const config = { gateFalseAlarmRate: 0.3, gateCouldNotRunRate: 0.1, gateDeadWindowRuns: 3, gateMinRuns: 10, gateEscapes: 1 } as WorkflowConfig;

  it('reads the observation log, judges every gate against the config and files the lessons', () => {
    const w = memory();
    expect(runGateLessons(FIXTURE_TEXT, config, 'r9', '2026-10-04T12:00:00.000Z', w.io)).toEqual([
      'lesson/gate-lint-retire-2026-09-28.json',
      'lesson/gate-test-tighten-2026-09-28.json',
      'lesson/gate-new-add-2026-09-28.json',
    ]);
    expect(w.filed.map(([, l]) => (l as { run: string }).run)).toEqual(['r9', 'r9', 'r9']);
  });

  it('uses the dead-gate window from the config and files nothing without a log', () => {
    expect(runGateLessons(FIXTURE_TEXT, { ...config, gateDeadWindowRuns: 4, gateEscapes: 5 }, 'r9', '2026-10-04T12:00:00.000Z', memory().io)).toEqual([]);
    expect(runGateLessons(undefined, config, 'r9', '2026-10-04T12:00:00.000Z', memory().io)).toEqual([]);
  });
});

describe('gateReport: what scripts/gate-metrics prints', () => {
  const SHIPPED = readFileSync(join(ROOT, 'config', 'workflow.yaml'), 'utf8');

  it("prints every gate's metrics, per project, the escapes and the lessons a run would file, as JSON", () => {
    const r = gateReport(FIXTURE_TEXT, SHIPPED, '2026-10-04T12:00:00.000Z');
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    const m = gateMetrics(FIXTURE, { window: 30, now: '2026-10-04T12:00:00.000Z' });
    const lessons = gateLessons(m, { ...T, escapes: 1 }).map((l) => ({ gate: l.gate, suggestion: l.suggestion, seen: l.lesson.seen.summary, change: l.lesson.change }));
    expect(r.stdout).toBe(`${JSON.stringify({ now: '2026-10-04T12:00:00.000Z', ...m, lessons }, null, 2)}\n`);
    expect(lessons.map((l) => l.suggestion)).toEqual(['tighten', 'add']);
  });

  it('could not run, exit 2, on a broken config, and prints nothing on stdout', () => {
    expect(gateReport(FIXTURE_TEXT, 'nonsense: 1', 'now')).toEqual({ stdout: '', stderr: 'config/workflow.yaml: unknown key nonsense\n', exitCode: 2 });
  });
});
