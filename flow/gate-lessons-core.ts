// Gate thresholds (ticket 15b): a gate whose metrics cross a threshold in config/workflow.yaml
// becomes one lesson through the learning loop (ticket 15), filed as a waiting item with a
// suggested change: fix (could not run too often), loosen (too many false alarms), retire (dead),
// tighten (defects got past it) or add a gate (defects no gate fits). Each lesson goes to a code
// gate, so accepting it files a ticket draft (apply-lesson); nothing changes before the owner
// accepts it, and filing only ever writes the waiting item.

import { lessonOfFile, type Lesson } from './learn.ts';
import { parseObservations } from '../runner/observations.ts';
import { parseWorkflowConfig, type WorkflowConfig } from './workflow-config.ts';
import { gateMetrics, type Escape, type GateMetrics, type GateRow } from '../runner/gate-metrics-core.ts';

export interface GateThresholds {
  falseAlarmRate: number;
  couldNotRunRate: number;
  deadWindow: number;
  minRuns: number;
  escapes: number;
}

export type Suggestion = 'fix' | 'loosen' | 'retire' | 'tighten' | 'add';

export interface GateLesson {
  /** Empty for a lesson to add a gate. */
  gate: string;
  suggestion: Suggestion;
  lesson: Lesson;
}

export interface LessonIo {
  /** Whether state/approvals/{pending,accepted,rejected}/<id> exists. */
  exists(id: string): boolean;
  /** The ids of every waiting item. */
  pendingIds(): string[];
  fileLesson(id: string, text: string): void;
}

const MAX_EXAMPLES = 5;

export const thresholdsOf = (c: WorkflowConfig): GateThresholds => ({
  falseAlarmRate: c.gateFalseAlarmRate,
  couldNotRunRate: c.gateCouldNotRunRate,
  deadWindow: c.gateDeadWindowRuns,
  minRuns: c.gateMinRuns,
  escapes: c.gateEscapes,
});

const percent = (rate: number) => `${Math.round(rate * 100)}%`;
const day = (at: string) => at.slice(0, 10);
const lesson = (summary: string, count: number, examples: string[], change: string, word: string): Lesson => ({
  project: '',
  seen: { summary, count, examples: examples.slice(0, MAX_EXAMPLES) },
  change: `${change} Suggested change: ${word}.`,
  destination: 'gate',
});

const escapeLine = (e: Escape) => `${e.summary} (${e.project} ${e.ticket}${e.sha === undefined ? '' : `, commit ${e.sha}`})`;

type Rule = [Suggestion, (r: GateRow, t: GateThresholds) => boolean, (r: GateRow, t: GateThresholds, escapes: Escape[]) => Lesson];

/** Built per call: a table built when the module loads is out of reach of mutation testing. */
const rules = (): Rule[] => [
  [
    'fix',
    (r, t) => r.runs >= t.minRuns && r.couldNotRunRate > t.couldNotRunRate,
    (r, t) =>
      lesson(
        `${r.gate} could not run (exit 2) in ${r.couldNotRun} of its ${r.runs} runs (${percent(r.couldNotRunRate)}), above the ${percent(t.couldNotRunRate)} threshold.`,
        r.couldNotRun,
        [`${r.couldNotRun} of ${r.runs} runs could not run`],
        `Fix ${r.gate} so it runs: find why it exits 2 and make it pass or fail on its own.`,
        'fix',
      ),
  ],
  [
    'loosen',
    (r, t) => r.runs >= t.minRuns && r.falseAlarmRate > t.falseAlarmRate,
    (r, t) =>
      lesson(
        `${r.falseAlarms} of the alarms ${r.gate} raised were false (your override or a new suppression), ${percent(r.falseAlarmRate)}, above the ${percent(t.falseAlarmRate)} threshold.`,
        r.falseAlarms,
        [`${r.falseAlarms} of ${Math.max(r.fails, r.falseAlarms)} alarms were false`],
        `Loosen ${r.gate}: narrow what it flags, or add a reviewed exception for what it gets wrong.`,
        'loosen',
      ),
  ],
  [
    'retire',
    (r) => r.dead,
    (r, t) => {
      const last = r.lastCatch === undefined ? ['it has never caught anything', 'no catch so far'] : [`its last catch was on ${day(r.lastCatch)}`, `last catch ${day(r.lastCatch)}`];
      return lesson(`${r.gate} has not failed in its last ${t.deadWindow} runs; ${last[0]}.`, t.deadWindow, [last[1]], `Retire ${r.gate}, or tighten it if it should still catch something.`, 'retire');
    },
  ],
  [
    'tighten',
    (r, t) => r.escapes >= t.escapes,
    (r, _t, escapes) => {
      const mine = escapes.filter((e) => e.gate === r.gate);
      return lesson(`${r.escapes} defects passed ${r.gate} and were found later.`, r.escapes, mine.map(escapeLine), `Tighten ${r.gate} so it catches defects like these before review.`, 'tighten');
    },
  ],
];

