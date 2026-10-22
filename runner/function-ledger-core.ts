// The function ledger (ticket 15c): value and cost per function of the registry
// (config/functions.json), from the observation log over a window (since, now].
// Cost: a function's sessions' tokens priced by config/prices.json (a model no family names is
// listed as unpriced, never guessed), and wall time in minutes from its sessions, hook calls and
// gate runs. A hook's calls also give p50 and p95 (nearest rank); a hook whose p95 is above its
// threshold is flagged slow.
// Value, by kind:
// - gate: runs, catches, escapes, false alarms and could-not-run, as ticket 15b counts them.
// - hook: calls, and calls that blocked.
// - role: tickets it worked on (a review fix round is not a ticket), tickets whose first gate run
//   was all green, escalations (tickets it ended with a red gate run, which the Stop gate let end
//   after its blocks), fix rounds on tickets it worked on (review findings fixed), sessions.
//   The reviewer's value is the review funnel: raw findings, unique ones (same project, ticket,
//   file and claim), confirmed (unique, neither refuted nor declined), fixed, refuted by the
//   skeptic. The skeptic's: HIGH findings it checked and refuted.
// - substream: items read, ideas made, ideas the owner accepted on the briefing.
// - skill: sessions that loaded it, and how they ended.
// Zero guard (ECC's cost tracker wrote 2,340 zero rows unnoticed): a gate, hook or role that ran in
// each of its last N runs and recorded only zeros or nothing (wall time for gates and hooks, tokens
// for roles) is a Needs you item. Skills and substreams are not guarded: their zeros are real.

import { gateMetrics } from './gate-metrics-core.ts';
import type { Observation, SessionRecord } from './observations.ts';
import type { FunctionKind, WorkflowFunction } from './functions-core.ts';
import { priceUsd, rateFor, type PriceTable } from './prices-core.ts';

export interface LedgerOptions {
  since: string;
  now: string;
  prices: PriceTable;
  registry: WorkflowFunction[];
  /** Runs of only zeros or nothing before a function is a Needs you item. */
  zeroRuns: number;
  /** p95 in ms above which a hook is slow: `default`, or the hook's own. */
  hookP95Ms: Record<string, number>;
}

export interface LedgerCost {
  usd: number;
  /** Models no family in the price table names: their tokens are not in usd. */
  unpriced: string[];
  minutes: number;
  tokens: number;
  /** Cloud sessions whose run log reported no usage (ticket 27): not in usd or tokens, never zero. */
  unknown: number;
  calls: number;
  p50Ms?: number;
  p95Ms?: number;
}

export interface LedgerRow {
  id: string;
  kind: FunctionKind;
  name: string;
  value: Record<string, number>;
  cost: LedgerCost;
  slow: boolean;
}

export interface ZeroGuardItem {
  id: string;
  runs: number;
  metric: string;
}

export interface Ledger {
  since: string;
  now: string;
  prices: Pick<PriceTable, 'date' | 'source' | 'placeholder'>;
  rows: LedgerRow[];
  /** Function ids the window's records name that config/functions.json does not. */
  unregistered: string[];
  needs: ZeroGuardItem[];
}

type Of<K extends Observation['kind']> = Extract<Observation, { kind: K }>;
type Session = Observation & SessionRecord;

const MINUTE = 60_000;

const ofKind = <K extends Observation['kind']>(records: Observation[], kind: K) => records.filter((r): r is Of<K> => r.kind === kind);
const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);
const tokensOf = (s: SessionRecord) => s.tokensIn + s.tokensOut + s.cacheRead + s.cacheWrite;

/** The value at rank ceil(q * n) of the sorted values (nearest rank). */
export function percentile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(q * sorted.length) - 1];
}

/** The id each record's function goes by, or none. */
const ID_OF: { [K in Observation['kind']]?: (r: Of<K>) => string } = {
  gate: (r) => `gate:${r.gate}`,
  hook: (r) => `hook:${r.hook}`,
  session: (r) => r.fn,
  stream: (r) => `substream:${r.stream}`,
};

const idOf = (r: Observation) => (ID_OF[r.kind] as ((r: Observation) => string) | undefined)?.(r);

const costUnknown = (s: SessionRecord) => s.tokens === null;

function sessionCost(sessions: Session[], prices: PriceTable) {
  const known = sessions.filter((s) => !costUnknown(s));
  const priced = known.map((s) => ({ s, rates: rateFor(prices, s.model) }));
  return {
    usd: sum(priced.map(({ s, rates }) => (rates === undefined ? 0 : priceUsd(rates, s)))),
    unpriced: [...new Set(priced.filter((p) => p.rates === undefined).map((p) => p.s.model))],
    tokens: sum(known.map(tokensOf)),
    unknown: sessions.length - known.length,
  };
}

const hookTimes = (ms: number[]) => (ms.length === 0 ? {} : { p50Ms: percentile(ms, 0.5), p95Ms: percentile(ms, 0.95) });

