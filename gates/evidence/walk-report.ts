// The walk report (ticket 23): what the walker agent writes after walking the app, in the shape of
// product-engineering's pe-verify report.json but stricter. Every item it marks pass, fail or flag
// cites a video timestamp or a screenshot; an item it did not run says why. The cited media must
// exist and the video timestamps ascend through the items (pe's validator rules), and nothing in
// the report may show an email address (screenshots blur them). Checked by the evidence gate
// (gate.ts walkEvidenceGate) and by gates/walk.
//   { "kind": "ticket" | "staging", "ticket": <id or "staging">, "url": the URL walked,
//     "head": the 40-hex commit walked, "patchId": its change's `git patch-id --stable`,
//     "startedAt": ISO, "viewport": "1280x800", "video": the context video,
//     "stills": 3 to 6 checkpoint screenshots,
//     "items": [{ "id", "source": "criterion" | "qa", "claim", "status": "pass" | "fail" | "flag" | "not-run",
//                 "observed", "evidence": [{ "screenshot": <path> } | { "video": <the video>, "at": <seconds> }],
//                 "reason" (not-run only) }],
//     "extras": { "console": [{ "text" }], "pageErrors": [{ "text" }],
//                 "network5xx": [{ "url", "status" }], "axe": [{ "rule", "impact", "target" }] } }

import { evidenceKind } from './report.ts';

export type WalkStatus = 'pass' | 'fail' | 'flag' | 'not-run';

export type Citation = { screenshot: string } | { video: string; at: number };

export interface WalkItem {
  id: string;
  source: 'criterion' | 'qa';
  claim: string;
  status: WalkStatus;
  observed?: string;
  evidence?: Citation[];
  reason?: string;
}

export interface WalkExtras {
  console: { text: string }[];
  pageErrors: { text: string }[];
  network5xx: { url: string; status: number }[];
  axe: { rule: string; impact: string; target: string }[];
}

export interface WalkReport {
  kind: 'ticket' | 'staging';
  ticket: string;
  url: string;
  head: string;
  patchId: string;
  startedAt: string;
  viewport: string;
  video: string;
  stills: string[];
  items: WalkItem[];
  extras: WalkExtras;
}

export const VIEWPORT = '1280x800';
export const STATUSES: WalkStatus[] = ['pass', 'fail', 'flag', 'not-run'];

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown) => typeof v === 'string' && v.trim() !== '';
const hex40 = (v: unknown) => /^[0-9a-f]{40}$/.test(v as string);
const inRepo = (v: unknown) => typeof v === 'string' && !/^\/|[:\\]/.test(v) && !v.split('/').includes('..');
const image = (v: unknown) => inRepo(v) && evidenceKind(v as string) === 'screenshot';
const video = (v: unknown) => inRepo(v) && /\.(webm|mp4)$/.test(v as string);
const httpUrl = (v: unknown) => /^https?:\/\/[^/\s]/.test(v as string);
const EXTRAS = ['console', 'pageErrors', 'network5xx', 'axe'];

const FIELDS: [keyof WalkReport, (v: unknown) => boolean, string][] = [
  ['kind', (v) => v === 'ticket' || v === 'staging', 'kind must be ticket or staging'],
  ['ticket', text, 'ticket must name the ticket (or staging)'],
  ['url', httpUrl, 'url must be the http(s) URL walked'],
  ['head', hex40, 'head must be the 40-hex commit walked'],
  ['patchId', hex40, 'patchId must be the 40-hex git patch-id of the change walked'],
  ['startedAt', (v) => /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v as string) && !Number.isNaN(Date.parse(v as string)), 'startedAt must be an ISO date and time'],
  ['viewport', (v) => v === VIEWPORT, `viewport must be ${VIEWPORT}`],
  ['video', video, 'video must be the repo-relative path of the context video (.webm, .mp4)'],
  ['stills', (v) => Array.isArray(v) && v.length >= 3 && v.length <= 6 && v.every(image), 'stills must list 3 to 6 checkpoint screenshots (.png, .jpg, .jpeg, .webp)'],
  ['items', (v) => Array.isArray(v) && v.length > 0, 'items must list at least one item'],
  ['extras', (v) => isObject(v) && EXTRAS.every((k) => Array.isArray(v[k])), 'extras must have console, pageErrors, network5xx and axe lists'],
];
const NAMES: string[] = FIELDS.map(([f]) => f);
const ITEM_FIELDS = ['id', 'source', 'claim', 'status', 'observed', 'evidence', 'reason'];

const isCitation = (c: unknown, videoPath: string) => isObject(c) && (image(c.screenshot) || (c.video === videoPath && typeof c.at === 'number' && c.at >= 0));

