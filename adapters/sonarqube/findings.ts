// SonarQube's new-code issues as findings (ticket 59), triaged the way ticket 44 triages
// CodeRabbit's comments: a real defect, style, or a false alarm. A real defect or smell of a kind one
// of our gates checks names that gate, which is how an escape is counted; and each finding of ours
// SonarQube did not raise is recorded beside them, so the two can be compared per check (duplication,
// secrets, complexity) on numbers, after about 10 pull requests. Pure: issues in, records out.

import type { SonarIssue } from './sonarqube.ts';

export type Classification = 'real-defect' | 'style' | 'false-alarm';

/** A finding observation with source sonarqube, in the shape the reference's observation log keeps. */
export interface SonarFinding {
  kind: 'finding';
  source: 'sonarqube';
  id: string;
  rule: string;
  severity: string;
  /** What SonarQube calls the kind: its type, else the software qualities the issue impacts. */
  axis: string;
  file: string;
  line?: number;
  summary: string;
  classification: Classification;
  fate: 'escalate' | 'decline';
  reason: string;
  /** The gate of ours that checks this kind of thing, when one does. */
  gate?: string;
  sha: string;
}

/** A finding one of our gates made on the same commit. */
export interface OurFinding {
  gate: string;
  file: string;
  line?: number;
}

// SonarQube's statuses for an issue someone marked as not a problem (the classic resolutions and
// the 10.4+ issue statuses).
const DISMISSED = /^(FALSE[-_]POSITIVE|WONTFIX|ACCEPTED)$/;
const DEFECT_TYPES = /^(BUG|VULNERABILITY)$/;
const DEFECT_QUALITIES = /^(RELIABILITY|SECURITY)$/;

const dismissed = (i: SonarIssue) => [i.resolution, i.issueStatus].some((s) => DISMISSED.test(String(s)));
const defect = (i: SonarIssue) => DEFECT_TYPES.test(String(i.type)) || i.impacts.some((m) => DEFECT_QUALITIES.test(m.softwareQuality));

/** A dismissed issue is a false alarm; a bug, a vulnerability or a reliability or security impact a real defect; the rest style. */
export function classify(issue: SonarIssue): Classification {
  if (dismissed(issue)) return 'false-alarm';
  return defect(issue) ? 'real-defect' : 'style';
}

// Rule keys are <repository>:<rule>; the repository differs per language (typescript, javascript,
// csharpsquid, ...), so most rules match on the part after the colon.
const GATES: Array<[RegExp, string]> = [
  [/^secrets:/, 'secret-scan'],
  [/^common-[\w-]+:DuplicatedBlocks$/, 'duplication'],
  [/:(S3776|S1541)$/, 'onkel'],
  [/:(S1525|S2228|S106)$/, 'debug-leftovers'],
  [/:S1607$/, 'four-checks'],
];

const MESSAGES: Array<[RegExp, string]> = [
  [/bidi|zero-width|invisible character/i, 'hidden-unicode'],
  [/circular (import|dependency)|import cycle/i, 'boundaries'],
];

/** The gate of ours that checks the kind of thing the issue is: by its rule, else its message. */
export function gateFor(issue: Pick<SonarIssue, 'rule' | 'message'>): string | undefined {
  const byRule = GATES.find(([rule]) => rule.test(issue.rule));
  return (byRule ?? MESSAGES.find(([message]) => message.test(issue.message)))?.[1];
}

const SEVERITY_ORDER = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
/** A severity's place, highest first; one SonarQube adds later ranks below INFO. */
const rank = (s: string) => {
  const place = SEVERITY_ORDER.indexOf(s);
  return place < 0 ? SEVERITY_ORDER.length : place;
};

/** The highest impact severity, else the issue's own severity (deprecated in 10.2), else unknown. */
function severityOf(issue: SonarIssue): string {
  const impacts = issue.impacts.map((m) => m.severity).sort((a, b) => rank(a) - rank(b));
  return impacts[0] ?? issue.severity ?? 'unknown';
}

const axisOf = (issue: SonarIssue) => issue.type ?? issue.impacts.map((m) => m.softwareQuality).join(',');

const FATES: Record<Classification, Pick<SonarFinding, 'fate' | 'reason'>> = {
  'real-defect': { fate: 'escalate', reason: 'SonarQube found a real defect in new code' },
  style: { fate: 'decline', reason: 'style' },
  'false-alarm': { fate: 'decline', reason: 'false alarm' },
};

/** One issue as a finding; a gate is named unless it is a false alarm. */
export function findingOf(issue: SonarIssue, sha: string): SonarFinding {
  const classification = classify(issue);
  const gate = classification === 'false-alarm' ? undefined : gateFor(issue);
  return {
    ...{ kind: 'finding', source: 'sonarqube', id: `sonarqube-${issue.key}`, rule: issue.rule, severity: severityOf(issue), axis: axisOf(issue) },
    ...{ file: issue.file, line: issue.line, summary: issue.message, classification, ...FATES[classification], sha },
    ...(gate === undefined ? {} : { gate }),
  };
}

export const findingsOf = (issues: SonarIssue[], sha: string) => issues.map((i) => findingOf(i, sha));

/** Per gate that both check: what SonarQube raised, what ours raised, and what both raised (same gate, same file). */
export interface Overlap {
  gate: string;
  sonarqube: number;
  ours: number;
  both: number;
}

export interface Comparison {
  /** SonarQube findings naming a gate of ours that found nothing on that file: escapes. */
  escapes: SonarFinding[];
  /** Our findings SonarQube raised nothing of that kind on, for that file. */
  oursOnly: OurFinding[];
  overlap: Overlap[];
}

const sameAs = (gate: string | undefined, file: string) => (f: { gate?: string; file: string }) => f.gate === gate && f.file === file;

function overlapOf(gate: string, sonar: SonarFinding[], ours: OurFinding[]): Overlap {
  const s = sonar.filter((f) => f.gate === gate);
  const o = ours.filter((f) => f.gate === gate);
  return { gate, sonarqube: s.length, ours: o.length, both: s.filter((f) => o.some(sameAs(gate, f.file))).length };
}

/** SonarQube's findings beside ours on the same commit; false alarms count on neither side. */
export function compareFindings(sonarFindings: SonarFinding[], ours: OurFinding[]): Comparison {
  const sonar = sonarFindings.filter((f) => f.gate !== undefined);
  const gates = [...new Set([...sonar.map((f) => f.gate!), ...ours.map((f) => f.gate)])].sort();
  return {
    escapes: sonar.filter((f) => !ours.some(sameAs(f.gate, f.file))),
    oursOnly: ours.filter((o) => !sonar.some(sameAs(o.gate, o.file))),
    overlap: gates.map((g) => overlapOf(g, sonar, ours)),
  };
}
