// The base into the open tickets (ticket 84, from the reference's own flow; 11-optimisations
// item 7): after a merge pushes the integration branch, it is merged into every open ticket branch,
// so a clash is found while the ticket is small. An open branch is a ticket branch on the remote
// that the integration branch does not hold, other than the one just merged. One a build is
// writing to (in flight, in-flight.ts) is skipped: that build merges the base itself before its
// Result. Each other branch is merged in a worktree of its own, typechecked there with
// config/flow.json's typecheck command and pushed when both pass; a conflict, a failed typecheck or
// a rejected push leaves the branch as it was, listed with the conflicting files for the next
// round. Never a force-push. Each push, skip and failure is a base-into record. With git, the
// shell, the files and the clock injected.

import type { ProcessResult } from '../adapters/host/process-result.ts';
import { builds, type Build, type BuildsIo } from './builds.ts';
import type { FlowConfig } from './config.ts';
import { buildsInFlight, readInFlight } from './in-flight.ts';
import { appendRecords, type BaseIntoOutcome } from './records.ts';
import { worktreePath } from './state.ts';

export interface BaseIntoIo extends BuildsIo {
  append(path: string, text: string): void;
  /** A shell command in `cwd`; its exit status. */
  run(command: string, cwd: string): number | null;
  worktreeId(): string;
  now(): string;
}

export interface BaseInto {
  ticket: string;
  branch: string;
  /** `current`: the branch holds the base already, nothing to do. */
  outcome: BaseIntoOutcome | 'current';
  /** The conflicting files of a conflict. */
  files: string[];
  /** git's words when a push or the worktree failed, and a worktree left behind. */
  detail?: string;
}

export type BaseIntoConfig = Pick<FlowConfig, 'remote' | 'branchPrefix' | 'integrationBranch' | 'ticketFolder' | 'stateDir' | 'worktreeDir' | 'typecheck'>;

const lines = (text: string) => text.split(/\r?\n/).filter((l) => l !== '');
/** git's words on one line. */
const words = (r: ProcessResult) => lines(r.stderr || r.stdout).join(' ');

/** In the branch's worktree: merge the base, typecheck, push. */
function mergedInto(b: Build, wt: string, c: BaseIntoConfig, io: BaseIntoIo): BaseInto {
  const result = (outcome: BaseInto['outcome'], files: string[] = [], detail?: string): BaseInto => ({ ticket: b.ticket, branch: b.branch, outcome, files, detail });
  const base = `${c.remote}/${c.integrationBranch}`;
  if (io.git(wt, ['merge', '--no-ff', '-m', `Merge ${c.integrationBranch} into ${b.branch}`, base]).status !== 0) {
    const files = lines(io.git(wt, ['diff', '--name-only', '--diff-filter=U']).stdout);
    io.git(wt, ['merge', '--abort']);
    return result('conflict', files);
  }
  if (io.run(c.typecheck, wt) !== 0) return result('typecheck');
  const push = io.git(wt, ['push', c.remote, `HEAD:refs/heads/${b.branch}`]);
  return push.status === 0 ? result('pushed') : result('push-failed', [], words(push));
}

/** Removes the worktree; one git will not remove is named, so nothing made in it is lost unseen. */
function cleanup(wt: string, result: BaseInto, io: BaseIntoIo): BaseInto {
  const removed = io.git(io.root, ['worktree', 'remove', wt]);
  if (removed.status === 0) return result;
  const left = `worktree left at ${wt}: ${words(removed)}`;
  return { ...result, detail: [result.detail, left].filter((d) => d !== undefined).join('; ') };
}

/** The base into one open branch no build writes to, in a worktree made for it and removed after. */
function into(b: Build, c: BaseIntoConfig, io: BaseIntoIo): BaseInto {
  if (io.git(io.root, ['merge-base', '--is-ancestor', `${c.remote}/${c.integrationBranch}`, `${c.remote}/${b.branch}`]).status === 0) return { ticket: b.ticket, branch: b.branch, outcome: 'current', files: [] };
  const wt = worktreePath(io.root, c, `base-into-${b.ticket}-${io.worktreeId()}`);
  const add = io.git(io.root, ['worktree', 'add', '--detach', wt, `${c.remote}/${b.branch}`]);
  if (add.status !== 0) return { ticket: b.ticket, branch: b.branch, outcome: 'worktree', files: [], detail: words(add) };
  return cleanup(wt, mergedInto(b, wt, c, io), io);
}

function record(results: BaseInto[], c: BaseIntoConfig, io: BaseIntoIo): void {
  const base = io.git(io.root, ['rev-parse', `${c.remote}/${c.integrationBranch}`]).stdout.trim();
  const at = io.now();
  const records = results.flatMap(({ ticket, branch, outcome, files, detail }) =>
    outcome === 'current' ? [] : [{ at, run: 'flow', project: '', ticket, role: 'flow-merge', kind: 'base-into' as const, branch, base, outcome, files, detail }],
  );
  appendRecords(io.root, c, records, io);
}

/** The integration branch, just pushed, into every open ticket branch but `merged`; what happened to each. */
export function baseIntoOpen(merged: string, c: BaseIntoConfig, io: BaseIntoIo): BaseInto[] {
  const all = builds(c, io);
  const writing = new Set(buildsInFlight(all, readInFlight(c, io)).map((f) => f.branch));
  const open = all.filter((b) => b.state !== 'merged' && b.branch !== merged);
  const results = open.map((b) => (writing.has(b.branch) ? { ticket: b.ticket, branch: b.branch, outcome: 'skipped' as const, files: [] } : into(b, c, io)));
  record(results, c, io);
  return results;
}

const SAID: Record<BaseInto['outcome'], (r: BaseInto) => string> = {
  pushed: () => 'merged and pushed',
  conflict: (r) => `conflicts, left as it was for the next round: ${r.files.join(', ')}`,
  skipped: () => 'skipped, a build is writing to it and merges the base itself',
  typecheck: () => 'fails typecheck after the merge, left as it was for the next round',
  current: () => 'already holds the base',
  'push-failed': () => 'not pushed, left as it was',
  worktree: () => 'no worktree, left as it was',
};

/** What the merge prints after it pushed. */
export function baseIntoLines(base: string, results: BaseInto[]): string[] {
  if (results.length === 0) return [`No open ticket branch to merge ${base} into.`];
  return [`${base} into the open ticket branches:`, ...results.map((r) => `  ${r.branch}: ${SAID[r.outcome](r)}${r.detail === undefined ? '' : ` (${r.detail})`}`)];
}
