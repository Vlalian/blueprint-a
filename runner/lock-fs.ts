// The lock and queue on real files (decisions 30 and 44): the LockIo for scripts/lock.ts and the
// process check the run queue shares. Works the same on Windows: a file is created exclusively
// with the `wx` flag, moved aside by renaming to a name nothing else uses (a rename onto an
// existing file fails there), and put back with a hard link, which never overwrites anywhere. The
// takeover marker of a stale lock sits beside it as <lock>.<its token>.takeover, and a marker past one
// left by a dead taker as <lock>.<its token>-<n>.takeover.

import { randomBytes } from 'node:crypto';
import { linkSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import type { LockFile, LockIo } from './lock.ts';

type Kill = (pid: number, signal?: number | string) => unknown;

/**
 * Whether process `pid` is alive on this host: signal 0 checks without signalling. EPERM means it
 * exists but belongs to someone else, so it is alive.
 */
export function isAlive(pid: number, kill: Kill = (p, s) => process.kill(p, s)): boolean {
  try {
    kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** What `f` returns, or undefined when the file it reads is not there. */
export function ifThere<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

/** Whether `f` made its file: false when the file was already there. */
export function exclusive(f: () => void): boolean {
  try {
    f();
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw e;
  }
}

// Windows: opening a file another process is deleting fails with EPERM. For the takeover marker,
// which racing takers create and delete, that means another taker is busy with it.
const busy = (e: unknown) => (e as NodeJS.ErrnoException).code === 'EPERM';

/** `exclusive`, where a file being deleted by another process also counts as already there. */
export function exclusiveOrBusy(f: () => void): boolean {
  try {
    return exclusive(f);
  } catch (e) {
    if (busy(e)) return false;
    throw e;
  }
}

/** `ifThere`, where a file being deleted by another process reads as 'busy', a text no holder parses from. */
export function ifThereOrBusy(f: () => string): string | undefined {
  try {
    return ifThere(f);
  } catch (e) {
    if (busy(e)) return 'busy';
    throw e;
  }
}

/**
 * The file's identity, then its text. Should the file be replaced between the two, the pair
 * matches no file, so a takeover that compares it with the file it moved puts that file back.
 */
function readFile(path: string): LockFile {
  // Stryker disable next-line ObjectLiteral,BooleanLiteral: equivalent on Linux, where an inode fits a double; a Windows file index is 64 bits, so it is read as a bigint
  const { dev, ino } = statSync(path, { bigint: true });
  return { text: readFileSync(path, 'utf8'), id: `${dev}:${ino}` };
}

function moveAside(path: string): (LockFile & { path: string }) | undefined {
  const aside = `${path}.${randomBytes(8).toString('hex')}.stale`;
  return ifThere(() => {
    renameSync(path, aside);
    return { ...readFile(aside), path: aside };
  });
}

function restore(aside: string, path: string): void {
  if (exclusive(() => linkSync(aside, path))) unlinkSync(aside);
}

/** The lock file at `path`, for this process. */
export function lockFs(path: string): LockIo {
  const marker = (token: string) => `${path}.${token}.takeover`;
  return {
    read: () => ifThere(() => readFile(path)),
    createExclusive: (text) => exclusive(() => writeFileSync(path, text, { flag: 'wx' })),
    moveAside: () => moveAside(path),
    restore: (aside) => restore(aside, path),
    remove: () => rmSync(path, { force: true }),
    discard: (aside) => rmSync(aside, { force: true }),
    claimTakeover: (token, text) => exclusiveOrBusy(() => writeFileSync(marker(token), text, { flag: 'wx' })),
    readTakeover: (token) => ifThereOrBusy(() => readFileSync(marker(token), 'utf8')),
    dropTakeover: (token) => rmSync(marker(token), { force: true }),
    isAlive: (pid) => isAlive(pid),
    self: { pid: process.pid, host: hostname() },
    now: () => new Date().toISOString(),
    token: () => randomBytes(16).toString('hex'),
  };
}
