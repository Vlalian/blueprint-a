// The run queue's file-system adapter on real files, in-process (a claimer that really crashes
// is in queue.integration.test.ts).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { claimNext, enqueue, finish } from './queue.ts';
import { queueFs } from './queue-fs.ts';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const fresh = () => mkdtempSync(join(tmpdir(), 'queue-fs-'));

describe('queueFs on real files', () => {
  it('lists nothing in a folder that does not exist, and the file names in one that does', () => {
    const root = fresh();
    expect(queueFs.list(join(root, 'ready'))).toEqual([]);
    queueFs.write(join(root, 'ready', 'b.md'), 'B');
    queueFs.write(join(root, 'ready', 'a.md'), 'A');
    expect(queueFs.list(join(root, 'ready')).sort()).toEqual(['a.md', 'b.md']);
  });

  it('writes and moves into folders it creates, and reads back, or undefined for no file', () => {
    const root = fresh();
    queueFs.write(join(root, 'ready', 'a.md'), 'A');
    queueFs.move(join(root, 'ready', 'a.md'), join(root, 'running', 'a.md'));
    expect(existsSync(join(root, 'ready', 'a.md'))).toBe(false);
    expect(queueFs.read(join(root, 'running', 'a.md'))).toBe('A');
    expect(queueFs.read(join(root, 'ready', 'a.md'))).toBeUndefined();
  });

  it('removes a file, quietly when it is already gone', () => {
    const root = fresh();
    queueFs.write(join(root, 'claims', 'a.md'), 'x');
    queueFs.remove(join(root, 'claims', 'a.md'));
    queueFs.remove(join(root, 'claims', 'a.md'));
    expect(existsSync(join(root, 'claims', 'a.md'))).toBe(false);
  });

  it('names this process and host as the claimer, and checks processes for real', () => {
    expect(queueFs.self).toEqual({ pid: process.pid, host: hostname() });
    expect(queueFs.isAlive(process.pid)).toBe(true);
    expect(queueFs.isAlive(spawnSync(process.execPath, ['-e', '']).pid!)).toBe(false);
  });
});

describe('the run queue on real files', () => {
  it('claims with a claim file naming this process, and finishing removes it', () => {
    const root = fresh();
    enqueue(root, '10_a.md', 'A', queueFs);
    expect(claimNext(root, queueFs)).toBe('10_a.md');
    expect(JSON.parse(readFileSync(join(root, 'claims', '10_a.md'), 'utf8'))).toEqual({ pid: process.pid, host: hostname() });
    finish(root, '10_a.md', 'done', queueFs);
    expect(existsSync(join(root, 'claims', '10_a.md'))).toBe(false);
    expect(readFileSync(join(root, 'done', '10_a.md'), 'utf8')).toBe('A');
  });

  it('requeues and claims again an item whose claimer on this host has exited', () => {
    const root = fresh();
    const dead = spawnSync(process.execPath, ['-e', '']).pid!;
    mkdirSync(join(root, 'running'), { recursive: true });
    writeFileSync(join(root, 'running', '10_a.md'), 'A');
    queueFs.write(join(root, 'claims', '10_a.md'), JSON.stringify({ pid: dead, host: hostname() }));
    expect(claimNext(root, queueFs)).toBe('10_a.md');
    expect(JSON.parse(readFileSync(join(root, 'claims', '10_a.md'), 'utf8'))).toEqual({ pid: process.pid, host: hostname() });
  });
});
