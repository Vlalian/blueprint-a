import { describe, expect, it } from 'vitest';
import { acquire, heldBy, release, type LockFile, type LockIo, type LockRecord } from './lock.ts';

const HOST = 'build-1';
const record = (over: Partial<LockRecord> = {}): LockRecord => ({ pid: 3, host: HOST, startedAt: '2026-10-04T08:00:00.000Z', token: 'theirs', ...over });

/**
 * A lock file in memory. Each file written gets a new identity, as a new file on disk gets a new
 * inode; moving it aside keeps it. `alive` lists the live pids on this host.
 */
function fakeLock(holder?: LockRecord | string, alive: number[] = []) {
  let next = 0;
  const made = (text: string): LockFile => ({ text, id: `f${(next += 1)}` });
  let lock: LockFile | undefined = holder === undefined ? undefined : made(typeof holder === 'string' ? holder : JSON.stringify(holder));
  const aside = new Map<string, LockFile>();
  const markers = new Map<string, string>();
  const calls: string[] = [];
  const io: LockIo = {
    read: () => lock,
    createExclusive: (text) => {
      calls.push('create');
      if (lock !== undefined) return false;
      lock = made(text);
      return true;
    },
    moveAside: () => {
      calls.push('moveAside');
      if (lock === undefined) return undefined;
      const path = `lock.${aside.size}.stale`;
      aside.set(path, lock);
      const moved = { ...lock, path };
      lock = undefined;
      return moved;
    },
    restore: (path) => {
      calls.push(`restore ${path}`);
      if (lock === undefined) lock = aside.get(path);
      aside.delete(path);
    },
    remove: () => {
      calls.push('remove');
      lock = undefined;
    },
    discard: (path) => {
      calls.push(`discard ${path}`);
      aside.delete(path);
    },
    claimTakeover: (token, text) => {
      calls.push(`claim ${token}`);
      if (markers.has(token)) return false;
      markers.set(token, text);
      return true;
    },
    readTakeover: (token) => markers.get(token),
    dropTakeover: (token) => {
      calls.push(`drop ${token}`);
      markers.delete(token);
    },
    isAlive: (pid) => alive.includes(pid),
    self: { pid: 7, host: HOST },
    now: () => '2026-10-04T09:00:00.000Z',
    token: () => 'mine',
  };
  return { io, calls, aside, markers, lock: () => lock, parsed: () => JSON.parse(lock!.text) as unknown, set: (text: string) => void (lock = made(text)) };
}

const MINE = { pid: 7, host: HOST, startedAt: '2026-10-04T09:00:00.000Z', token: 'mine' };

describe('acquire', () => {
  it('takes a free lock and records pid, host, start time and a token of its own', () => {
    const l = fakeLock();
    expect(acquire(l.io)).toEqual({ ok: true, token: 'mine' });
    expect(l.parsed()).toEqual(MINE);
  });

  it('refuses a lock held by a live process on this host, naming the holder', () => {
    const l = fakeLock(record(), [3]);
    expect(acquire(l.io)).toEqual({ ok: false, heldBy: record() });
    expect(l.calls).toEqual(['create']);
  });

  it("treats another host's lock as held even when the same pid is dead here: its process cannot be checked from this host", () => {
    const l = fakeLock(record({ host: 'cloud-runner' }), []);
    expect(acquire(l.io)).toEqual({ ok: false, heldBy: record({ host: 'cloud-runner' }) });
    expect(l.calls).toEqual(['create']);
  });

  it('takes over a lock whose holder on this host died: claims the takeover, moves the lock aside, checks it, creates its own', () => {
    const l = fakeLock(record(), []);
    expect(acquire(l.io)).toEqual({ ok: true, token: 'mine', takenOverFrom: record() });
    expect(l.parsed()).toEqual(MINE);
    expect(l.calls).toEqual(['create', 'claim theirs', 'moveAside', 'discard lock.0.stale', 'create', 'drop theirs']);
    expect(l.aside.size).toBe(0);
    expect(l.markers.size).toBe(0);
  });

  it('claims the takeover with its own lock record, which names it if it dies mid-takeover', () => {
    const l = fakeLock(record(), []);
    const marked: string[] = [];
    const claim = l.io.claimTakeover;
    l.io.claimTakeover = (token, text) => (marked.push(text), claim(token, text));
    acquire(l.io);
    expect(marked.map((t) => JSON.parse(t))).toEqual([MINE]);
  });
});

