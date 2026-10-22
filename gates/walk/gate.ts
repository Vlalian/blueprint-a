// The walk gate (ticket 23): the hard gate after a walk. It passes only when
// - the walk report passes the evidence gate's stricter schema (gates/evidence --walk): every item
//   cited, the media saved, the timestamps ascending;
// - the report is bound to the head and patch-id being judged (a rebase means a new walk);
// - every expected item is in it, and no acceptance criterion is left not-run (quarantine may
//   never drop one);
// - no exploratory item failed;
// - the pinned specs re-run green in the app's own Playwright, with 2 retries (ECC).
// A flag never fails it: flag items, console and page errors, 5xx responses and axe findings
// ("necessary, not sufficient") go to the owner on the briefing, as do quarantined specs with their
// issue. cli.ts wires in the files and the Playwright runner.

import { walkEvidenceGate, type EvidenceIo } from '../evidence/gate.ts';
import type { WalkReport } from '../evidence/walk-report.ts';
import type { GateResult } from '../lib/contract.ts';

export interface WalkGateOptions {
  report: string;
  head: string;
  patchId: string;
  /** The pinned specs to run: the walk's own and every QA entry's that is not quarantined. */
  specs: string[];
  /** The item ids the walk had to report: the ticket's criteria, the QA entries it ran and those it did not. */
  expect: { criteria: string[]; qa: string[]; notRun: string[] };
  quarantined: { id: string; issue: string }[];
}

export interface WalkGateIo extends EvidenceIo {
  /** The app's Playwright on the specs, with retries; whether they passed and its output. */
  runSpecs(specs: string[]): { passed: boolean; output: string };
}

export type WalkGateResult = GateResult & { problems: string[]; flags: string[] };

/** The pinned specs' run: the app's own runner, 2 retries, a trace on the first retry. */
export const playwrightArgs = (cli: string, specs: string[]) => [cli, 'test', ...specs, '--retries=2', '--trace=on-first-retry', '--reporter=line'];

const short = (s: string) => s.slice(0, 10);

/** What goes to the owner: flag items, console and page errors, 5xx responses, axe findings. */
export function flagsOf(r: WalkReport): string[] {
  return [
    ...r.items.filter((it) => it.status === 'flag').map((it) => `${it.id}: ${it.observed}`),
    ...r.extras.console.map((c) => `console error: ${c.text}`),
    ...r.extras.pageErrors.map((e) => `page error: ${e.text}`),
    ...r.extras.network5xx.map((n) => `network ${n.status}: ${n.url}`),
    ...r.extras.axe.map((a) => `axe ${a.rule} (${a.impact}): ${a.target}`),
  ];
}

function bindingProblems(r: WalkReport, o: WalkGateOptions): string[] {
  if (r.head === o.head && r.patchId === o.patchId) return [];
  return [`the walk is bound to ${short(r.head)} (patch-id ${short(r.patchId)}), not ${short(o.head)} (patch-id ${short(o.patchId)}): a new walk is needed`];
}

/**
 * Ticket 74: an expected criterion is one whatever the report labels it. It needs an item labelled
 * criterion, and no item with its id may be not-run, so relabelling it qa never skips the walk.
 */
function criterionProblems(r: WalkReport, o: WalkGateOptions): string[] {
  const present = o.expect.criteria.filter((id) => r.items.some((it) => it.id === id));
  const relabelled = present
    .filter((id) => !r.items.some((it) => it.id === id && it.source === 'criterion'))
    .map((id) => `the report has no criterion item ${id}: it labels ${id} ${r.items.find((it) => it.id === id)!.source}`);
  const isCriterion = (it: WalkReport['items'][number]) => it.source === 'criterion' || o.expect.criteria.includes(it.id);
  const dropped = r.items.filter((it) => isCriterion(it) && it.status === 'not-run').map((it) => `acceptance criterion ${it.id} must be walked, not not-run`);
  return [...relabelled, ...dropped];
}

function coverageProblems(r: WalkReport, o: WalkGateOptions): string[] {
  const ids = r.items.map((it) => it.id);
  const missing = [...o.expect.criteria, ...o.expect.qa, ...o.expect.notRun].filter((id) => !ids.includes(id)).map((id) => `the report has no item ${id}`);
  return [...missing, ...criterionProblems(r, o)];
}

const failures = (r: WalkReport) => r.items.filter((it) => it.status === 'fail').map((it) => `${it.id} failed: ${it.observed}`);

function specProblems(o: WalkGateOptions, io: WalkGateIo): string[] {
  if (o.specs.length === 0) return ['no pinned spec to run: the walk is not pinned'];
  const run = io.runSpecs(o.specs);
  return run.passed ? [] : [`the pinned specs failed after 2 retries: ${run.output.slice(-1500)}`];
}

export function walkGate(o: WalkGateOptions, io: WalkGateIo): WalkGateResult {
  if (!o.report) throw new Error('usage: walk --report <report.json> --head <sha> --patch-id <id> --spec <file>... [--criterion <id>]... [--qa <id>]... [--not-run <id>]... [--repo <dir>]');
  const evidence = walkEvidenceGate({ walk: o.report }, io);
  if (!evidence.pass) return { gate: 'walk', pass: false, report: o.report, problems: evidence.problems, flags: [] };
  const r = JSON.parse(io.read(o.report)) as WalkReport;
  const problems = [...bindingProblems(r, o), ...coverageProblems(r, o), ...failures(r), ...specProblems(o, io)];
  const flags = [...flagsOf(r), ...o.quarantined.map((q) => `${q.id} is quarantined: ${q.issue}`)];
  return { gate: 'walk', pass: problems.length === 0, report: o.report, problems, flags };
}

/** The CLI's parsed arguments as the gate's options. */
export function gateOptions(v: Record<string, string | string[] | undefined>): WalkGateOptions {
  const many = (k: string) => (v[k] ?? []) as string[];
  return {
    report: (v.report ?? '') as string,
    head: (v.head ?? '') as string,
    patchId: (v['patch-id'] ?? '') as string,
    specs: many('spec'),
    expect: { criteria: many('criterion'), qa: many('qa'), notRun: many('not-run') },
    quarantined: many('quarantined').map((q) => ({ id: q.slice(0, q.indexOf('=')), issue: q.slice(q.indexOf('=') + 1) })),
  };
}

/** A finished Playwright run: passed on exit 0. */
export const specRun = (r: { status: number | null; stdout: string; stderr: string }) => ({ passed: r.status === 0, output: `${r.stdout}${r.stderr}` });
