// The evaluation report (ticket 15c): the function ledger over a window, one table per kind with
// each function's value, cost in USD and minutes, the trend since the last evaluation and a
// suggestion: keep, tune, merge or remove. The suggestion is rule-based on config/evaluation.json's
// thresholds, first rule that holds:
// 1. tune: the zero guard put it in Needs you (only zeros or nothing recorded while it ran);
// 2. keep: it did not run in the window, so there is nothing to judge;
// 3. by kind:
//    - gate: merge when another gate caught every one of its catches (the same fail moment);
//      remove when it caught nothing and cost at least the remove threshold in minutes or USD;
//      tune when false alarms or could-not-run per run are above their thresholds; else keep.
//    - hook: tune when its p95 is above its threshold (slow); else keep.
//    - role: tune when it passed first try on too few of its tickets, or (the reviewers) too few
//      unique findings were confirmed; else keep.
//    - substream: remove when it read at least the threshold of items and none of its ideas was
//      accepted; else keep.
//    - skill: tune when too many of the sessions that loaded it failed; else keep.
// Value and cost are shown in local and cloud columns (ticket 27): records carried back from a
// cloud session (`placement: "cloud"`) against those made on this PC, and a cloud session whose
// run log reported no usage is counted as "cost unknown", never as zero; the suggestion reads the
// totals. The evaluator's own row is marked self-assessment. A model may word the summary between the
// summary markers; every number is written here, and the dispatcher puts this text back outside
// the markers (dispatcher/evaluator.ts). Every suggestion other than keep becomes a lesson waiting
// on the briefing (tier 2): nothing is added, tuned, merged or removed until the owner accepts it.

import { lessonOfFile, type Lesson } from './learn.ts';
import { parseObservations, type Observation } from '../runner/observations.ts';
import { parseEvaluationConfig, type EvaluationConfig } from './evaluation-config.ts';
import { functionLedger, inWindow, type Ledger, type LedgerCost, type LedgerRow } from '../runner/function-ledger-core.ts';
import { parseRegistry, type FunctionKind, type WorkflowFunction } from '../runner/functions-core.ts';
import { gateEvents } from '../runner/gate-metrics-core.ts';
import type { LessonIo } from './gate-lessons-core.ts';
import { parsePrices, type PriceTable } from '../runner/prices-core.ts';

export type SuggestionWord = 'keep' | 'tune' | 'merge' | 'remove';

/** A function's value and cost from the records of one placement: this PC, or the cloud (ticket 27). */
export interface Split {
  value: Record<string, number>;
  cost: LedgerCost;
}

export interface EvaluatedRow extends LedgerRow {
  suggestion: SuggestionWord;
  reason: string;
  selfAssessment: boolean;
  trend: string;
  local: Split;
  cloud: Split;
}

export interface Evaluation {
  date: string;
  sinceLabel: string;
  ledger: Ledger;
  rows: EvaluatedRow[];
  markdown: string;
  json: string;
}

export interface EvaluationInput {
  records: Observation[];
  registry: WorkflowFunction[];
  prices: PriceTable;
  config: EvaluationConfig;
  since: string;
  /** What --since named (a ref or a time), for the report. */
  sinceLabel: string;
  now: string;
  /** The last evaluation's JSON, when there is one. */
  previous?: string;
}

export const SELF = 'role:evaluator';
export const SUMMARY_START = '<!-- summary -->';
export const SUMMARY_END = '<!-- /summary -->';

type Context = { config: EvaluationConfig; zero: Set<string>; mergeInto: Map<string, string> };
type Rule = (r: LedgerRow, c: Context) => [SuggestionWord, string] | undefined;

const usd = (n: number) => `$${n.toFixed(2)}`;
const min = (n: number) => `${n.toFixed(1)} min`;
const of = (part: number, whole: number) => `${part} of ${whole}`;
// 0 of 0 is NaN, which crosses no threshold: nothing to judge.
const ratio = (part: number, whole: number) => part / whole;

type Said = [SuggestionWord, string] | undefined;
const spent = (cost: LedgerCost) => `${min(cost.minutes)} and ${usd(cost.usd)} over the window`;

