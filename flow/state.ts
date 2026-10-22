// Where the flow tools keep what they know, and how they read a ticket (ticket 84, from
// scripts/flow/flow-state.ts, done.ts and review.ts). State lives in the configured state folder
// under the repo, durable and git-ignored, never a temp folder. A ticket branch is the configured
// prefix and the ticket file's name (`ticket/12-login` for docs/tickets/12-login.md); a ticket is
// built when its file has a `## Result` section, and the family that built its last round is the
// last `Builder: <family>` line of that section. Pure: paths and parsing only.

import { dirname, join } from 'node:path';
import type { FlowConfig } from './config.ts';

export const FLOW_FILES = {
  gateQueue: 'gate-queue.json',
  gateLock: 'gate.lock',
  consents: 'consents.json',
  reviews: 'reviews.json',
  inFlight: 'in-flight.json',
  observations: 'observations.jsonl',
  logs: 'logs',
} as const;

type Where = Pick<FlowConfig, 'stateDir'>;

/** `rel` in the nearest folder at or above `dir` that has it (the last one tried when none has): where this package's own files are, in a repo or installed. */
export const upTo = (dir: string, rel: string, exists: (path: string) => boolean): string => (exists(join(dir, rel)) || dirname(dir) === dir ? join(dir, rel) : upTo(dirname(dir), rel, exists));

/** A repo path (with forward slashes) under the root. */
export const repoPath = (root: string, path: string) => join(root, ...path.split('/'));

/** <stateDir>/<file> under the repo root. */
export const flowPath = (root: string, c: Where, file: string) => join(repoPath(root, c.stateDir), file);

/** A worktree of the flow's, <worktreeDir>/<name> under the repo root. */
export const worktreePath = (root: string, c: Pick<FlowConfig, 'worktreeDir'>, name: string) => join(root, ...c.worktreeDir.split('/'), name);

/** A state file's JSON, `empty` when there is none; throws, naming the file, when it cannot be read. */
export function jsonOf<T>(text: string | undefined, empty: T, file: string): T {
  if (text === undefined) return empty;
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(`${file} could not be read: ${(e as Error).message}`);
  }
}

export const jsonText = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** The ticket file's name of a ticket branch (`ticket/12-login` is 12-login); undefined for any other branch. */
export function ticketNameOf(branch: string, c: Pick<FlowConfig, 'branchPrefix'>): string | undefined {
  if (!branch.startsWith(c.branchPrefix)) return undefined;
  const name = branch.slice(c.branchPrefix.length);
  return /^\d+[a-z]?-[\w.-]+$/.test(name) ? name : undefined;
}

/** The ticket of a ticket file's name: `12-login` is 12, `15c-x` is 15c; undefined for a name without one. */
export const ticketOf = (name: string) => /^\d+[a-z]?(?=-)/.exec(name)?.[0];

/** The ticket file of a ticket name, as a repo path. */
export const ticketFile = (name: string, c: Pick<FlowConfig, 'ticketFolder'>) => `${c.ticketFolder}/${name}.md`;

/** The name, without `.md`, of the ticket file of `ticket` among a folder's file names. */
export const nameOfTicket = (files: string[], ticket: string) =>
  files
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -'.md'.length))
    .find((n) => ticketOf(n) === ticket);

/** A ticket's Result heading, trailing spaces or tabs allowed; `$` also ends a line before a Windows `\r`. */
export const RESULT_HEADING = /^## Result[ \t]*\r?$/m;

export const hasResult = (text: string) => RESULT_HEADING.test(text);

/** The last Result section's text as a string: `undefined` when the ticket has none, which has no Builder or Round line. */
const lastResult = (text: string) => String(text.split(RESULT_HEADING).slice(1).at(-1));

/** The family the last `Builder:` line of the ticket's last Result names, or undefined. */
export function builderIn(text: string): string | undefined {
  return [...lastResult(text).matchAll(/^Builder:[ \t]+([\w.-]+)[ \t]*\r?$/gm)].at(-1)?.[1];
}

/** The round the last `Round:` line of the ticket's last Result names; 1 when it names none. */
export function roundIn(text: string): string {
  return [...lastResult(text).matchAll(/^Round:[ \t]+(\S+)/gm)].at(-1)?.[1] ?? '1';
}
