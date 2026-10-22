// The run queue (swarm-forge's file-location queue, rewritten): an item's state is the folder
// its file sits in: ready/, running/, done/, failed/. Only these functions move files, and they
// refuse an ambiguous state (two running items) rather than guess. Names sort by priority prefix.
// A claim records the claimer's pid and host in claims/<item> (decision 30): an item whose
// claimer on this host has died goes back to ready/ at the next claim, so a crashed run never
// leaves it stuck in running/. A claim from another host, or one that cannot be read, stays busy.

export interface Claimer {
  pid: number;
  host: string;
}

export interface QueueIo {
  /** File names directly inside dir; [] when dir does not exist. */
  list(dir: string): string[];
  write(path: string, text: string): void;
  /** Moves a file, creating the target folder. */
  move(from: string, to: string): void;
  /** The file's text, or undefined when it does not exist. */
  read(path: string): string | undefined;
  /** Deletes a file; nothing when it is already gone. */
  remove(path: string): void;
  /** This process, as its claims record it. */
  self: Claimer;
  /** Whether a process of this host is alive. */
  isAlive(pid: number): boolean;
}

const STATES = ['ready', 'running', 'done', 'failed'] as const;

const claimPath = (root: string, name: string) => `${root}/claims/${name}`;

/** The claimer a claim file names, or undefined when it names no pid; a host that is not text matches no host. */
function claimerOf(text: string | undefined): Claimer | undefined {
  let c: Record<string, unknown>;
  try {
    c = Object(JSON.parse(text as string)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  return Number.isInteger(c.pid) && (c.pid as number) > 0 ? (c as unknown as Claimer) : undefined;
}

/** Whether the item's claimer was a process of this host that has died. */
function abandoned(root: string, name: string, io: QueueIo): boolean {
  const c = claimerOf(io.read(claimPath(root, name)));
  return c !== undefined && c.host === io.self.host && !io.isAlive(c.pid);
}

/** Moves each running item whose claimer died back to ready/. */
function requeueAbandoned(root: string, io: QueueIo): void {
  for (const name of io.list(`${root}/running`).filter((n) => abandoned(root, n, io))) {
    io.move(`${root}/running/${name}`, `${root}/ready/${name}`);
    io.remove(claimPath(root, name));
  }
}

function running(root: string, io: QueueIo): string[] {
  const items = io.list(`${root}/running`).sort();
  if (items.length > 1) throw new Error(`queue ${root} has ${items.length} running items (${items.join(', ')}); repair by hand`);
  return items;
}

// A plain file name: no folder part, and not hidden, so an item can never land outside its state folder.
const ITEM_NAME = /^[\w-][\w.-]*$/;
// What Windows does not store as written: a device name (CON, NUL, COM1…, with any extension),
// and a trailing dot, which it drops.
const NOT_ON_WINDOWS = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)|\.$/i;
const plainName = (name: string) => ITEM_NAME.test(name) && !NOT_ON_WINDOWS.test(name);
// Windows file names are case-insensitive: 10_A.md and 10_a.md are one file there.
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function enqueue(root: string, name: string, text: string, io: QueueIo): void {
  if (!plainName(name)) throw new Error(`item name ${JSON.stringify(name)} must be a plain file name`);
  const taken = STATES.find((s) => io.list(`${root}/${s}`).some((item) => sameName(item, name)));
  if (taken) throw new Error(`${name} is already in ${root}/${taken}`);
  io.write(`${root}/ready/${name}`, text);
}

/**
 * Moves the first ready item to running/, recording this process as its claimer, and returns its
 * name; null when nothing is ready. Items of dead claimers go back to ready/ first.
 */
export function claimNext(root: string, io: QueueIo): string | null {
  requeueAbandoned(root, io);
  const [busy] = running(root, io);
  if (busy) throw new Error(`queue ${root} is busy: ${busy} is still running`);
  const [next] = io.list(`${root}/ready`).sort();
  if (!next) return null;
  // The claim first: a crash between the two leaves a stray claim, never an unclaimed running item.
  io.write(claimPath(root, next), JSON.stringify(io.self));
  io.move(`${root}/ready/${next}`, `${root}/running/${next}`);
  return next;
}

/** Moves the running item to done/ or failed/, or back to ready/ when it is to run again (requeue). */
export function finish(root: string, name: string, state: 'done' | 'failed' | 'ready', io: QueueIo): void {
  if (!running(root, io).includes(name)) throw new Error(`${name} is not running in ${root}`);
  io.move(`${root}/running/${name}`, `${root}/${state}/${name}`);
  io.remove(claimPath(root, name));
}
