// The consent gate (ticket 72) for any CI or pre-commit: a change refuses when it puts a ticket in a
// buildable status without the owner's choice on record, or changes a locked path off the branch of a
// ticket the owner agreed (core.ts). The I/O is injected; cli.ts wires git in.
import { globToRegExp } from '../lib/glob.ts';
import { agreedBranch, isTicket, readyRefusal, type ConsentConfig } from './core.ts';

export interface ConsentIo {
  /** Repo-relative paths the change adds, edits or deletes. */
  changed(): string[];
  /** A file's text before the change; undefined when it did not exist. */
  before(path: string): string | undefined;
  /** A file's text after the change; undefined when the change deletes it. */
  after(path: string): string | undefined;
  /** Every repo-relative file after the change, to find the branch's ticket. */
  list(): string[];
  branch(): string;
}

const slash = (p: string) => p.replaceAll('\\', '/');

/** The ticket files the change makes buildable without the owner's choice, each with why. */
function refusedTickets(paths: string[], io: ConsentIo, config: ConsentConfig) {
  return paths.filter((p) => isTicket(p, config)).flatMap((path) => {
    // A deleted ticket reads as "undefined", which has no status, so it is never refused.
    const reason = readyRefusal(io.before(path), String(io.after(path)), config.owner);
    return reason === undefined ? [] : [{ path, reason }];
  });
}

export function consentCheck(io: ConsentIo, config: ConsentConfig, locks: string[]) {
  const paths = io.changed().map(slash).sort();
  const patterns = locks.map(globToRegExp);
  const locked = paths.filter((p) => patterns.some((r) => r.test(p)));
  const agreed = agreedBranch(io.branch(), { list: io.list, read: io.after }, config);
  const tickets = refusedTickets(paths, io, config);
  return { gate: 'consent', pass: (locked.length === 0 || agreed) && tickets.length === 0, branch: io.branch(), locked, agreed, tickets };
}
