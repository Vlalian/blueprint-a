// The evidence gate (decision 39): checks the report a plan named for a claim that needs non-test
// evidence. It passes when the report fits the schema (report.ts), the screenshot or recording it
// names was saved, the verdict is pass, and, when given, the claim is the plan's word for word.
// cli.ts only wires in the file system.

import type { GateResult } from '../lib/contract.ts';
import { reportProblems, type EvidenceReport } from './report.ts';
import { walkReportProblems } from './walk-report.ts';

export interface EvidenceIo {
  /** The report's text; throws when it cannot be read (the gate could not run). */
  read(path: string): string;
  /** Whether a repo-relative path exists. */
  exists(path: string): boolean;
}

function parsed(text: string): { value?: unknown; problem?: string } {
  try {
    return { value: JSON.parse(text) };
  } catch (e) {
    return { problem: `the report is not valid JSON: ${(e as Error).message}` };
  }
}

/** What is wrong beyond the schema: the file, the verdict, the claim. */
function factProblems(r: EvidenceReport, claim: string | undefined, io: EvidenceIo): string[] {
  return [
    ...(io.exists(r.evidence) ? [] : [`the evidence file ${r.evidence} does not exist`]),
    ...(r.verdict === 'pass' ? [] : [`the evidence shows the claim does not hold: ${r.observed}`]),
    ...(claim === undefined || claim === r.claim ? [] : [`the report is for another claim: "${r.claim}"`]),
  ];
}

function problemsOf(text: string, claim: string | undefined, io: EvidenceIo): string[] {
  const { value, problem } = parsed(text);
  if (problem !== undefined) return [problem];
  const schema = reportProblems(value);
  return schema.length > 0 ? schema : factProblems(value as EvidenceReport, claim, io);
}

export function evidenceGate(opts: { report?: string; claim?: string }, io: EvidenceIo): GateResult & { problems: string[] } {
  if (!opts.report) throw new Error('usage: evidence --report <report.json> [--claim <text>] [--repo <dir>]');
  const problems = problemsOf(io.read(opts.report), opts.claim, io);
  return { gate: 'evidence', pass: problems.length === 0, report: opts.report, problems };
}

/** A walk report (ticket 23, walk-report.ts): the stricter schema, every item cited, the cited media saved. */
export function walkEvidenceGate(opts: { walk?: string }, io: EvidenceIo): GateResult & { problems: string[] } {
  if (!opts.walk) throw new Error('usage: evidence --walk <report.json> [--repo <dir>]');
  const { value, problem } = parsed(io.read(opts.walk));
  const problems = problem === undefined ? walkReportProblems(value, io.exists) : [problem];
  return { gate: 'evidence', pass: problems.length === 0, report: opts.walk, problems };
}

/** The CLI's gate: a walk report with --walk, else the claim's evidence report. */
export const cliGate = (opts: { report?: string; walk?: string; claim?: string }, io: EvidenceIo) => (opts.walk === undefined ? evidenceGate(opts, io) : walkEvidenceGate(opts, io));
