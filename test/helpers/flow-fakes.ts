// Fakes for the flow tools' tests (ticket 71): files in memory keyed by their path.join'd path, git
// answering by its arguments, and a lock file in memory that scripts/lock.ts acquires for real.
// Every path is built with path.join, so the fakes match on Windows too.

import { join } from 'node:path';
import type { ProcessResult } from '../../adapters/host/process-result.ts';
import { acquire, release, type LockIo } from '../../runner/lock.ts';

export const ROOT = join('C:', 'work', 'workflow');

/** Files in memory, with every write recorded. */
export function memFs(start: Record<string, string> = {}) {
  const store = new Map(Object.entries(start));
  const writes: string[] = [];
  return {
    store,
    writes,
    read: (p: string) => store.get(p),
    write: (p: string, text: string) => void (writes.push(p), store.set(p, text)),
    append: (p: string, text: string) => void (writes.push(p), store.set(p, (store.get(p) ?? '') + text)),
    exists: (p: string) => store.has(p) || [...store.keys()].some((k) => k.startsWith(join(p, 'x').slice(0, -1))),
    json: (p: string) => (store.has(p) ? JSON.parse(store.get(p)!) : undefined),
  };
}

export const ok = (stdout = ''): ProcessResult => ({ status: 0, stdout, stderr: '' });
export const fail = (stderr = 'failed'): ProcessResult => ({ status: 1, stdout: '', stderr });

type Answer = ProcessResult | ((cwd: string) => ProcessResult);

/** git (or gh) answering by its joined arguments: the longest matching prefix wins, anything else succeeds with no output. */
export function fakeCli(answers: Record<string, Answer> = {}) {
  const calls: { cwd: string; args: string[] }[] = [];
  const run = (cwd: string, args: string[]): ProcessResult => {
    calls.push({ cwd, args });
    const line = args.join(' ');
    const key = Object.keys(answers)
      .filter((k) => line === k || line.startsWith(`${k} `))
      .sort((a, b) => b.length - a.length)[0];
    const a = key === undefined ? ok() : answers[key]!;
    return typeof a === 'function' ? a(cwd) : a;
  };
  return { run, calls, lines: () => calls.map((c) => c.args.join(' ')) };
}

/** A lock file in memory; `alive` says which pids of this host live. */
export function memLock(alive: (pid: number) => boolean = () => true, self = { pid: 100, host: 'pc' }) {
  let file: { text: string; id: string } | undefined;
  let n = 0;
  const markers = new Map<string, string>();
  const io: LockIo = {
    read: () => file,
    createExclusive: (text) => (file === undefined ? ((file = { text, id: String(++n) }), true) : false),
    moveAside: () => (file === undefined ? undefined : ((f) => ((file = undefined), { ...f, path: 'aside' }))(file)),
    restore: () => undefined,
    remove: () => void (file = undefined),
    discard: () => undefined,
    claimTakeover: (token, text) => (markers.has(token) ? false : (markers.set(token, text), true)),
    readTakeover: (token) => markers.get(token),
    dropTakeover: (token) => void markers.delete(token),
    isAlive: alive,
    self,
    now: () => '2026-10-17T00:00:00.000Z',
    token: () => `tok${++n}`,
  };
  return { io, acquire: () => acquire(io), release: (token: string) => void release(token, io), held: () => file?.text, hold: (text: string) => void (file = { text, id: 'held' }) };
}