describe('acquire: a lock it cannot read is held (fails safe)', () => {
  it.each([
    ['not JSON', 'garbage'],
    ['empty, as a lock is for a moment between its creation and its first write', ''],
    ['a pid only, as the old lock wrote', JSON.stringify({ pid: 3 })],
    ['a pid that is not a number', JSON.stringify(record({ pid: '3' as never }))],
    ['a pid of 0, which would signal the whole process group', JSON.stringify(record({ pid: 0 }))],
    ['a negative pid', JSON.stringify(record({ pid: -1 }))],
    ['a fractional pid', JSON.stringify(record({ pid: 3.5 }))],
    ['no host', JSON.stringify({ ...record(), host: undefined })],
    ['no start time', JSON.stringify({ ...record(), startedAt: 1 })],
    ['no token', JSON.stringify({ ...record(), token: null })],
    ['a token that is a path, which would name a takeover marker elsewhere', JSON.stringify(record({ token: '../x' }))],
    ['a token with a path after it', JSON.stringify(record({ token: 'ab/x' }))],
    ['a token with a path before it', JSON.stringify(record({ token: 'x/ab' }))],
    ['an empty token', JSON.stringify(record({ token: '' }))],
    ['JSON null', 'null'],
  ])('treats a lock file that is %s as held by an unknown process, and leaves it alone', (_what, text) => {
    const l = fakeLock(text, []);
    expect(acquire(l.io)).toEqual({ ok: false, heldBy: null });
    expect(l.lock()!.text).toBe(text);
    expect(l.calls).toEqual(['create']);
  });
});

describe('acquire: the races around a takeover', () => {
  it('takes the lock when the holder released it between the two looks', () => {
    const l = fakeLock(record(), [3]);
    const answers = [false, true];
    l.io.createExclusive = () => answers.shift()!;
    l.io.read = () => undefined;
    expect(acquire(l.io)).toEqual({ ok: true, token: 'mine' });
  });

  it('gives up, as held by an unknown process, when a writer creates the lock between the two looks', () => {
    const l = fakeLock(record(), [3]);
    l.io.read = () => undefined;
    expect(acquire(l.io)).toEqual({ ok: false, heldBy: null });
    expect(l.calls).toEqual(['create', 'create']);
  });

  it('leaves alone a lock that another taker created after it read the stale one, and reports that taker as the holder', () => {
    const l = fakeLock(record(), []);
    const read = l.io.read;
    l.io.read = () => {
      const stale = read();
      // Between this look and the move aside, another taker replaced the stale lock with its own.
      l.set(JSON.stringify(record({ pid: 9, token: 'other' })));
      return stale;
    };
    expect(acquire(l.io)).toEqual({ ok: false, heldBy: record({ pid: 9, token: 'other' }) });
    expect(l.parsed()).toEqual(record({ pid: 9, token: 'other' }));
    expect(l.calls).toEqual(['create', 'claim theirs', 'drop theirs']);
  });

  it('checks the moved file by content as well as identity: a new lock can reuse the old inode', () => {
    const l = fakeLock(record(), []);
    const moveAside = l.io.moveAside;
    l.io.moveAside = () => {
      const moved = moveAside()!;
      return { ...moved, text: JSON.stringify(record({ pid: 9, token: 'other' })) };
    };
    expect(acquire(l.io)).toMatchObject({ ok: false, heldBy: { pid: 9, token: 'other' } });
    expect(l.calls).toEqual(['create', 'claim theirs', 'moveAside', 'restore lock.0.stale', 'drop theirs']);
  });

  it('checks the moved file by identity as well as content: a stale lock rewritten with the same text is a new file', () => {
    const l = fakeLock(record(), []);
    const moveAside = l.io.moveAside;
    l.io.moveAside = () => ({ ...moveAside()!, id: 'another file' });
    expect(acquire(l.io)).toEqual({ ok: false, heldBy: record() });
    expect(l.calls).toEqual(['create', 'claim theirs', 'moveAside', 'restore lock.0.stale', 'drop theirs']);
  });

  it('tries once more to create the lock when another taker moved the stale one aside first; whoever creates first holds it', () => {
    const l = fakeLock(record(), []);
    l.io.moveAside = () => undefined;
    l.io.createExclusive = () => (l.calls.push('create'), l.calls.length > 1);
    expect(acquire(l.io)).toEqual({ ok: true, token: 'mine' });
    expect(l.calls).toEqual(['create', 'claim theirs', 'create', 'drop theirs']);
  });

  it('gives up when the other taker created its lock first', () => {
    const l = fakeLock(record(), []);
    l.io.moveAside = () => undefined;
    l.io.createExclusive = () => false;
    expect(acquire(l.io)).toEqual({ ok: false, heldBy: null });
  });

  it('gives up, as held by an unknown process, when another writer wins the create after the takeover', () => {
    const l = fakeLock(record(), []);
    const answers = [false, false];
    l.io.createExclusive = () => answers.shift()!;
    expect(acquire(l.io)).toEqual({ ok: false, heldBy: null });
  });
});