/** A gate's rules after merge, first that holds; keep when none does. */
const GATE_RULES: ((r: LedgerRow, t: EvaluationConfig) => Said)[] = [
  ({ value: v, cost }, t) => {
    const costly = cost.minutes >= t.gateRemoveAtMinutes || cost.usd >= t.gateRemoveAtUsd;
    return v.catches === 0 && costly ? ['remove', `no catch in ${v.runs} runs, at ${spent(cost)} (remove at ${t.gateRemoveAtMinutes} min or ${usd(t.gateRemoveAtUsd)})`] : undefined;
  },
  ({ value: v }, t) => (ratio(v.falseAlarms, v.runs) > t.gateTuneAboveFalseAlarmRate ? ['tune', `${of(v.falseAlarms, v.runs)} runs were false alarms (above ${t.gateTuneAboveFalseAlarmRate})`] : undefined),
  ({ value: v }, t) => (ratio(v.couldNotRun, v.runs) > t.gateTuneAboveCouldNotRunRate ? ['tune', `${of(v.couldNotRun, v.runs)} runs could not run (above ${t.gateTuneAboveCouldNotRunRate})`] : undefined),
  (r) => ['keep', r.value.catches > 0 ? `caught ${r.value.catches}` : `no catch in ${r.value.runs} runs, but cheap: ${spent(r.cost)}`],
];

function gateRule(r: LedgerRow, c: Context): [SuggestionWord, string] {
  const into = c.mergeInto.get(r.id);
  if (into !== undefined) return ['merge', `every catch (${r.value.catches}) was also caught by ${into}`];
  return GATE_RULES.map((rule) => rule(r, c.config)).find((s) => s !== undefined) as [SuggestionWord, string];
}

function hookRule(r: LedgerRow): [SuggestionWord, string] {
  const p95 = `p95 ${r.cost.p95Ms} ms`;
  return r.slow ? ['tune', `${p95} is above its threshold`] : ['keep', p95];
}

const ROLE_RULES: Record<string, (r: LedgerRow, c: Context) => [SuggestionWord, string]> = {
  reviewer: ({ value: v }, c) => {
    const said = `confirmed ${of(v.confirmed, v.unique)} unique findings (${v.raw} raw, ${v.fixed} fixed, ${v.refuted} refuted)`;
    return ratio(v.confirmed, v.unique) < c.config.reviewerTuneBelowConfirmedRate ? ['tune', `${said}, below ${c.config.reviewerTuneBelowConfirmedRate}`] : ['keep', said];
  },
  skeptic: ({ value: v }) => ['keep', `refuted ${of(v.refuted, v.checked)} HIGH findings`],
};

function roleRule(r: LedgerRow, c: Context): [SuggestionWord, string] {
  const own = ROLE_RULES[r.name];
  if (own !== undefined) return own(r, c);
  const v = r.value;
  if (v.tickets === 0) return ['keep', `${v.sessions} sessions, no ticket to judge`];
  const said = `passed first try on ${of(v.firstTry, v.tickets)} tickets, ${v.escalations} escalated, ${v.fixRounds} fix rounds`;
  return ratio(v.firstTry, v.tickets) < c.config.roleTuneBelowFirstTryRate ? ['tune', `${said}, below ${c.config.roleTuneBelowFirstTryRate}`] : ['keep', said];
}

function substreamRule({ value: v }: LedgerRow, c: Context): [SuggestionWord, string] {
  const said = `${of(v.accepted, v.ideas)} ideas accepted from ${v.items} items read`;
  return v.accepted === 0 && v.items >= c.config.substreamRemoveAtItems ? ['remove', said] : ['keep', said];
}

function skillRule({ value: v }: LedgerRow, c: Context): [SuggestionWord, string] {
  const said = `${of(v.failed, v.loaded)} sessions that loaded it failed`;
  return ratio(v.failed, v.loaded) > c.config.skillTuneAboveFailedRate ? ['tune', `${said}, above ${c.config.skillTuneAboveFailedRate}`] : ['keep', said];
}

const BY_KIND: Record<FunctionKind, (r: LedgerRow, c: Context) => [SuggestionWord, string]> = {
  gate: gateRule,
  hook: hookRule,
  role: roleRule,
  substream: substreamRule,
  skill: skillRule,
};

// Every kind counts its calls in its value (runs, calls, sessions), so all zeros means it did not run.
const idle = (r: Pick<LedgerRow, 'value'>) => Object.values(r.value).every((n) => n === 0);

