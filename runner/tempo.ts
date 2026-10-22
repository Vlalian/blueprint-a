// Tempo stats and pacing (ticket 53): how long a cloud build and a merge take, from our own records,
// and how many builds to keep in flight so the merge gate is never idle and never queued deep.
// - Records (tempo-records.ts): a build from its routine's fire to the Result push on its branch; a
//   merge as its preparation (merge-prep) plus the stages of its local self-gate run (ticket 31's
//   `self-gate-<stage>` gate records, logged under the merged branch).
// - Averages: mean and range over the last 10 builds and the last 10 merges, and per ticket size
//   (S, M, L) where the ticket's Size line said it.
// - Pacing: builds in flight = ceil(average build / average merge), capped by config/tempo.json's
//   maxCloudBuilds (default 3), each start one average merge after the one before, so finished builds
//   reach the merge gate one at a time. Only file-disjoint tickets run at once: a ticket that names a
//   file a running or starting ticket names waits. Ticket 47's frontier (dependencies) is not on the
//   integration branch yet; sharedFiles is its own function so the two merge cleanly.
// Pure: records and texts in, numbers and plans out.

import { sessionBranch } from './ci-report.ts';
import type { Observation, ObservationBase } from './observations.ts';
import { SIZES, type Size } from './tempo-records.ts';

type Of<K extends Observation['kind']> = Extract<Observation, { kind: K }>;

/** Builds and merges the averages are taken over. */
export const WINDOW = 10;
export const DEFAULT_MAX_CLOUD_BUILDS = 3;

const ms = (iso: string) => Date.parse(iso);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const sized = (size: Size | undefined) => (size === undefined ? {} : { size });

/** The ticket a build branch is for: ticket/53-tempo-stats is ticket 53, docs/tickets/53-tempo-stats.md. */
export function ticketOfBranch(branch: string): { id: string; file: string } | undefined {
  const m = /^ticket\/((\d+[a-z]?)-[\w-]*\w)$/.exec(sessionBranch(branch));
  return m === null ? undefined : { id: m[2]!, file: `${m[1]}.md` };
}

/** The ticket's `Size:` line (S, M or L); none when it has none. */
export const sizeOf = (text: string | undefined) => /^Size:[ \t]*([SML])[ \t]*$/m.exec(String(text))?.[1] as Size | undefined;

/** The build of a branch from its latest fire before the Result push to that push; or why there is none. */
export function buildRecord(base: ObservationBase, branch: string, records: Observation[], resultAt: string, size: Size | undefined): { record: Observation } | { reason: string } {
  const name = sessionBranch(branch);
  const end = new Date(resultAt).toISOString();
  const ofBranch = <K extends 'fire' | 'build'>(kind: K) => records.filter((r): r is Of<K> => r.kind === kind && r.branch === name);
  if (ofBranch('build').some((b) => b.resultAt === end)) return { reason: `the build of ${name} up to ${end} is recorded already` };
  const fire = ofBranch('fire')
    .filter((f) => ms(f.at) <= ms(end))
    .at(-1);
  if (fire === undefined) return { reason: `no fire of ${name} is recorded before its Result push at ${end}` };
  return { record: { ...base, kind: 'build', branch: name, ...sized(size ?? fire.size), firedAt: fire.at, resultAt: end, ms: ms(end) - ms(fire.at) } };
}

export type Spread = { count: number; meanMs: number; minMs: number; maxMs: number };

/** Mean and range; none for no times. */
export function spread(times: number[]): Spread | undefined {
  if (times.length === 0) return undefined;
  return { count: times.length, meanMs: sum(times) / times.length, minMs: Math.min(...times), maxMs: Math.max(...times) };
}

export type Averages = { all: Spread | undefined; bySize: Partial<Record<Size, Spread>> };

/** Over the last WINDOW items (oldest first), and per size over that size's own last WINDOW. */
function averages(items: { ms: number; size?: Size }[]): Averages {
  const last = (of: typeof items) => spread(of.slice(-WINDOW).map((i) => i.ms));
  const bySize = SIZES.flatMap((s) => {
    const of = last(items.filter((i) => i.size === s));
    return of === undefined ? [] : [[s, of] as const];
  });
  return { all: last(items), bySize: Object.fromEntries(bySize) };
}

export type Merge = { branch: string; at: string; gateMs: number; prepMs: number; ms: number; size?: Size };

export const isMergeStage = (r: Observation): r is Of<'gate'> => r.kind === 'gate' && r.gate.startsWith('self-gate-') && r.placement !== 'cloud' && r.ticket !== '';

const byKind = <K extends Observation['kind']>(records: Observation[], kind: K) => records.filter((r): r is Of<K> => r.kind === kind);

/** The sizes the builds recorded, by branch. */
const sizesOf = (records: Observation[]) => new Map(byKind(records, 'build').map((b) => [b.branch, b.size]));

function mergeOf(stages: Of<'gate'>[], preps: Of<'merge-prep'>[], sizes: Map<string, Size | undefined>): Merge {
  const { ticket, at } = stages[0]!;
  const branch = sessionBranch(ticket);
  const gateMs = sum(stages.map((s) => s.ms));
  const prepMs = preps.filter((p) => p.branch === branch && ms(p.at) <= ms(at)).at(-1)?.ms ?? 0;
  return { branch, at, gateMs, prepMs, ms: gateMs + prepMs, ...sized(sizes.get(branch)) };
}

