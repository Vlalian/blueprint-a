// Gate metrics (ticket 15b): whether each gate earns its place, read from the observation log
// (dispatcher/observations.ts), per gate and per gate and project. The log is in time order.
// - Catch: a fail that the agent then fixed, a later pass on the same project, ticket and gate,
//   with no false alarm on it in between. Dated at the fail.
// - Escape: a defect found after every gate passed: a finding from review, CI, the incident
//   watcher, a revert or the owner, unless it was declined. It counts for the gate it names (the
//   one that should have caught it), when one fits; the commit its ticket was built on comes along.
// - False alarm: an override by the owner, or a new suppression, naming the gate. The open fail it
//   answers (same project and gate, same ticket when it names one) is then no catch.
// - Could not run: verdict could-not-run (exit 2), over every run of the gate.
// - Dead: no fail in the gate's last `window` runs, shown with the date of its last catch.
// - Cost: median and total wall-clock time, and tokens over the runs that used a model.
// The week and the week before count catches, escapes, false alarms and could-not-run in the
// seven days up to `now` and the seven days before that, for the briefing's trend.

import type { GateVerdict, Observation } from './observations.ts';

export type GateEvent =
  | { type: 'run'; gate: string; project: string; at: string; verdict: GateVerdict; ms: number; tokens?: number }
  | { type: 'catch'; gate: string; project: string; at: string }
  | { type: 'false-alarm'; gate: string; project: string; at: string; source: 'override' | 'suppression' }
  | ({ type: 'escape' } & Escape);

export interface Escape {
  at: string;
  project: string;
  ticket: string;
  source: string;
  summary: string;
  /** The gate that should have caught it, when one fits. */
  gate?: string;
  /** The commit its ticket was built on: the one every gate passed. */
  sha?: string;
}

export interface WeekCounts {
  catches: number;
  escapes: number;
  falseAlarms: number;
  couldNotRun: number;
}

export interface GateRow extends WeekCounts {
  gate: string;
  /** Empty for the row over every project. */
  project: string;
  runs: number;
  fails: number;
  /** Could-not-run per run. */
  couldNotRunRate: number;
  /** False alarms per alarm raised (a fail, or a false alarm with no fail seen). */
  falseAlarmRate: number;
  dead: boolean;
  lastCatch?: string;
  ms: { median: number; total: number };
  tokens?: { median: number; total: number };
  week: WeekCounts;
  weekBefore: WeekCounts;
}

export interface GateMetrics {
  /** One row per gate over every project. */
  gates: GateRow[];
  perProject: GateRow[];
  escapes: Escape[];
}

type Open = Map<string, { at: string; falseAlarm: boolean }>;
type Of<K extends Observation['kind']> = Extract<Observation, { kind: K }>;

const DAY = 86_400_000;

const keyOf = (project: string, ticket: string, gate: string) => JSON.stringify([project, ticket, gate]);

function gateRun(r: Of<'gate'>, open: Open): GateEvent[] {
  const run: GateEvent = { type: 'run', gate: r.gate, project: r.project, at: r.at, verdict: r.verdict, ms: r.ms, tokens: r.tokens };
  const key = keyOf(r.project, r.ticket, r.gate);
  const failed = open.get(key);
  if (r.verdict === 'fail' && failed === undefined) open.set(key, { at: r.at, falseAlarm: false });
  if (r.verdict !== 'pass') return [run];
  open.delete(key);
  return failed === undefined || failed.falseAlarm ? [run] : [run, { type: 'catch', gate: r.gate, project: r.project, at: failed.at }];
}

/** The false alarm, marking the latest open fail it answers. */
function falseAlarm(r: Of<'choice' | 'suppression'>, gate: string, source: 'override' | 'suppression', open: Open): GateEvent[] {
  const answered = [...open].filter(([key]) => {
    const [project, ticket, name] = JSON.parse(key) as string[];
    return project === r.project && name === gate && (r.ticket === '' || ticket === r.ticket);
  });
  const latest = answered.at(-1);
  if (latest !== undefined) latest[1].falseAlarm = true;
  return [{ type: 'false-alarm', gate, project: r.project, at: r.at, source }];
}

