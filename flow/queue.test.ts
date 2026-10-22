import { describe, expect, it } from 'vitest';
import { claimNext, enqueue, finish, type QueueIo } from './queue.ts';
import { namesUnder } from '../test/helpers/portable-paths.ts';

const SELF = { pid: 7, host: 'build-1' };

function fakeFs(initial: Record<string, string> = {}, alive: number[] = [7]) {
  const files = new Map(Object.entries(initial));
  const io: QueueIo = {
    read: (path) => files.get(path),
    remove: (path) => void files.delete(path),
    self: SELF,
    isAlive: (pid) => alive.includes(pid),
    list: (dir) => namesUnder(files.keys(), dir, true),
    write: (path, text) => void files.set(path, text),
    move: (from, to) => {
      const text = files.get(from);
      if (text === undefined) throw new Error(`no such file ${from}`);
      files.delete(from);
      files.set(to, text);
    },
  };
  return { io, files };
}

describe('the run queue: state is the folder a file is in', () => {
  it('enqueues into ready/ and claims the lowest-sorted item into running/', () => {
    const { io, files } = fakeFs();
    enqueue('/q', '50_b.md', 'B', io);
    enqueue('/q', '10_a.md', 'A', io);
    expect(claimNext('/q', io)).toBe('10_a.md');
    expect([...files.keys()].sort()).toEqual(['/q/claims/10_a.md', '/q/ready/50_b.md', '/q/running/10_a.md']);
  });

  it('returns null when nothing is ready', () => {
    expect(claimNext('/q', fakeFs().io)).toBeNull();
  });

  it('refuses to claim while an item is still running in this queue (one slot per project)', () => {
    const { io } = fakeFs({ '/q/running/10_a.md': 'A', '/q/claims/10_a.md': JSON.stringify({ pid: 3, host: 'build-1' }), '/q/ready/20_b.md': 'B' }, [3]);
    expect(() => claimNext('/q', io)).toThrow('queue /q is busy: 10_a.md is still running');
  });

  it('refuses an ambiguous state with two running items instead of guessing', () => {
    const { io } = fakeFs({ '/q/running/20_b.md': 'B', '/q/running/10_a.md': 'A' });
    expect(() => claimNext('/q', io)).toThrow('queue /q has 2 running items (10_a.md, 20_b.md); repair by hand');
    expect(() => finish('/q', '10_a.md', 'done', io)).toThrow(/2 running items/);
  });

  it('finishes the running item into done/ or failed/, and removes its claim', () => {
    const { io, files } = fakeFs({ '/q/running/10_a.md': 'A', '/q/claims/10_a.md': JSON.stringify(SELF) });
    finish('/q', '10_a.md', 'failed', io);
    expect([...files.keys()]).toEqual(['/q/failed/10_a.md']);
  });

  it('puts the running item back into ready/, where the next claim takes it again', () => {
    const { io, files } = fakeFs({ '/q/running/10_a.md': 'A', '/q/ready/20_b.md': 'B' });
    finish('/q', '10_a.md', 'ready', io);
    expect([...files.keys()].sort()).toEqual(['/q/ready/10_a.md', '/q/ready/20_b.md']);
    expect(claimNext('/q', io)).toBe('10_a.md');
  });

  it('refuses to finish an item that is not the running one', () => {
    const { io } = fakeFs({ '/q/running/10_a.md': 'A' });
    expect(() => finish('/q', '20_b.md', 'done', io)).toThrow('20_b.md is not running in /q');
  });

  it.each(['../x', 'a/b', 'a\\b', '.hidden', '', '..'])('refuses the item name %j, which is not a plain file name', (name) => {
    const { io, files } = fakeFs();
    expect(() => enqueue('/q', name, 'x', io)).toThrow(`item name ${JSON.stringify(name)} must be a plain file name`);
    expect(files.size).toBe(0);
  });

  it('accepts ordinary item names', () => {
    const { io, files } = fakeFs();
    enqueue('/q', '10_a-b.c.md', 'x', io);
    enqueue('/q', 'A', 'y', io);
    expect([...files.keys()]).toEqual(['/q/ready/10_a-b.c.md', '/q/ready/A']);
  });

  it.each(['CON', 'nul', 'Aux.md', 'com1.md', 'LPT9.txt', 'prn', 'a.', '10_a.md.'])(
    'refuses %j, which Windows maps to a device or writes under another name',
    (name) => {
      const { io, files } = fakeFs();
      expect(() => enqueue('/q', name, 'x', io)).toThrow(`item name ${JSON.stringify(name)} must be a plain file name`);
      expect(files.size).toBe(0);
    },
  );

  it.each(['console.md', 'nullable', 'com.md', 'lpt.md', 'coma.md', 'a-nul.md', 'a.b'])('accepts %j, which only starts like a device name', (name) => {
    const { io, files } = fakeFs();
    enqueue('/q', name, 'x', io);
    expect([...files.keys()]).toEqual([`/q/ready/${name}`]);
  });

  it('refuses a name queued under another case: on Windows it is the same file', () => {
    const { io } = fakeFs({ '/q/done/10_A.md': 'A' });
    expect(() => enqueue('/q', '10_a.md', 'again', io)).toThrow('10_a.md is already in /q/done');
  });

  it('refuses to enqueue a name that is already queued anywhere', () => {
    const { io } = fakeFs({ '/q/done/10_a.md': 'A' });
    expect(() => enqueue('/q', '10_a.md', 'again', io)).toThrow('10_a.md is already in /q/done');
  });
});