/** One merge per local self-gate run on a branch (its stages share the run's time), with the branch's latest preparation before it; oldest first. */
export function mergesOf(records: Observation[]): Merge[] {
  const runs = new Map<string, Of<'gate'>[]>();
  for (const r of records.filter(isMergeStage)) runs.set(`${r.ticket}\n${r.at}`, [...(runs.get(`${r.ticket}\n${r.at}`) ?? []), r]);
  const preps = byKind(records, 'merge-prep');
  const sizes = sizesOf(records);
  return [...runs.values()].map((stages) => mergeOf(stages, preps, sizes)).sort((a, b) => ms(a.at) - ms(b.at));
}

export type TempoStats = { build: Averages; merge: Averages; merges: Merge[] };

export function tempoStats(records: Observation[]): TempoStats {
  const builds = byKind(records, 'build').sort((a, b) => ms(a.resultAt) - ms(b.resultAt));
  const merges = mergesOf(records);
  return { build: averages(builds), merge: averages(merges), merges };
}

/** Builds to keep in flight and the time between two starts; one at a time, unstaggered, until both averages are known. */
export function tempoTarget(build: Spread | undefined, merge: Spread | undefined, cap: number): { target: number; staggerMs: number } {
  if (build === undefined || merge === undefined) return { target: 1, staggerMs: 0 };
  return { target: Math.min(cap, Math.max(1, Math.ceil(build.meanMs / merge.meanMs))), staggerMs: merge.meanMs };
}

/** config/tempo.json's maxCloudBuilds: a whole number of 1 or more, else the default. */
export function maxCloudBuilds(text: string | undefined): number {
  let value: unknown;
  try {
    value = Object(JSON.parse(text as string)).maxCloudBuilds;
  } catch {}
  return Number.isInteger(value) && (value as number) >= 1 ? (value as number) : DEFAULT_MAX_CLOUD_BUILDS;
}

export type Flight = { branch: string; firedAt: string };

/** The branches whose latest fire has no build record or merge of the branch at or after it. */
export function inFlight(records: Observation[]): Flight[] {
  const fires = new Map(byKind(records, 'fire').map((f) => [f.branch, f.at]));
  const ends = [...byKind(records, 'build'), ...records.filter(isMergeStage)].map((r) => ({ branch: sessionBranch('branch' in r ? r.branch : r.ticket), at: r.at }));
  return [...fires].filter(([branch, at]) => !ends.some((e) => e.branch === branch && ms(e.at) >= ms(at))).map(([branch, firedAt]) => ({ branch, firedAt }));
}

export const PATH = /`([\w.*()-]+(?:\/[\w.*()-]+)+)(?::[\d,-]+)?`/g;

/** The repo paths a ticket names in backticks (globs kept, line numbers dropped); docs/ is read, not built, so left out. */
export function ticketFiles(text: string): string[] {
  const paths = [...text.matchAll(PATH)].map((m) => m[1]!).filter((p) => !p.startsWith('docs/'));
  return [...new Set(paths)].sort();
}

/** A path or glob as a whole-path pattern: `*` within a folder, `**` across folders. */
export const globOf = (p: string) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('**', '\0').replaceAll('*', '[^/]*').replaceAll('\0', '.*')}$`);

/** The files of `a` that `b` touches too (the same path, or one's glob takes the other). */
export const sharedFiles = (a: string[], b: string[]) => a.filter((x) => b.some((y) => globOf(x).test(y) || globOf(y).test(x)));

export type Candidate = { ticket: string; files: string[] };
export type Plan = { starts: { ticket: string; at: string }[]; held: { ticket: string; with: string; files: string[] }[] };
type Pacing = { target: number; staggerMs: number; now: string; running: (Candidate & { firedAt: string })[]; ready: Candidate[] };

/** The first running or starting ticket that touches one of the candidate's files. */
function clashOf(c: Candidate, busy: Candidate[]): Plan['held'][number] | undefined {
  const clashes = busy.map((b) => ({ ticket: c.ticket, with: b.ticket, files: sharedFiles(c.files, b.files) }));
  return clashes.find((x) => x.files.length > 0);
}

/** Which ready tickets start, in order, while slots are free: each one stagger after the latest start; a ticket on a busy file waits. */
export function pace(p: Pacing): Plan {
  const plan: Plan = { starts: [], held: [] };
  const busy: Candidate[] = [...p.running];
  let next = Math.max(ms(p.now), ...p.running.map((r) => ms(r.firedAt) + p.staggerMs));
  for (const c of p.ready) {
    if (busy.length >= p.target) break;
    const clash = clashOf(c, busy);
    if (clash !== undefined) plan.held.push(clash);
    else {
      plan.starts.push({ ticket: c.ticket, at: new Date(next).toISOString() });
      busy.push(c);
      next += p.staggerMs;
    }
  }
  return plan;
}

/** The share of [since, now] no merge ran in; none for an empty window. */
export function idleShare(merges: Merge[], since: string, now: string): number | undefined {
  const [from, to] = [ms(since), ms(now)];
  if (to <= from) return undefined;
  const spans = merges.map((m) => [Math.max(from, ms(m.at) - m.ms), Math.min(to, ms(m.at))] as const).sort((a, b) => a[0] - b[0]);
  let busy = 0;
  let reached = from;
  for (const [start, end] of spans) {
    busy += Math.max(0, end - Math.max(start, reached));
    reached = Math.max(reached, end);
  }
  return 1 - busy / (to - from);
}
