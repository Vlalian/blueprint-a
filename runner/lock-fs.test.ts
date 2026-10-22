// The lock's file-system adapter on real files, in-process (the racing processes are in
// lock.integration.test.ts).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { acquire, release } from './lock.ts';
import { exclusive, exclusiveOrBusy, ifThere, ifThereOrBusy, isAlive, lockFs } from './lock-fs.ts';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const fresh = () => join(mkdtempSync(join(tmpdir(), 'lock-fs-')), 'run.lock');
const errno = (code: string) => Object.assign(new Error(code), { code });
const throws = (code: string) => () => {
  throw errno(code);
};

describe('isAlive (process.kill with signal 0)', () => {
  it('is true for this process', () => {
    expect(isAlive(process.pid)).toBe(true);
  });

  it('is false for a process that has exited', () => {
    const exited = spawnSync(process.execPath, ['-e', '']).pid!;
    expect(isAlive(exited)).toBe(false);
  });

  it('is true when the process exists but may not be signalled (EPERM)', () => {
    expect(isAlive(1, throws('EPERM'))).toBe(true);
  });

  it('is false when there is no such process (ESRCH)', () => {
    expect(isAlive(1, throws('ESRCH'))).toBe(false);
  });

  it('sends signal 0, which only checks, to the pid asked about', () => {
    const sent: [number, number | string | undefined][] = [];
    expect(isAlive(42, (pid, signal) => void sent.push([pid, signal]))).toBe(true);
    expect(sent).toEqual([[42, 0]]);
  });
});

describe('ifThere and exclusive', () => {
  it('ifThere answers undefined for a file that is not there, and rethrows anything else', () => {
    expect(ifThere(() => 'x')).toBe('x');
    expect(ifThere(throws('ENOENT'))).toBeUndefined();
    expect(() => ifThere(throws('EACCES'))).toThrow('EACCES');
  });

  it('exclusive answers false when the target exists, and rethrows anything else', () => {
    expect(exclusive(() => undefined)).toBe(true);
    expect(exclusive(throws('EEXIST'))).toBe(false);
    expect(() => exclusive(throws('ENOENT'))).toThrow('ENOENT');
  });
});

describe('lockFs on real files', () => {
  it('names this process and host, a time and a random token', () => {
    const io = lockFs(fresh());
    expect(io.self).toEqual({ pid: process.pid, host: hostname() });
    expect(Date.parse(io.now())).toBeGreaterThan(Date.parse('2026-01-01'));
    expect(io.now()).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(io.token()).toMatch(/^[0-9a-f]{32}$/);
    expect(io.token()).not.toBe(io.token());
    expect(io.isAlive(process.pid)).toBe(true);
  });

  it('creates the lock only when there is none, and reads it back with its identity', () => {
    const path = fresh();
    const io = lockFs(path);
    expect(io.read()).toBeUndefined();
    expect(io.createExclusive('one')).toBe(true);
    expect(io.createExclusive('two')).toBe(false);
    const found = io.read()!;
    expect(found.text).toBe('one');
    expect(found.id).toMatch(/^\d+:\d+$/);
    expect(io.read()!.id).toBe(found.id);
  });

  it('gives a new file a new identity, and keeps it through the move aside', () => {
    const path = fresh();
    const io = lockFs(path);
    io.createExclusive('one');
    const first = io.read()!;
    const moved = io.moveAside()!;
    expect(moved).toEqual({ ...first, path: expect.stringMatching(/run\.lock\.[0-9a-f]{16}\.stale$/) });
    expect(existsSync(path)).toBe(false);
    expect(readFileSync(moved.path, 'utf8')).toBe('one');
    io.createExclusive('one');
    expect(io.read()!.id).not.toBe(first.id);
  });

  it('moves aside nothing when there is no lock', () => {
    expect(lockFs(fresh()).moveAside()).toBeUndefined();
  });

  it('puts a moved lock back when no lock is there, and leaves a new lock alone when one is', () => {
    const path = fresh();
    const io = lockFs(path);
    io.createExclusive('one');
    const moved = io.moveAside()!;
    io.restore(moved.path);
    expect(io.read()).toEqual({ text: 'one', id: moved.id });
    expect(existsSync(moved.path)).toBe(false);

    const again = io.moveAside()!;
    io.createExclusive('new');
    io.restore(again.path);
    expect(io.read()!.text).toBe('new');
    expect(readFileSync(again.path, 'utf8')).toBe('one');
  });

  it('claims the takeover of a lock once, beside the lock and named by its token, and drops it quietly', () => {
    const path = fresh();
    const io = lockFs(path);
    expect(io.readTakeover('abc')).toBeUndefined();
    expect(io.claimTakeover('abc', 'first')).toBe(true);
    expect(io.claimTakeover('abc', 'second')).toBe(false);
    expect(io.claimTakeover('def', 'other')).toBe(true);
    expect(io.readTakeover('abc')).toBe('first');
    expect(readFileSync(`${path}.abc.takeover`, 'utf8')).toBe('first');
    io.dropTakeover('abc');
    io.dropTakeover('abc');
    expect(io.readTakeover('abc')).toBeUndefined();
    expect(io.readTakeover('def')).toBe('other');
  });

  it('removes the lock and discards a moved file, quietly when either is already gone', () => {
    const path = fresh();
    const io = lockFs(path);
    io.createExclusive('one');
    const moved = io.moveAside()!;
    io.discard(moved.path);
    io.discard(moved.path);
    io.createExclusive('two');
    io.remove();
    io.remove();
    expect(readdirSync(join(path, '..'))).toEqual([]);
  });
});