const RULES: Rule[] = [
  (r, c) => (c.zero.has(r.id) ? ['tune', `recorded only zeros or nothing in its last ${c.config.zeroGuardRuns} runs; fix its recording first`] : undefined),
  (r) => (idle(r) ? ['keep', 'did not run in this window'] : undefined),
  (r, c) => BY_KIND[r.kind](r, c),
];

/** The rule-based suggestion for one row. */
export function suggest(r: LedgerRow, c: Context): [SuggestionWord, string] {
  return RULES.map((rule) => rule(r, c)).find((s) => s !== undefined) as [SuggestionWord, string];
}

/** Each gate whose every catch another gate also caught: the gate it could merge into (the one with more catches, or the first by name). */
export function mergeTargets(records: Observation[]): Map<string, string> {
  const caught = new Map<string, Set<string>>();
  for (const e of gateEvents(records)) {
    if (e.type === 'catch') caught.set(`gate:${e.gate}`, (caught.get(`gate:${e.gate}`) ?? new Set()).add(JSON.stringify([e.project, e.at])));
  }
  const covers = (a: Set<string>, b: Set<string>) => [...b].every((k) => a.has(k));
  const targets = [...caught].flatMap(([id, mine]) => {
    const into = [...caught].find(([other, theirs]) => covers(theirs, mine) && (theirs.size > mine.size || other < id));
    return into === undefined ? [] : [[id, into[0]] as [string, string]];
  });
  return new Map(targets);
}

type PreviousRow = { id: string; value: Record<string, number>; usd: number; minutes: number };

/** The last evaluation's row for a function, from its JSON; none when there is no readable one. */
function previousOf(text: string | undefined): (id: string) => PreviousRow | undefined {
  try {
    const rows = (JSON.parse(text as string) as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return (id) => (rows as PreviousRow[]).find((p) => p.id === id);
  } catch {}
  return () => undefined;
}

const words = (key: string) => key.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);

/** What moved since the last evaluation, as before → now; `new` when the last one did not have it. */
export function trendOf(r: LedgerRow, previous: PreviousRow | undefined): string {
  if (previous === undefined) return 'new';
  const moved = Object.entries(r.value).filter(([k, n]) => (previous.value[k] ?? 0) !== n).map(([k, n]) => `${words(k)} ${previous.value[k] ?? 0} → ${n}`);
  const cost: [string, string, string][] = [
    ['USD', usd(previous.usd), usd(r.cost.usd)],
    ['minutes', previous.minutes.toFixed(1), r.cost.minutes.toFixed(1)],
  ];
  const all = [...moved, ...cost.filter(([, a, b]) => a !== b).map(([what, a, b]) => `${what} ${a} → ${b}`)];
  return all.length === 0 ? 'no change' : all.join(', ');
}

const cell = (text: string) => text.replace(/\|/g, '\\|');

function valueCell(r: Split, slow: boolean): string {
  const value = Object.entries(r.value).map(([k, n]) => `${words(k)} ${n}`).join(', ');
  const times = r.cost.p95Ms === undefined ? '' : `; p50 ${r.cost.p50Ms} ms, p95 ${r.cost.p95Ms} ms${slow ? ' (slow)' : ''}`;
  return `${value}${times}`;
}

/** A placement's value; `-` where the function did not run there. */
const splitValue = (s: Split, slow: boolean) => (idle(s) ? '-' : valueCell(s, slow));

const unknownCost = (n: number) => (n === 0 ? '' : ` + cost unknown for ${n} session${n === 1 ? '' : 's'}`);

const usdCell = ({ cost }: Split) => `${usd(cost.usd)}${cost.unpriced.length === 0 ? '' : ` + unpriced ${cost.unpriced.join(', ')}`}${unknownCost(cost.unknown)}`;

function tableRow(r: EvaluatedRow): string {
  const name = r.selfAssessment ? `${r.id} (self-assessment)` : r.id;
  const values = [splitValue(r.local, r.slow), splitValue(r.cloud, r.slow)];
  const costs = [usdCell(r.local), usdCell(r.cloud), r.local.cost.minutes.toFixed(1), r.cloud.cost.minutes.toFixed(1)];
  const cells = [name, ...values, ...costs, r.trend, `**${r.suggestion}**: ${r.reason}`];
  return `| ${cells.map(cell).join(' | ')} |`;
}