describe('acquire: one taker per stale lock', () => {
  it('leaves the stale lock to the taker that claimed its takeover first, and reports the dead holder', () => {
    const l = fakeLock(record(), [9]);
    l.markers.set('theirs', JSON.stringify(record({ pid: 9, token: 'taker' })));
    expect(acquire(l.io)).toEqual({ ok: false, heldBy: record() });
    expect(l.calls).toEqual(['create', 'claim theirs']);
    expect(l.parsed()).toEqual(record());
    expect(l.markers.size).toBe(1);
  });

  it.each([
    ['a taker on another host', JSON.stringify(record({ pid: 9, host: 'cloud-runner', token: 'taker' }))],
    ['an unreadable record', 'garbage'],
  ])('keeps a takeover marker of %s', (_who, text) => {
    const l = fakeLock(record(), []);
    l.markers.set('theirs', text);
    expect(acquire(l.io)).toEqual({ ok: false, heldBy: record() });
    expect(l.markers.get('theirs')).toBe(text);
  });

  it("never deletes another taker's marker: two takers that both read a dead marker leave the takeover to one", () => {
    const l = fakeLock(record(), [7, 8]);
    const deadTaker = JSON.stringify(record({ pid: 9, token: 'taker' }));
    l.markers.set('theirs', deadTaker);
    // The second taker read the dead marker before the first claimed the takeover past it.
    let looks = 0;
    const second: LockIo = { ...l.io, self: { pid: 8, host: HOST }, token: () => 'second', readTakeover: (m) => ((looks += 1), looks === 1 ? deadTaker : l.io.readTakeover(m)) };
    let secondGot: unknown;
    const first: LockIo = { ...l.io, moveAside: () => ((secondGot = acquire(second)), l.io.moveAside()) };
    expect(acquire(first)).toEqual({ ok: true, token: 'mine', takenOverFrom: record() });
    expect(secondGot).toEqual({ ok: false, heldBy: record() });
    expect(l.parsed()).toEqual(MINE);
    expect(l.calls).toEqual(['create', 'claim theirs', 'claim theirs-1', 'create', 'claim theirs', 'claim theirs-1', 'moveAside', 'discard lock.0.stale', 'create', 'drop theirs-1']);
  });

  it('claims the takeover past every marker of a dead taker, leaving those markers be', () => {
    const l = fakeLock(record(), []);
    const deadTaker = JSON.stringify(record({ pid: 9, token: 'taker' }));
    l.markers.set('theirs', deadTaker);
    l.markers.set('theirs-1', deadTaker);
    expect(acquire(l.io)).toEqual({ ok: true, token: 'mine', takenOverFrom: record() });
    expect(l.calls).toEqual(['create', 'claim theirs', 'claim theirs-1', 'claim theirs-2', 'moveAside', 'discard lock.0.stale', 'create', 'drop theirs-2']);
    expect([...l.markers.keys()]).toEqual(['theirs', 'theirs-1']);
  });

  it('gives up when the takeover is claimed but its marker is gone by the time it looks: that taker is finishing', () => {
    const l = fakeLock(record(), []);
    l.io.claimTakeover = () => false;
    expect(acquire(l.io)).toEqual({ ok: false, heldBy: record() });
    expect(l.parsed()).toEqual(record());
  });

  it('gives up when another taker claims the marker past a dead one first', () => {
    const l = fakeLock(record(), [8]);
    l.markers.set('theirs', JSON.stringify(record({ pid: 9, token: 'taker' })));
    const claim = l.io.claimTakeover;
    l.io.claimTakeover = (marker, text) => (marker === 'theirs-1' && l.markers.set(marker, JSON.stringify(record({ pid: 8, token: 'other' }))), claim(marker, text));
    expect(acquire(l.io)).toEqual({ ok: false, heldBy: record() });
    expect(l.parsed()).toEqual(record());
  });

  it('creates once more when the lock is gone by the time it claimed the takeover', () => {
    const l = fakeLock(record(), []);
    const read = l.io.read;
    let looks = 0;
    l.io.read = () => ((looks += 1), looks === 1 ? read() : undefined);
    l.io.claimTakeover = (token) => (l.io.remove(), l.calls.push(`claim ${token}`), true);
    expect(acquire(l.io)).toEqual({ ok: true, token: 'mine' });
    expect(l.calls).toEqual(['create', 'remove', 'claim theirs', 'create', 'drop theirs']);
  });

  it('drops its takeover marker even when the create after the takeover fails', () => {
    const l = fakeLock(record(), []);
    const answers = [false, false];
    l.io.createExclusive = () => answers.shift()!;
    expect(acquire(l.io)).toEqual({ ok: false, heldBy: null });
    expect(l.markers.size).toBe(0);
  });

  it('drops its takeover marker when the takeover throws', () => {
    const l = fakeLock(record(), []);
    l.io.moveAside = () => {
      throw new Error('disk gone');
    };
    expect(() => acquire(l.io)).toThrow('disk gone');
    expect(l.markers.size).toBe(0);
  });
});

