// Single-writer lock (pstack's orch store lock, rewritten; decisions 30 and 44): one process at a
// time may write the tracker or a run queue. The lock file holds {pid, host, startedAt, token}.
// - Another host's lock is always held: its process cannot be checked from here.
// - A lock whose holder on this host died is taken over: the taker first claims the takeover of
//   that lock (an exclusive marker named by its token, so one taker per stale lock), checks the
//   lock is still the file it read, renames it aside, checks the moved file is that file (same
//   identity, same text), and creates its own. A delete-then-create takeover lets two takers both
//   win; renaming without the claim can move a fresh lock aside for a moment, and a third taker
//   can create in that gap.
// - A marker left by a taker that died is never deleted: the next taker claims the next marker
//   (<token>-1, <token>-2, ...) instead. Deleting it could delete the fresh marker of a taker that
//   reclaimed it first, letting two takers in. A taker drops only the marker it claimed.
// - A lock that cannot be read, or holds no full record, is held: guessing it free could let two
//   writers in. Release needs the token, so a reused pid never frees someone else's lock.

export interface LockRecord {
  pid: number;
  host: string;
  startedAt: string;
  /** Random per acquire: tells two locks of one pid apart. */
  token: string;
}

export interface LockFile {
  text: string;
  /** The file's identity (device and inode on disk): a new file gets a new one, a rename keeps it. */
  id: string;
}

export interface LockIo {
  /** The lock file, or undefined when there is none. */
  read(): LockFile | undefined;
  /** Creates the lock file only if it does not exist (the `wx` flag); false when it already does. */
  createExclusive(text: string): boolean;
  /** Renames the lock file aside under a name of its own; the moved file, or undefined when it was gone. */
  moveAside(): (LockFile & { path: string }) | undefined;
  /** Puts a file moved aside back as the lock, unless a lock exists again. */
  restore(path: string): void;
  /** Deletes the lock file. */
  remove(): void;
  /** Deletes a file moved aside. */
  discard(path: string): void;
  /** Creates the takeover marker of this name (a lock's token, maybe with a generation), only if there is none; false when there is. */
  claimTakeover(marker: string, text: string): boolean;
  /** The takeover marker's text, or undefined when there is none. */
  readTakeover(marker: string): string | undefined;
  /** Deletes the takeover marker; nothing when it is gone. */
  dropTakeover(marker: string): void;
  /** Whether a process of this host is alive; a process that exists but may not be signalled is. */
  isAlive(pid: number): boolean;
  self: { pid: number; host: string };
  now(): string;
  token(): string;
}

export type Acquired = { ok: true; token: string; takenOverFrom?: LockRecord } | { ok: false; heldBy: LockRecord | null };

const FIELDS = { host: 'string', startedAt: 'string', token: 'string' } as const;

/** The record a lock file holds, or null when it holds no full record (or there is no file). */
function holderOf(text: string | undefined): LockRecord | null {
  let r: Record<string, unknown>;
  try {
    r = Object(JSON.parse(text as string)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const whole = Number.isInteger(r.pid) && (r.pid as number) > 0 && Object.entries(FIELDS).every(([k, type]) => typeof r[k] === type);
  // The token names the takeover marker's file, so it may hold nothing but word characters.
  return whole && /^\w+$/.test(r.token as string) ? (r as unknown as LockRecord) : null;
}

/** Whether `holder` is a process of this host that has died: only then may its lock be taken. */
const dead = (holder: LockRecord | null, io: Pick<LockIo, 'isAlive' | 'self'>): holder is LockRecord => holder !== null && holder.host === io.self.host && !io.isAlive(holder.pid);

const same = (a: LockFile, b: LockFile) => a.id === b.id && a.text === b.text;

interface Mine {
  text: string;
  token: string;
}

/** One try at creating the lock; a writer that got there first holds it. */
function created(mine: Mine, io: LockIo, extra: { takenOverFrom?: LockRecord }): Acquired {
  return io.createExclusive(mine.text) ? { ok: true, token: mine.token, ...extra } : { ok: false, heldBy: null };
}

const markerOf = (token: string, generation: number) => (generation === 0 ? token : `${token}-${generation}`);

/**
 * Claims the takeover of the lock with `token`: the first of its markers that is free, past those
 * of takers that died. The marker claimed, or undefined when a taker that may be alive holds one.
 */
function claimed(token: string, mine: Mine, io: LockIo): string | undefined {
  for (let generation = 0; ; generation += 1) {
    const marker = markerOf(token, generation);
    if (io.claimTakeover(marker, mine.text)) return marker;
    if (!dead(holderOf(io.readTakeover(marker)), io)) return undefined;
  }
}

/** With the takeover claimed: moves the dead holder's lock aside when it is still the file read, and replaces it. */
function replaced(found: LockFile, holder: LockRecord, mine: Mine, io: LockIo): Acquired {
  const now = io.read();
  if (now === undefined) return created(mine, io, {});
  // Taken over already, by a taker that finished before this one claimed.
  if (!same(now, found)) return { ok: false, heldBy: holderOf(now.text) };
  const moved = io.moveAside();
  if (moved === undefined) return created(mine, io, {});
  if (!same(moved, found)) {
    // Not the file read: put it back, it is not this taker's to remove.
    io.restore(moved.path);
    return { ok: false, heldBy: holderOf(moved.text) };
  }
  io.discard(moved.path);
  return created(mine, io, { takenOverFrom: holder });
}

function takeOver(found: LockFile, holder: LockRecord, mine: Mine, io: LockIo): Acquired {
  const marker = claimed(holder.token, mine, io);
  if (marker === undefined) return { ok: false, heldBy: holder };
  try {
    return replaced(found, holder, mine, io);
  } finally {
    io.dropTakeover(marker);
  }
}

export function acquire(io: LockIo): Acquired {
  const token = io.token();
  const mine = { token, text: JSON.stringify({ pid: io.self.pid, host: io.self.host, startedAt: io.now(), token }) };
  if (io.createExclusive(mine.text)) return { ok: true, token };
  const found = io.read();
  // Gone since the first look: one more try, never a removal of a file that was not read.
  if (found === undefined) return created(mine, io, {});
  const holder = holderOf(found.text);
  if (!dead(holder, io)) return { ok: false, heldBy: holder };
  return takeOver(found, holder, mine, io);
}

/** Releases the lock when it is the one `token` acquired; false otherwise. */
export function release(token: string, io: LockIo): boolean {
  const found = io.read();
  if (found === undefined || holderOf(found.text)?.token !== token) return false;
  io.remove();
  return true;
}

/**
 * Whether the lock is held, read only: no file or a holder of this host that died is free, as
 * acquire would take it; anything else is held, by the record when the file holds a full one.
 */
export function heldBy(io: Pick<LockIo, 'read' | 'isAlive' | 'self'>): { held: false } | { held: true; by: LockRecord | null } {
  const found = io.read();
  const holder = holderOf(found?.text);
  return found === undefined || dead(holder, io) ? { held: false } : { held: true, by: holder };
}
