// The evidence report (decision 39): a plan may mark a Pass when claim as needing named non-test
// evidence, for what a test cannot show (how a page looks, a manual flow). The evidence is a saved
// screenshot or recording plus this report, checked against its schema by the evidence gate:
//   { "claim": the Pass when claim, word for word,
//     "evidence": repo-relative path of the screenshot or recording,
//     "kind": "screenshot" | "recording" (must match the file),
//     "capturedAt": ISO date and time,
//     "observed": what the evidence shows,
//     "verdict": "pass" | "fail" }
// No other fields.

export type EvidenceKind = 'screenshot' | 'recording';

export interface EvidenceReport {
  claim: string;
  evidence: string;
  kind: EvidenceKind;
  capturedAt: string;
  observed: string;
  verdict: 'pass' | 'fail';
}

const EXTENSIONS: Record<EvidenceKind, string[]> = { screenshot: ['png', 'jpg', 'jpeg', 'webp'], recording: ['mp4', 'webm', 'mov', 'gif'] };
const KINDS = Object.keys(EXTENSIONS) as EvidenceKind[];

/** Whether the file at `path` is a screenshot or a recording, by its extension; undefined for anything else. */
export function evidenceKind(path: string): EvidenceKind | undefined {
  const m = /\.(\w+)$/.exec(path);
  return KINDS.find((k) => m !== null && EXTENSIONS[k].includes(m[1].toLowerCase()));
}

const EVIDENCE_FILES = KINDS.map((k) => `a ${k} (${EXTENSIONS[k].map((e) => `.${e}`).join(', ')})`).join(' or ');

const text = (v: unknown) => typeof v === 'string' && v.trim() !== '';

/** A path inside the repo: relative, /-separated, with no `..` step and no colon (a drive, or a Windows stream). */
const repoPath = (v: unknown) => typeof v === 'string' && !/^\/|[:\\]/.test(v) && !v.split('/').includes('..') && evidenceKind(v) !== undefined;

const CHECKS: Array<[field: keyof EvidenceReport, holds: (v: unknown) => boolean, problem: string]> = [
  ['claim', text, 'claim must be the Pass when claim, as text'],
  ['evidence', repoPath, `evidence must be the repo-relative path of ${EVIDENCE_FILES}`],
  ['kind', (v) => KINDS.includes(v as EvidenceKind), 'kind must be screenshot or recording'],
  ['capturedAt', (v) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v) && !Number.isNaN(Date.parse(v)), 'capturedAt must be an ISO date and time'],
  ['observed', text, 'observed must say what the evidence shows, as text'],
  ['verdict', (v) => v === 'pass' || v === 'fail', 'verdict must be pass or fail'],
];

const FIELDS: string[] = CHECKS.map(([field]) => field);

/** A kind that the file it names contradicts; checked only once both are valid. */
function kindMismatch(r: EvidenceReport): string[] {
  const actual = evidenceKind(r.evidence);
  return actual === r.kind ? [] : [`kind is ${r.kind}, but ${r.evidence} is a ${actual}`];
}

/** Everything wrong with a parsed report; [] when it fits the schema. */
export function reportProblems(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['the report is not a JSON object'];
  const r = value as Record<string, unknown>;
  const problems = CHECKS.filter(([field, holds]) => !holds(r[field])).map(([, , problem]) => problem);
  const unknown = Object.keys(r).filter((k) => !FIELDS.includes(k)).map((k) => `unknown field "${k}"`);
  return [...problems, ...unknown, ...(problems.length === 0 ? kindMismatch(r as unknown as EvidenceReport) : [])];
}