const TABLE_HEAD = '| Function | Value local | Value cloud | USD local | USD cloud | Minutes local | Minutes cloud | Since last evaluation | Suggestion |';

const HEADINGS: [FunctionKind, string][] = [
  ['gate', 'Gates'],
  ['hook', 'Hooks'],
  ['role', 'Roles'],
  ['substream', 'Input substreams'],
  ['skill', 'Skills'],
];

function tables(rows: EvaluatedRow[]): string[] {
  return HEADINGS.flatMap(([kind, heading]) => {
    const mine = rows.filter((r) => r.kind === kind);
    if (mine.length === 0) return [];
    return [`## ${heading}`, '', TABLE_HEAD, `|${'---|'.repeat(9)}`, ...mine.map(tableRow), ''];
  });
}

const SHOWN = 3;

function unregisteredLine(ids: string[]): string[] {
  if (ids.length === 0) return [];
  const named = ids.slice(0, SHOWN).map((id) => `**${id}**`);
  const more = ids.length > SHOWN ? `${named.join(', ')} and ${ids.length - SHOWN} more` : named.join(', ');
  return [`- ${more} ran but config/functions.json does not list them: run \`node scripts/functions.ts --write\`, or they have no row here.`];
}

function needsLines(ledger: Ledger): string[] {
  const zero = ledger.needs.map((n) => `- **${n.id}** ran in its last ${n.runs} runs and recorded only zeros or nothing (${n.metric}). Fix its recording before trusting its numbers.`);
  const lines = [...zero, ...unregisteredLine(ledger.unregistered)];
  return lines.length === 0 ? ['Nothing needs you.', ''] : [...lines, ''];
}

function pricesLine(ledger: Ledger): string {
  const p = ledger.prices;
  const line = `Prices: config/prices.json, ${p.date}, ${p.source}.`;
  return p.placeholder ? `${line} **Placeholder rates: every USD figure here is a placeholder.**` : line;
}

function markdownOf(e: Omit<Evaluation, 'markdown' | 'json'>): string {
  return [
    `# Evaluation ${e.date}`,
    '',
    `Window: after ${e.ledger.since} (--since ${e.sinceLabel}) up to ${e.ledger.now}. Every number below is from \`node scripts/evaluate.ts\`; the summary is worded by the evaluator agent and holds no number of its own.`,
    '',
    pricesLine(e.ledger),
    '',
    '## Summary',
    '',
    SUMMARY_START,
    'No summary yet: the evaluator agent writes it.',
    SUMMARY_END,
    '',
    '## Needs you',
    '',
    ...needsLines(e.ledger),
    ...tables(e.rows),
  ].join('\n');
}

function jsonOf(e: Omit<Evaluation, 'markdown' | 'json'>): string {
  const split = (s: Split) => ({ value: s.value, ...s.cost });
  const rows = e.rows.map((r) => ({
    ...{ id: r.id, kind: r.kind, value: r.value, ...r.cost, slow: r.slow, suggestion: r.suggestion, reason: r.reason, selfAssessment: r.selfAssessment, trend: r.trend },
    ...{ local: split(r.local), cloud: split(r.cloud) },
  }));
  return `${JSON.stringify({ date: e.date, since: e.ledger.since, sinceLabel: e.sinceLabel, now: e.ledger.now, prices: e.ledger.prices, needs: e.ledger.needs, rows }, null, 2)}\n`;
}

export function evaluate(input: EvaluationInput): Evaluation {
  const { config } = input;
  const opts = { ...input, zeroRuns: config.zeroGuardRuns, hookP95Ms: config.hookP95Ms };
  const ledger = functionLedger(input.records, opts);
  const [local, cloud] = [false, true].map((inCloud) => functionLedger(input.records.filter((r) => (r.placement === 'cloud') === inCloud), opts).rows);
  const context: Context = { config, zero: new Set(ledger.needs.map((n) => n.id)), mergeInto: mergeTargets(inWindow(input.records, input.since, input.now)) };
  const before = previousOf(input.previous);
  const rows = ledger.rows.map((r, i): EvaluatedRow => {
    const [suggestion, reason] = suggest(r, context);
    const split = { local: { value: local[i].value, cost: local[i].cost }, cloud: { value: cloud[i].value, cost: cloud[i].cost } };
    return { ...r, suggestion, reason, selfAssessment: r.id === SELF, trend: trendOf(r, before(r.id)), ...split };
  });
  const e = { date: input.now.slice(0, 10), sinceLabel: input.sinceLabel, ledger, rows };
  return { ...e, markdown: markdownOf(e), json: jsonOf(e) };
}