/** The wall time of each call: a session, a hook call or a gate run. */
const callMs = (records: Observation[]) => records.flatMap((r) => (r.kind === 'session' || r.kind === 'hook' || r.kind === 'gate' ? [r.ms] : []));

function costOf(f: WorkflowFunction, mine: Observation[], prices: PriceTable): LedgerCost {
  const ms = callMs(mine);
  const times = f.kind === 'hook' ? hookTimes(ms) : {};
  return { ...sessionCost(ofKind(mine, 'session'), prices), minutes: sum(ms) / MINUTE, calls: ms.length, ...times };
}

const workKey = (project: string, ticket: string) => JSON.stringify([project, ticket]);

/** A ticket's gate runs by the role: one batch per moment, in log order. */
function batches(runs: Of<'gate'>[]): Of<'gate'>[][] {
  const at = [...new Set(runs.map((r) => r.at))];
  return at.map((a) => runs.filter((r) => r.at === a));
}

const green = (batch: Of<'gate'>[]) => batch.every((r) => r.verdict === 'pass');

function roleValue(name: string, records: Observation[]): Record<string, number> {
  const runs = ofKind(records, 'gate').filter((r) => r.role === name && !r.ticket.includes('-review-fix-'));
  const tickets = [...new Set(runs.map((r) => workKey(r.project, r.ticket)))].map((key) => batches(runs.filter((r) => workKey(r.project, r.ticket) === key)));
  const fixed = new Set(ofKind(records, 'finding').filter((f) => f.fate === 'fix').map((f) => workKey(f.project, `${f.project}-${f.ticket}-${name}`)));
  return {
    tickets: tickets.length,
    firstTry: tickets.filter((b) => green(b[0])).length,
    escalations: tickets.filter((b) => !green(b.at(-1) as Of<'gate'>[])).length,
    fixRounds: [...new Set(runs.map((r) => workKey(r.project, r.ticket)))].filter((key) => fixed.has(key)).length,
    sessions: ofKind(records, 'session').filter((s) => s.fn === `role:${name}`).length,
  };
}

const refuted = (f: Of<'finding'>) => f.reason.startsWith('refuted by the skeptic');
const claimOf = (f: Of<'finding'>) => JSON.stringify([f.project, f.ticket, f.file, f.summary.trim().toLowerCase()]);

function reviewerValue(records: Observation[]): Record<string, number> {
  const raw = ofKind(records, 'finding').filter((f) => f.role === 'review');
  const unique = [...new Set(raw.map(claimOf))].map((claim) => raw.filter((f) => claimOf(f) === claim));
  return {
    raw: raw.length,
    unique: unique.length,
    confirmed: unique.filter((same) => same.some((f) => f.fate !== 'decline')).length,
    fixed: unique.filter((same) => same.some((f) => f.reason.startsWith('fixed in round'))).length,
    refuted: unique.filter((same) => same.some(refuted)).length,
    sessions: ofKind(records, 'session').filter((s) => s.fn === 'role:reviewer').length,
  };
}

function skepticValue(records: Observation[]): Record<string, number> {
  const high = ofKind(records, 'finding').filter((f) => f.role === 'review' && f.severity === 'HIGH');
  return { checked: high.length, refuted: high.filter(refuted).length, sessions: ofKind(records, 'session').filter((s) => s.fn === 'role:skeptic').length };
}

const ROLES: Record<string, (records: Observation[]) => Record<string, number>> = { reviewer: reviewerValue, skeptic: skepticValue };

function gateValue(name: string, records: Observation[], now: string): Record<string, number> {
  const none = { runs: 0, catches: 0, escapes: 0, falseAlarms: 0, couldNotRun: 0 };
  // Stryker disable next-line ObjectLiteral: equivalent; only the counts are read, which neither the dead-gate window nor the week's end changes
  const g = gateMetrics(records, { window: Number.MAX_SAFE_INTEGER, now }).gates.find((r) => r.gate === name) ?? none;
  return { runs: g.runs, catches: g.catches, escapes: g.escapes, falseAlarms: g.falseAlarms, couldNotRun: g.couldNotRun };
}

function streamValue(name: string, records: Observation[]): Record<string, number> {
  const streams = ofKind(records, 'stream').filter((s) => s.stream === name);
  const prefix = `proposal/${name.replace(/[^\w.-]/g, '-')}-`;
  const accepted = ofKind(records, 'choice').filter((c) => c.itemKind === 'proposal' && c.choice === 'accept' && c.item.startsWith(prefix));
  return { items: sum(streams.map((s) => s.items)), ideas: sum(streams.map((s) => s.ideas)), accepted: accepted.length };
}

function skillValue(name: string, records: Observation[]): Record<string, number> {
  const loaded = ofKind(records, 'session').filter((s) => s.skills.includes(name));
  const ok = loaded.filter((s) => s.outcome === 'ok').length;
  return { loaded: loaded.length, ok, failed: loaded.length - ok };
}