/** What a run status needs beyond the shape: pass, fail and flag cite evidence; not-run gives a reason. */
function statusProblems(it: Raw, name: string, videoPath: string): string[] {
  if (it.status === 'not-run') return text(it.reason) ? [] : [`${name} is not-run without a reason`];
  const cites = Array.isArray(it.evidence) ? it.evidence : [];
  const bad = cites.flatMap((c, i) => (isCitation(c, videoPath) ? [] : [`${name} citation ${i + 1} is not { "screenshot": <image path> } or { "video": "${videoPath}", "at": <seconds> }`]));
  return [
    ...(text(it.observed) ? [] : [`${name} must say what was observed`]),
    ...(cites.length === 0 ? [`${name} (${it.status}) cites no video timestamp or screenshot`] : bad),
  ];
}

const ITEM_CHECKS: [(it: Raw) => boolean, string][] = [
  [(it) => text(it.id), 'needs an id'],
  [(it) => it.source === 'criterion' || it.source === 'qa', 'source must be criterion or qa'],
  [(it) => text(it.claim), 'needs its claim'],
  [(it) => STATUSES.includes(it.status as WalkStatus), 'status must be pass, fail, flag or not-run'],
];

function itemProblems(v: unknown, i: number, videoPath: string): string[] {
  if (!isObject(v)) return [`item ${i + 1} is not an object`];
  const name = `item ${text(v.id) ? v.id : i + 1}`;
  const shape = ITEM_CHECKS.filter(([holds]) => !holds(v)).map(([, problem]) => `${name} ${problem}`);
  const unknown = Object.keys(v).filter((k) => !ITEM_FIELDS.includes(k)).map((k) => `${name} has an unknown field "${k}"`);
  return [...shape, ...(shape.length === 0 ? statusProblems(v, name, videoPath) : []), ...unknown];
}

function duplicates(items: unknown[]): string[] {
  const ids = items.map((it) => (isObject(it) ? it.id : undefined)).filter(text) as string[];
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))].map((id) => `item id ${id} is used twice`);
}

const EXTRA_SHAPES: Record<string, [(e: Raw) => boolean, string]> = {
  console: [(e) => text(e.text), '{ "text": <message> }'],
  pageErrors: [(e) => text(e.text), '{ "text": <message> }'],
  network5xx: [(e) => text(e.url) && Number.isInteger(e.status) && (e.status as number) >= 500 && (e.status as number) <= 599, '{ "url": <url>, "status": 500-599 }'],
  axe: [(e) => text(e.rule) && text(e.impact) && text(e.target), '{ "rule": <axe rule>, "impact": <impact>, "target": <selector> }'],
};

function extrasProblems(extras: Raw): string[] {
  return EXTRAS.flatMap((k) => {
    const [holds, shape] = EXTRA_SHAPES[k];
    return (extras[k] as unknown[]).flatMap((e, i) => (isObject(e) && holds(e) ? [] : [`extras.${k} ${i + 1} is not ${shape}`]));
  });
}

const citations = (r: WalkReport) => r.items.flatMap((it) => (it.evidence ?? []).map((c) => ({ id: it.id, c })));

function mediaProblems(r: WalkReport, exists: (path: string) => boolean): string[] {
  const shots = citations(r).flatMap(({ c }) => ('screenshot' in c ? [c.screenshot] : []));
  return [...new Set([r.video, ...r.stills, ...shots])].filter((p) => !exists(p)).map((p) => `the media file ${p} does not exist`);
}

function timestampProblems(r: WalkReport): string[] {
  let last = 0;
  return citations(r).flatMap(({ id, c }) => {
    if (!('at' in c)) return [];
    const back = c.at < last ? [`video timestamps must ascend: item ${id} cites ${c.at} s after ${last} s`] : [];
    last = Math.max(last, c.at);
    return back;
  });
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

function emailProblems(r: WalkReport): string[] {
  const hit = EMAIL.exec(JSON.stringify(r));
  return hit === null ? [] : [`the report shows an email address (blur them): ${hit[0]}`];
}

/** Everything wrong with a parsed walk report, given which repo-relative media exist; [] when it holds. */
export function walkReportProblems(value: unknown, exists: (path: string) => boolean): string[] {
  if (!isObject(value)) return ['the walk report is not a JSON object'];
  const fields = FIELDS.filter(([f, holds]) => !holds(value[f])).map(([, , problem]) => problem);
  const unknown = Object.keys(value).filter((k) => !NAMES.includes(k)).map((k) => `unknown field "${k}"`);
  if (fields.length + unknown.length > 0) return [...fields, ...unknown];
  const items = value.items as unknown[];
  const shape = [...items.flatMap((it, i) => itemProblems(it, i, value.video as string)), ...duplicates(items), ...extrasProblems(value.extras as Raw)];
  if (shape.length > 0) return shape;
  const r = value as unknown as WalkReport;
  return [...mediaProblems(r, exists), ...timestampProblems(r), ...emailProblems(r)];
}