const slug = (id: string) => id.replace(/[^\w-]/g, '-');

/** A suggestion as a lesson for the learning loop; a ticket draft when accepted, since every function is code. */
export function suggestionLesson(r: EvaluatedRow, date: string): Lesson {
  const self = r.selfAssessment ? '(self-assessment) ' : '';
  return {
    project: '',
    seen: { summary: `${self}${r.id}: ${r.reason}.`, count: Math.max(1, r.cost.calls), examples: [`evaluation ${date}: ${valueCell(r, r.slow)}; ${usdCell(r)}, ${min(r.cost.minutes)}`] },
    change: `${r.suggestion[0].toUpperCase()}${r.suggestion.slice(1)} ${r.id}, as the evaluation of ${date} suggests (docs/evaluations/${date}.md). Suggested change: ${r.suggestion}.`,
    destination: 'gate',
  };
}

/** Files each suggestion other than keep as a waiting lesson, once per function and suggestion per day and never while one waits; returns the new ids. */
export function fileSuggestionLessons(e: Evaluation, run: string, io: LessonIo): string[] {
  const pending = io.pendingIds();
  return e.rows.flatMap((r) => {
    if (r.suggestion === 'keep') return [];
    const prefix = `lesson/eval-${slug(r.id)}-${r.suggestion}-`;
    const id = `${prefix}${e.date}.json`;
    if (io.exists(id) || pending.some((p) => p.startsWith(prefix))) return [];
    io.fileLesson(id, lessonOfFile(suggestionLesson(r, e.date), run));
    return [id];
  });
}

export interface ReportTexts {
  observations: string | undefined;
  registry: string | undefined;
  prices: string | undefined;
  config: string | undefined;
  previous: string | undefined;
}

function parsed(texts: ReportTexts): Pick<EvaluationInput, 'records' | 'registry' | 'prices' | 'config' | 'previous'> {
  const prices = parsePrices(String(texts.prices));
  if (!prices.ok) throw new Error(prices.error);
  const config = parseEvaluationConfig(String(texts.config));
  if (!config.ok) throw new Error(config.error);
  return { records: parseObservations(texts.observations), registry: parseRegistry(String(texts.registry)), prices: prices.table, config: config.config, previous: texts.previous };
}

/** What scripts/evaluate writes: docs/evaluations/<date>.md and .json; exit 2, nothing written, when a config cannot be read or since is no time. */
export function evaluationReport(texts: ReportTexts, window: { since: string; sinceLabel: string; now: string }) {
  try {
    if (Number.isNaN(Date.parse(window.since))) throw new Error(`--since ${window.sinceLabel} is neither a time nor a commit`);
    const e = evaluate({ ...parsed(texts), ...window });
    const files: [string, string][] = [
      [`docs/evaluations/${e.date}.md`, e.markdown],
      [`docs/evaluations/${e.date}.json`, e.json],
    ];
    return { exitCode: 0, stdout: `${files.map(([path]) => path).join('\n')}\n`, stderr: '', files, evaluation: e };
  } catch (error) {
    return { exitCode: 2, stdout: '', stderr: `${(error as Error).message}\n`, files: [], evaluation: undefined };
  }
}

/** --since as a time: the commit's time when git named one (`git log -1 --format=%cI`), else the text itself, which the report refuses when it is no time either. */
export function sinceTime(raw: string, commit: { status: number | null; stdout: string }): string {
  const time = commit.stdout.trim();
  return commit.status === 0 && time !== '' ? new Date(time).toISOString() : raw;
}

/** The text of the newest evaluation JSON before the date (any date when none is given), read by its file name; undefined when there is none. */
export function evaluationBefore(names: string[], read: (name: string) => string | undefined, date = '9999-12-31'): string | undefined {
  const name = previousEvaluation(names, date);
  return name === undefined ? undefined : read(name);
}

/** The newest evaluation JSON among docs/evaluations' file names, before the given date. */
export function previousEvaluation(names: string[], date: string): string | undefined {
  return names.filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n) && n < `${date}.json`).sort().at(-1);
}