describe('acquire and release through lockFs', () => {
  it('takes a free lock, refuses a second acquire while it is held, and frees it on release', () => {
    const path = fresh();
    const first = acquire(lockFs(path));
    expect(first).toMatchObject({ ok: true });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ pid: process.pid, host: hostname() });
    expect(acquire(lockFs(path))).toMatchObject({ ok: false, heldBy: { pid: process.pid } });
    expect(release((first as { token: string }).token, lockFs(path))).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it("takes over a dead holder's lock and leaves no file aside", () => {
    const path = fresh();
    const dead = { pid: 2 ** 22 + 1, host: hostname(), startedAt: '2026-10-04T08:00:00.000Z', token: 'old' };
    writeFileSync(path, JSON.stringify(dead));
    const io = { ...lockFs(path), isAlive: (pid: number) => pid !== dead.pid };
    expect(acquire(io)).toMatchObject({ ok: true, takenOverFrom: dead });
    expect(readdirSync(join(path, '..'))).toEqual(['run.lock']);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ pid: process.pid });
  });
});

// Windows: opening a file another process is deleting fails with EPERM, not EEXIST or ENOENT. Eight
// racing takers hit it on the takeover marker under a full test load (2026-10-05 merge gate).
describe('the takeover marker while another taker deletes it (Windows EPERM)', () => {
  const fails = (code: string) => () => {
    throw Object.assign(new Error(code), { code });
  };
  it('a claim that meets EPERM has lost the race, like one that meets EEXIST', () => {
    expect(exclusiveOrBusy(fails('EPERM'))).toBe(false);
    expect(exclusiveOrBusy(fails('EEXIST'))).toBe(false);
    expect(exclusiveOrBusy(() => undefined)).toBe(true);
    expect(() => exclusiveOrBusy(fails('EACCES'))).toThrow('EACCES');
  });
  it('a read that meets EPERM sees the marker as busy, not gone', () => {
    expect(ifThereOrBusy(fails('EPERM'))).toBe('busy');
    expect(ifThereOrBusy(fails('ENOENT'))).toBeUndefined();
    expect(ifThereOrBusy(() => 'text')).toBe('text');
    expect(() => ifThereOrBusy(fails('EACCES'))).toThrow('EACCES');
  });
});