const addLesson = (escapes: Escape[], t: GateThresholds): GateLesson[] => {
  const unfitted = escapes.filter((e) => e.gate === undefined);
  if (unfitted.length < t.escapes) return [];
  const seen = `${unfitted.length} defects were found after every gate passed, and no gate fits them.`;
  return [{ gate: '', suggestion: 'add', lesson: lesson(seen, unfitted.length, unfitted.map(escapeLine), 'Add a gate for defects like these.', 'add a gate') }];
};

/** One lesson per crossed threshold, per gate in row order, then one to add a gate. */
export function gateLessons(m: GateMetrics, t: GateThresholds): GateLesson[] {
  const perGate = m.gates.flatMap((r) =>
    rules().filter(([, crossed]) => crossed(r, t)).map(([suggestion, , make]): GateLesson => ({ gate: r.gate, suggestion, lesson: make(r, t, m.escapes) })),
  );
  return [...perGate, ...addLesson(m.escapes, t)];
}

/** The Monday of the week `at` falls in (UTC), as YYYY-MM-DD. */
export function weekOf(at: string): string {
  const d = new Date(at);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday)).toISOString().slice(0, 10);
}

/** Files each lesson as a waiting item, at most once a week per gate and suggestion and never while one waits; returns the new ids. */
export function fileGateLessons(lessons: GateLesson[], run: string, now: string, io: LessonIo): string[] {
  const pending = io.pendingIds();
  return lessons.flatMap((l) => {
    const prefix = `lesson/gate-${l.gate || 'new'}-${l.suggestion}-`;
    const id = `${prefix}${weekOf(now)}.json`;
    if (io.exists(id) || pending.some((p) => p.startsWith(prefix))) return [];
    io.fileLesson(id, lessonOfFile(l.lesson, run));
    return [id];
  });
}

/** The run note on gate lessons filed this run; none when none was. */
export function gateLessonsNote(ids: string[]): string[] {
  if (ids.length === 0) return [];
  const what = ids.length === 1 ? '1 gate crossed a threshold; its lesson waits' : `${ids.length} gate thresholds were crossed; their lessons wait`;
  return [`Gate metrics: ${what} for your approval.`];
}

/** The dispatcher's step after the learning loop: the observation log against config/workflow.yaml's thresholds; returns the lessons filed. */
export function runGateLessons(observations: string | undefined, config: WorkflowConfig, run: string, now: string, io: LessonIo): string[] {
  const m = gateMetrics(parseObservations(observations), { window: config.gateDeadWindowRuns, now });
  return fileGateLessons(gateLessons(m, thresholdsOf(config)), run, now, io);
}

/** What scripts/gate-metrics prints: every gate's metrics and the lessons a run would file (none is filed); exit 2 on a broken config. */
export function gateReport(observations: string | undefined, configText: string, now: string): { stdout: string; stderr: string; exitCode: 0 | 2 } {
  const parsed = parseWorkflowConfig(configText);
  if (!parsed.ok) return { stdout: '', stderr: `${parsed.error}\n`, exitCode: 2 };
  const m = gateMetrics(parseObservations(observations), { window: parsed.config.gateDeadWindowRuns, now });
  const lessons = gateLessons(m, thresholdsOf(parsed.config)).map((l) => ({ gate: l.gate, suggestion: l.suggestion, seen: l.lesson.seen.summary, change: l.lesson.change }));
  return { stdout: `${JSON.stringify({ now, ...m, lessons }, null, 2)}\n`, stderr: '', exitCode: 0 };
}