describe('release', () => {
  it('releases only the lock its own token holds', () => {
    const mine = fakeLock(MINE);
    expect(release('mine', mine.io)).toBe(true);
    expect(mine.lock()).toBeUndefined();

    const theirs = fakeLock(record());
    expect(release('mine', theirs.io)).toBe(false);
    expect(theirs.lock()).toBeDefined();
    expect(theirs.calls).toEqual([]);

    expect(release('mine', fakeLock().io)).toBe(false);
    expect(release('mine', fakeLock('garbage').io)).toBe(false);
  });

  it('never releases a lock of the same pid with another token (a pid reused after a crash)', () => {
    const l = fakeLock({ ...MINE, token: 'old' });
    expect(release('mine', l.io)).toBe(false);
    expect(l.lock()).toBeDefined();
  });
});

describe('heldBy', () => {
  it('is free with no lock file and when the holder on this host has died', () => {
    expect(heldBy(fakeLock().io)).toEqual({ held: false });
    expect(heldBy(fakeLock(record(), []).io)).toEqual({ held: false });
  });

  it('is held by a live holder, another host and a lock it cannot read, and takes nothing over', () => {
    const live = fakeLock(record(), [3]);
    expect(heldBy(live.io)).toEqual({ held: true, by: record() });
    expect(live.calls).toEqual([]);
    expect(heldBy(fakeLock(record({ host: 'other' })).io)).toEqual({ held: true, by: record({ host: 'other' }) });
    expect(heldBy(fakeLock('garbage').io)).toEqual({ held: true, by: null });
  });
});
