// The handoff gate with its I/O passed in, so it is tested in-process. cli.ts only wires in git,
// the file system and the environment.

import type { GateResult } from '../lib/contract.ts';
import { type HandoffIo, validateHandoff } from './validate.ts';

export interface HandoffGateIo {
  readDraft(path: string): string;
  /** WORKFLOW_ROLE (the sender) and WORKFLOW_ROLES (comma list), set by the dispatcher. */
  env: Record<string, string | undefined>;
  resolveCommit(abbrev: string): { sha: string } | 'ambiguous' | null;
  now(): string;
  nextSequence(): number;
  /** Writes the file into the outbox atomically, and never over a file already there. */
  writeToOutbox(name: string, text: string): void;
}

/**
 * `git rev-parse --verify <abbrev>^{commit}` read as a commit lookup. Only "Needed a single
 * revision" means the draft named no commit; any other failure (not a repo, git missing or
 * killed) is git's, and throws so the gate exits 2 instead of blaming the draft (review #23).
 */
export function commitFromGit(r: { status: number | null; stdout: string | null; stderr: string | null }) {
  const stderr = r.stderr ?? '';
  if (r.status === 0) return { sha: String(r.stdout).trim() };
  if (/ambiguous/i.test(stderr)) return 'ambiguous' as const;
  if (/Needed a single revision/.test(stderr)) return null;
  throw new Error(`git could not look up the commit: ${stderr.trim() || `exit ${r.status}`}`);
}

/** The number after the one an outbox's sequence file holds; 1 when there is no file yet. */
export function nextSequenceAfter(text: string | undefined): number {
  const last = Number(text ?? 0);
  if (text?.trim() === '' || !Number.isSafeInteger(last) || last < 0) {
    throw new Error(`the outbox sequence file holds ${JSON.stringify(text)}, not a count; repair it by hand`);
  }
  return last + 1;
}

/**
 * The next sequence number no other writer holds. Read-increment-write of `.sequence` alone
 * lets two handoffs in the same second take the same number (review #24), so each number is
 * also claimed: `claim(n)` creates n's marker exclusively and says whether it won.
 */
export function claimSequence(last: string | undefined, claim: (n: number) => boolean): number {
  let n = nextSequenceAfter(last);
  while (!claim(n)) n += 1;
  return n;
}

/** Runs an exclusive create: false when the target already exists; any other failure is thrown. */
export function createdExclusively(create: () => void): boolean {
  try {
    create();
    return true;
  } catch (e) {
    if ((e as { code?: unknown }).code === 'EEXIST') return false;
    throw e;
  }
}

/** The validator's view of the environment: who is sending, and which roles exist. */
function validatorIo(io: HandoffGateIo): HandoffIo {
  return {
    roles: (io.env.WORKFLOW_ROLES ?? '').split(',').filter(Boolean),
    from: io.env.WORKFLOW_ROLE ?? '',
    resolveCommit: io.resolveCommit,
    now: io.now,
    sequence: io.nextSequence,
  };
}

export function handoffGate(opts: { draft?: string; outbox?: string }, io: HandoffGateIo): GateResult & { errors: string[] } {
  if (!opts.draft || !opts.outbox) throw new Error('usage: handoff --draft <file> --outbox <dir> [--cwd <repo>]');
  const r = validateHandoff(io.readDraft(opts.draft), validatorIo(io));
  if (r.file) io.writeToOutbox(r.file.name, r.file.text);
  return { gate: 'handoff', pass: r.errors.length === 0, errors: r.errors, file: r.file?.name };
}