const VALUE: Record<FunctionKind, (name: string, records: Observation[], now: string) => Record<string, number>> = {
  gate: gateValue,
  hook: (name, records) => {
    const calls = ofKind(records, 'hook').filter((h) => h.hook === name);
    return { calls: calls.length, blocks: calls.filter((h) => h.outcome === 'block').length };
  },
  role: (name, records) => (ROLES[name] ?? ((r: Observation[]) => roleValue(name, r)))(records),
  substream: streamValue,
  skill: skillValue,
};

/** Whether a p95 is above the hook's own threshold, or the default one. */
const tooSlow = (name: string, p95: number | undefined, limits: Record<string, number>) => (p95 ?? 0) > (limits[name] ?? limits.default);

function rowOf(f: WorkflowFunction, records: Observation[], opts: LedgerOptions): LedgerRow {
  const cost = costOf(f, records.filter((r) => idOf(r) === f.id), opts.prices);
  return { id: f.id, kind: f.kind, name: f.name, value: VALUE[f.kind](f.name, records, opts.now), cost, slow: tooSlow(f.name, cost.p95Ms, opts.hookP95Ms) };
}

/** Each hook of the registry whose p95 over the records is above its threshold. */
export function slowHooks(records: Observation[], registry: WorkflowFunction[], limits: Record<string, number>): { id: string; p95Ms: number }[] {
  return registry.filter((f) => f.kind === 'hook').flatMap((f) => {
    const times = hookTimes(callMs(records.filter((r) => idOf(r) === f.id)));
    return tooSlow(f.name, times.p95Ms, limits) ? [{ id: f.id, p95Ms: times.p95Ms as number }] : [];
  });
}

/** The functions the records name that the registry does not: a stale registry, or a check no project config names. */
function unregisteredOf(registry: WorkflowFunction[], records: Observation[]): string[] {
  const known = new Set(registry.map((f) => f.id));
  return [...new Set(records.flatMap((r) => idOf(r) ?? []))].filter((id) => !known.has(id));
}

const recorded = (s: SessionRecord) => (costUnknown(s) ? 1 : tokensOf(s));

// The zero guard: per function kind, the runs it ran in and what it recorded in each.
type Guard = { metric: string; ran: (f: WorkflowFunction, r: Observation) => boolean; amount: (f: WorkflowFunction, r: Observation) => number };

const GUARDS: Partial<Record<FunctionKind, Guard>> = {
  gate: { metric: 'wall time', ran: (f, r) => idOf(r) === f.id, amount: (f, r) => (idOf(r) === f.id ? (r as Of<'gate'>).ms : 0) },
  hook: { metric: 'wall time', ran: (_f, r) => r.kind === 'tool', amount: (f, r) => (idOf(r) === f.id ? (r as Of<'hook'>).ms : 0) },
  role: {
    metric: 'tokens',
    ran: (f, r) => ((r.kind === 'tool' || r.kind === 'gate') && r.role === f.name) || idOf(r) === f.id,
    // Only a session goes by a role's id; one whose cost is unknown recorded something, not zero.
    amount: (f, r) => (idOf(r) === f.id ? recorded(r as Session) : 0),
  },
};

function zeroRunsOf(f: WorkflowFunction, guard: Guard, records: Observation[], n: number): boolean {
  const runs = [...new Set(records.filter((r) => guard.ran(f, r)).map((r) => r.run))];
  const last = runs.slice(-n);
  return last.length === n && last.every((run) => sum(records.filter((r) => r.run === run).map((r) => guard.amount(f, r))) === 0);
}

/** Each guarded function that ran in its last n runs and recorded only zeros or nothing in them. */
export function zeroGuard(records: Observation[], registry: WorkflowFunction[], n: number): ZeroGuardItem[] {
  return registry.flatMap((f) => {
    const guard = GUARDS[f.kind];
    return guard !== undefined && zeroRunsOf(f, guard, records, n) ? [{ id: f.id, runs: n, metric: guard.metric }] : [];
  });
}

/** The records after since, up to and with now. */
export function inWindow(records: Observation[], since: string, now: string): Observation[] {
  return records.filter((r) => Date.parse(r.at) > Date.parse(since) && Date.parse(r.at) <= Date.parse(now));
}

export function functionLedger(records: Observation[], opts: LedgerOptions): Ledger {
  const window = inWindow(records, opts.since, opts.now);
  return {
    since: opts.since,
    now: opts.now,
    prices: { date: opts.prices.date, source: opts.prices.source, placeholder: opts.prices.placeholder },
    rows: opts.registry.map((f) => rowOf(f, window, opts)),
    unregistered: unregisteredOf(opts.registry, window),
    needs: zeroGuard(records, opts.registry, opts.zeroRuns),
  };
}