describe('the run queue: a claimed item records its claimer, and a dead claimer frees it (decision 30)', () => {
  const claim = (c: object) => JSON.stringify(c);

  it("records the claimer's pid and host beside the running item", () => {
    const { io, files } = fakeFs({ '/q/ready/10_a.md': 'A' });
    expect(claimNext('/q', io)).toBe('10_a.md');
    expect(JSON.parse(files.get('/q/claims/10_a.md')!)).toEqual({ pid: 7, host: 'build-1' });
    expect(files.get('/q/running/10_a.md')).toBe('A');
  });

  it('writes the claim before it moves the item, so a running item never lacks one', () => {
    const { io } = fakeFs({ '/q/ready/10_a.md': 'A' });
    const order: string[] = [];
    const { write, move } = io;
    io.write = (path, text) => (order.push(`write ${path}`), write(path, text));
    io.move = (from, to) => (order.push(`move ${from}`), move(from, to));
    claimNext('/q', io);
    expect(order).toEqual(['write /q/claims/10_a.md', 'move /q/ready/10_a.md']);
  });

  it('requeues an item whose claimer on this host has died, then claims the next item as usual', () => {
    const { io, files } = fakeFs({ '/q/running/20_b.md': 'B', '/q/claims/20_b.md': claim({ pid: 3, host: 'build-1' }), '/q/ready/10_a.md': 'A' });
    expect(claimNext('/q', io)).toBe('10_a.md');
    expect([...files.keys()].sort()).toEqual(['/q/claims/10_a.md', '/q/ready/20_b.md', '/q/running/10_a.md']);
    expect(files.get('/q/ready/20_b.md')).toBe('B');
  });

  it('claims the requeued item itself when it sorts first', () => {
    const { io, files } = fakeFs({ '/q/running/10_a.md': 'A', '/q/claims/10_a.md': claim({ pid: 3, host: 'build-1' }) });
    expect(claimNext('/q', io)).toBe('10_a.md');
    expect(JSON.parse(files.get('/q/claims/10_a.md')!)).toEqual(SELF);
  });

  it('requeues every running item whose claimer died, even when there were two', () => {
    const { io, files } = fakeFs({
      '/q/running/10_a.md': 'A',
      '/q/claims/10_a.md': claim({ pid: 3, host: 'build-1' }),
      '/q/running/20_b.md': 'B',
      '/q/claims/20_b.md': claim({ pid: 4, host: 'build-1' }),
    });
    expect(claimNext('/q', io)).toBe('10_a.md');
    expect([...files.keys()].sort()).toEqual(['/q/claims/10_a.md', '/q/ready/20_b.md', '/q/running/10_a.md']);
  });

  it.each([
    ['its claimer is alive', claim({ pid: 3, host: 'build-1' }), [3]],
    ["its claimer is on another host, whose processes cannot be checked from here", claim({ pid: 3, host: 'cloud-runner' }), []],
    ['it has no claim', undefined, []],
    ['its claim is not JSON', 'garbage', []],
    ['its claim has no pid', claim({ host: 'build-1' }), []],
    ['its claim has a pid of 0, which would signal the whole process group', claim({ pid: 0, host: 'build-1' }), []],
    ['its claim has no host', claim({ pid: 3 }), []],
    ['its claim is JSON null', 'null', []],
  ])('keeps a running item busy when %s', (_why, text, alive) => {
    const initial: Record<string, string> = { '/q/running/10_a.md': 'A', '/q/ready/20_b.md': 'B' };
    if (text !== undefined) initial['/q/claims/10_a.md'] = text;
    const { io, files } = fakeFs(initial, alive as number[]);
    expect(() => claimNext('/q', io)).toThrow('queue /q is busy: 10_a.md is still running');
    expect(files.get('/q/running/10_a.md')).toBe('A');
  });

  it('checks the claimer of each running item by its own pid', () => {
    const checked: number[] = [];
    const { io } = fakeFs({ '/q/running/10_a.md': 'A', '/q/claims/10_a.md': claim({ pid: 3, host: 'build-1' }) });
    io.isAlive = (pid) => (checked.push(pid), true);
    expect(() => claimNext('/q', io)).toThrow(/busy/);
    expect(checked).toEqual([3]);
  });

  it('does not count the claims folder as a state, so an item name may match a claim', () => {
    const { io } = fakeFs({ '/q/claims/10_a.md': claim(SELF) });
    enqueue('/q', '10_a.md', 'A', io);
    expect(claimNext('/q', io)).toBe('10_a.md');
  });

  it('removes the claim when the item goes back to ready/ through finish', () => {
    const { io, files } = fakeFs({ '/q/running/10_a.md': 'A', '/q/claims/10_a.md': claim(SELF) });
    finish('/q', '10_a.md', 'ready', io);
    expect([...files.keys()]).toEqual(['/q/ready/10_a.md']);
  });
});
