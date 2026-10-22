// The SHA ledger (pstack's verification ledger, rewritten): a verdict holds for one exact commit.
// A SHA with no row reads NOT-VERIFIED. After a rebase the new SHA keeps a verdict only when its
// `git patch-id` (of the whole change since the merge-base) matches a recorded row. One
// tab-separated row per verdict, appended, never rewritten; the latest row wins. scripts/ledger.ts
// only wires in git and the file.

import { parseArgs } from 'node:util';

export const VERDICTS = ['VERIFIED', 'FAILED', 'NOT-VERIFIED'] as const;
export type Verdict = (typeof VERDICTS)[number];
/** NOT-VERIFIED is what a missing row reads as; it is never written. */
export type Recorded = Exclude<Verdict, 'NOT-VERIFIED'>;

export interface LedgerRow {
  sha: string;
  /** '' when the change since the merge-base is empty. */
  patchId: string;
  verdict: Recorded;
  ticket: string;
  at: string;
}

export interface VerdictRead {
  sha: string;
  patchId: string;
  verdict: Verdict;
  /** sha: a row for this exact commit; patch-id: carried over from another commit; none: no row. */
  source: 'sha' | 'patch-id' | 'none';
  carriedFrom?: string;
  ticket?: string;
}

export interface LedgerIo {
  /** git in the repo; throws on a failing command. */
  git(args: string[], input?: string): string;
  /** The ledger file's text, or undefined when there is none yet. */
  read(ledger: string): string | undefined;
  append(ledger: string, line: string): void;
  now(): string;
}

const SHA = /^[0-9a-f]{40}$/;
const isRecorded = (v: string): v is Recorded => v === 'VERIFIED' || v === 'FAILED';

const isPatchId = (p: string) => p === '-' || SHA.test(p);
const wellFormed = (cols: string[]) => cols.length === 5 && SHA.test(cols[0]!) && isPatchId(cols[1]!) && isRecorded(cols[2]!);

function parseRow(line: string, n: number): LedgerRow {
  const cols = line.split('\t');
  if (!wellFormed(cols)) throw new Error(`ledger line ${n} is not "sha, patch-id, VERIFIED|FAILED, ticket, time": ${JSON.stringify(line)}`);
  const [sha, patch, verdict, ticket, at] = cols as [string, string, Recorded, string, string];
  return { sha, patchId: patch === '-' ? '' : patch, verdict, ticket, at };
}

/** The rows of a ledger file, oldest first. A malformed line throws: a ledger is never guessed at. */
export function parseLedger(text: string | undefined): LedgerRow[] {
  const lines = (text ?? '').split(/\r?\n/);
  return lines.flatMap((line, i) => (line === '' ? [] : [parseRow(line, i + 1)]));
}

export function formatRow(r: LedgerRow): string {
  if (!/^[^\t\r\n]+$/.test(r.ticket)) throw new Error(`ticket ${JSON.stringify(r.ticket)} must be one non-empty word without tabs or line breaks`);
  return `${[r.sha, r.patchId || '-', r.verdict, r.ticket, r.at].join('\t')}\n`;
}

/** The verdict for this exact SHA, else one carried over by a matching non-empty patch-id, else NOT-VERIFIED. */
export function readVerdict(rows: LedgerRow[], sha: string, patchId: string): VerdictRead {
  const exact = rows.findLast((r) => r.sha === sha);
  if (exact) return { sha, patchId, verdict: exact.verdict, source: 'sha', ticket: exact.ticket };
  const same = patchId === '' ? undefined : rows.findLast((r) => r.patchId === patchId);
  if (same) return { sha, patchId, verdict: same.verdict, source: 'patch-id', carriedFrom: same.sha, ticket: same.ticket };
  return { sha, patchId, verdict: 'NOT-VERIFIED', source: 'none' };
}

/** `git patch-id` prints "<patch-id> <commit-id>", or nothing for an empty diff. */
export function patchIdOf(stdout: string): string {
  return stdout.split(' ')[0]!.trim();
}

/** The full SHA a ref names, and the patch-id of everything it changes since its merge-base with base. */
function commitOf(ref: string, base: string, io: LedgerIo): { sha: string; patchId: string } {
  const sha = io.git(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  const mergeBase = io.git(['merge-base', base, sha]).trim();
  const diff = io.git(['diff', '--no-color', '--no-ext-diff', mergeBase, sha]);
  return { sha, patchId: patchIdOf(io.git(['patch-id', '--stable'], diff)) };
}

export function recordVerdict(input: { ledger: string; ref: string; base: string; verdict: string; ticket: string }, io: LedgerIo): LedgerRow {
  if (!isRecorded(input.verdict)) throw new Error(`a recorded verdict is VERIFIED or FAILED, not ${JSON.stringify(input.verdict)}`);
  const row: LedgerRow = { ...commitOf(input.ref, input.base, io), verdict: input.verdict, ticket: input.ticket, at: io.now() };
  io.append(input.ledger, formatRow(row));
  return row;
}

export function checkVerdict(input: { ledger: string; ref: string; base: string }, io: LedgerIo): VerdictRead {
  const { sha, patchId } = commitOf(input.ref, input.base, io);
  return readVerdict(parseLedger(io.read(input.ledger)), sha, patchId);
}

type LedgerOptions = { cwd?: string; ledger?: string; sha?: string; base?: string; verdict?: string; ticket?: string };

const OPTIONS = { cwd: { type: 'string', default: '.' }, ledger: { type: 'string' }, sha: { type: 'string' }, base: { type: 'string' }, verdict: { type: 'string' }, ticket: { type: 'string' } } as const;

/** The CLI's exit for a check: 0 VERIFIED, 1 FAILED, 3 NOT-VERIFIED (2 is "could not run"). */
const CHECK_EXIT: Record<Verdict, number> = { VERIFIED: 0, FAILED: 1, 'NOT-VERIFIED': 3 };

function need(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`usage: ${flag} is required`);
  return value;
}

function dispatch(argv: string[], ioIn: (cwd: string) => LedgerIo): { json: Record<string, unknown>; exitCode: number } {
  const { positionals, values: o } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true }) as { positionals: string[]; values: LedgerOptions };
  const io = ioIn(o.cwd!);
  const target = () => ({ ledger: need(o.ledger, '--ledger'), ref: need(o.sha, '--sha'), base: need(o.base, '--base') });
  if (positionals[0] === 'record') {
    const recorded = recordVerdict({ ...target(), verdict: need(o.verdict, '--verdict'), ticket: need(o.ticket, '--ticket') }, io);
    return { json: { recorded }, exitCode: 0 };
  }
  if (positionals[0] === 'check') {
    const read = checkVerdict(target(), io);
    return { json: { ...read }, exitCode: CHECK_EXIT[read.verdict] };
  }
  throw new Error('usage: node scripts/ledger.ts <record|check> --ledger <file> --sha <ref> --base <ref> [--verdict VERIFIED|FAILED --ticket <id>] [--cwd <repo>]');
}

/** One CLI call; `ioIn` gives the I/O for the repo at --cwd. Anything that throws is exit 2 with the error, never a verdict. */
export function runLedger(argv: string[], ioIn: (cwd: string) => LedgerIo): { json: Record<string, unknown>; exitCode: number } {
  try {
    return dispatch(argv, ioIn);
  } catch (e) {
    return { json: { error: e instanceof Error ? e.message : String(e) }, exitCode: 2 };
  }
}