function escape(r: Of<'finding'>): GateEvent[] {
  if (r.fate === 'decline') return [];
  return [{ type: 'escape', at: r.at, project: r.project, ticket: r.ticket, source: r.source, summary: r.summary, gate: r.gate, sha: r.sha }];
}

const HANDLERS: { [K in Observation['kind']]?: (r: Of<K>, open: Open) => GateEvent[] } = {
  gate: gateRun,
  choice: (r, open) => (r.choice === 'override' && r.gate !== undefined ? falseAlarm(r, r.gate, 'override', open) : []),
  suppression: (r, open) => falseAlarm(r, r.gate, 'suppression', open),
  finding: escape,
};

/** What each record means for the gates, in log order. */
export function gateEvents(records: Observation[]): GateEvent[] {
  const open: Open = new Map();
  return records.flatMap((r) => (HANDLERS[r.kind] as ((r: Observation, open: Open) => GateEvent[]) | undefined)?.(r, open) ?? []);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const cost = (values: number[]) => ({ median: median(values), total: values.reduce((sum, v) => sum + v, 0) });

/** What an event counts as: a run by its verdict, anything else by its type. */
const countedAs = (e: GateEvent) => (e.type === 'run' ? e.verdict : e.type);

function counts(events: GateEvent[]): WeekCounts {
  const n = (what: string) => events.filter((e) => countedAs(e) === what).length;
  return { catches: n('catch'), escapes: n('escape'), falseAlarms: n('false-alarm'), couldNotRun: n('could-not-run') };
}

/** The events in the seven days that end `daysBack` days before now, the end included. */
function within(events: GateEvent[], now: string, daysBack: number): GateEvent[] {
  const end = Date.parse(now) - daysBack * DAY;
  return events.filter((e) => Date.parse(e.at) <= end && Date.parse(e.at) > end - 7 * DAY);
}

const ratio = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);

function rowOf(gate: string, project: string, events: GateEvent[], opts: { window: number; now: string }): GateRow {
  const runs = events.filter((e) => e.type === 'run');
  const fails = runs.filter((r) => r.verdict === 'fail').length;
  const all = counts(events);
  const tokens = runs.flatMap((r) => (r.tokens === undefined ? [] : [r.tokens]));
  const lastCatch = events.filter((e) => e.type === 'catch').at(-1)?.at;
  return {
    gate,
    project,
    runs: runs.length,
    fails,
    ...all,
    couldNotRunRate: ratio(all.couldNotRun, runs.length),
    falseAlarmRate: ratio(all.falseAlarms, Math.max(fails, all.falseAlarms)),
    dead: runs.length >= opts.window && !runs.slice(-opts.window).some((r) => r.verdict === 'fail'),
    lastCatch,
    ms: cost(runs.map((r) => r.ms)),
    ...(tokens.length === 0 ? {} : { tokens: cost(tokens) }),
    week: counts(within(events, opts.now, 0)),
    weekBefore: counts(within(events, opts.now, 7)),
  };
}

function rows(events: GateEvent[], perProject: boolean, opts: { window: number; now: string }): GateRow[] {
  const named = events.filter((e) => e.gate !== undefined) as (GateEvent & { gate: string })[];
  const keys = new Set(named.map((e) => JSON.stringify([e.gate, perProject ? e.project : ''])));
  return [...keys]
    .map((key) => JSON.parse(key) as [string, string])
    .sort(([g, p], [h, q]) => g.localeCompare(h) || p.localeCompare(q))
    .map(([gate, project]) => rowOf(gate, project, named.filter((e) => e.gate === gate && (project === '' || e.project === project)), opts));
}

/** Every gate's metrics from the observation log; `window` is the dead-gate window in runs. */
export function gateMetrics(records: Observation[], opts: { window: number; now: string }): GateMetrics {
  const events = gateEvents(records);
  const escapes = events.filter((e) => e.type === 'escape').map(({ type: _, ...e }) => e);
  return { gates: rows(events, false, opts), perProject: rows(events, true, opts), escapes };
}
