// The sast gate's rules (ticket 60): Semgrep's findings on the source files a change touched, read
// from its JSON. A finding blocks when it is ERROR severity and new (the base has no finding of
// that rule on the same code); a WARNING or INFO one is reported. A `nosemgrep` comment suppresses
// a finding on its own line (or on the next line, when the comment stands alone) only when it names
// the rule and gives a reason after ` -- `; one without either is itself a blocking finding.
// Semgrep's own nosemgrep handling is off (--disable-nosem), so every suppression is judged here.
// Pure.

import { isTestFile } from '../lib/test-files.ts';

/** The Semgrep version the rules in rules/ were recorded with (rules/SNAPSHOT.json). */
export const PINNED_SEMGREP = '1.179.0';

export interface Finding {
  /** The rule's id below the rules folder, e.g. javascript.lang.security.detect-child-process. */
  rule: string;
  severity: string;
  file: string;
  line: number;
  message: string;
}

export interface Scan {
  version: string;
  findings: Finding[];
  /** Files Semgrep could not parse, with why. */
  notScanned: string[];
}

/** A finding a reasoned suppression covers. */
export type Suppressed = Finding & { reason: string };

const LANGUAGE_DIR = /\.((?:javascript|typescript|csharp)\..*)/;

/**
 * A local rule's check_id is the rules folder's path, dotted, then the rule's folders and id; the
 * rule is what follows the path, from its language folder on. Any other id is kept as it is.
 */
export const ruleOf = (checkId: string) => LANGUAGE_DIR.exec(checkId)?.[1] ?? checkId;

type Raw = { check_id: unknown; path: unknown; start: { line: unknown }; extra: { severity: unknown; message: unknown } };
type RawError = { level?: unknown; type?: unknown; message?: unknown; path?: unknown };
type Output = { version?: unknown; results?: Raw[]; errors?: RawError[] };

const slashed = (p: unknown) => String(p).replaceAll('\\', '/');

function outputOf(stdout: string): Output | undefined {
  let out: Output | undefined;
  try {
    out = Object(JSON.parse(stdout)) as Output;
  } catch {}
  return Array.isArray(out?.results) && Array.isArray(out.errors) ? out : undefined;
}

function failed(status: number | null, out: Output | undefined): never {
  if (out === undefined) throw new Error(`Semgrep exited ${status}: no JSON on stdout`);
  const said = out.errors!.map((e) => String(e.message)).join('\n');
  throw new Error(`Semgrep exited ${status}: ${said || 'no errors reported'}`);
}

const findingOf = (r: Raw): Finding => ({
  rule: ruleOf(String(r.check_id)),
  severity: String(r.extra.severity),
  file: slashed(r.path),
  line: Number(r.start.line),
  message: String(r.extra.message),
});

/** Semgrep's `--json` output and exit status as a scan; throws when it could not run. */
export function parseScan(stdout: string, status: number | null): Scan {
  const out = outputOf(stdout);
  if (status !== 0) failed(status, out);
  if (out === undefined) throw new Error('Semgrep gave no JSON on stdout');
  const notScanned = out.errors!.filter((e) => e.path !== undefined).map((e) => `${slashed(e.path)}: ${String(e.type)}`);
  return { version: out.version === undefined ? 'unknown' : String(out.version), findings: out.results!.map(findingOf), notScanned };
}

/** A note when Semgrep is not the version the rules were pinned with. */
export const unpinned = (version: string) =>
  version === PINNED_SEMGREP ? undefined : `Semgrep ${version} is running; the rules were pinned with ${PINNED_SEMGREP}, so results may differ`;

const SOURCE = /\.(?:[cm]?[jt]sx?|cs)$/;

/** The changed files the rules are for: TypeScript, JavaScript and C#, not tests and not fixtures. */
export const sastSources = (files: string[]) => files.filter((f) => SOURCE.test(f) && !isTestFile(f) && !f.split('/').includes('fixtures'));

export interface Suppression {
  line: number;
  rules: string[];
  reason: string;
  /** The comment is the whole line, so it covers the line below too. */
  alone: boolean;
}

const COMMENT = /(?:\/\/|\/\*|#)\s*nosemgrep\b(?::(.*?))?(?:\s--\s*(.*?))?\s*(?:\*\/)?\s*$/;

function suppressionAt(text: string, i: number): Suppression[] {
  const m = COMMENT.exec(text);
  if (m === null) return [];
  const rules = (m[1] ?? '').split(',').map((r) => r.trim()).filter(Boolean);
  return [{ line: i + 1, rules, reason: m[2] ?? '', alone: text.slice(0, m.index).trim() === '' }];
}

/** Every nosemgrep comment in a file's text, by line. */
export const suppressionsIn = (text: string): Suppression[] => text.split(/\r?\n/).flatMap(suppressionAt);

const NO_REASON = 'a nosemgrep comment needs the rule id and a reason: nosemgrep: <rule> -- <reason>';

const valid = (s: Suppression) => s.rules.length > 0 && s.reason !== '';

const covers = (s: Suppression, f: Finding) =>
  (f.line === s.line || (s.alone && f.line === s.line + 1)) && s.rules.some((r) => r === f.rule || f.rule.endsWith(`.${r}`));

/**
 * The findings left after the reasoned suppressions, plus one blocking finding for each
 * suppression without a rule or a reason; and the findings the suppressions covered.
 */
export function judged(findings: Finding[], texts: Map<string, string>): { kept: Finding[]; suppressed: Suppressed[] } {
  const comments = new Map([...texts].map(([file, text]) => [file, suppressionsIn(text)]));
  const kept: Finding[] = [];
  const suppressed: Suppressed[] = [];
  for (const f of findings) {
    const by = (comments.get(f.file) ?? []).find((s) => valid(s) && covers(s, f));
    if (by === undefined) kept.push(f);
    else suppressed.push({ ...f, reason: by.reason });
  }
  const bad = [...comments].flatMap(([file, list]) =>
    list.filter((s) => !valid(s)).map((s): Finding => ({ rule: 'sast.suppression-without-reason', severity: 'ERROR', file, line: s.line, message: NO_REASON })),
  );
  return { kept: [...kept, ...bad], suppressed };
}

export interface Side {
  findings: Finding[];
  /** Each scanned file's text. */
  texts: Map<string, string>;
}

/** A finding's identity across a change: its rule, its file and the code on its line (its line number when the text is missing). */
function keyOf(f: Finding, texts: Map<string, string>): string {
  const text = texts.get(f.file);
  const code = text === undefined ? `#${f.line}` : (text.split(/\r?\n/)[f.line - 1] ?? '').trim();
  return [f.rule, f.file, code].join('\0');
}

/** The head's findings the base does not have, each copy counted: a second copy of base code is new. */
export function newFindings(head: Side, base: Side): Finding[] {
  const left = new Map<string, number>();
  for (const f of base.findings) {
    const k = keyOf(f, base.texts);
    left.set(k, (left.get(k) ?? 0) + 1);
  }
  return head.findings.filter((f) => {
    const k = keyOf(f, head.texts);
    const n = left.get(k) ?? 0;
    left.set(k, n - 1);
    return n <= 0;
  });
}
